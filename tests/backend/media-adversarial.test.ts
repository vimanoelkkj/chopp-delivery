import { expect, it } from 'vitest'
import { verifyMediaObjects } from '../../server/cms/media-integrity'
import { handleLocalMedia } from '../../server/cms/media-library'
import { mediaFixture } from './media-stage3-fixture'

it('A1: failure of final job UPDATE never leaves ready/failed media', async () => {
  const f = await mediaFixture()
  try {
    await f.db
      .prepare(
        "CREATE TRIGGER a1 BEFORE UPDATE ON cms_media_jobs WHEN NEW.status='done' BEGIN SELECT RAISE(ABORT,'A1 injected'); END",
      )
      .run()
    expect((await f.upload()).status).toBe(503)
    expect(await f.state()).toEqual({ state: 'rejected', status: 'failed' })
  } finally {
    await f.close()
  }
})
it('A2: revocation inside finalization aborts both writes and its trigger effects', async () => {
  const f = await mediaFixture()
  try {
    await f.db
      .prepare(
        "CREATE TRIGGER a2 BEFORE UPDATE ON cms_media WHEN NEW.state='ready' BEGIN DELETE FROM admin_sessions; END",
      )
      .run()
    expect((await f.upload()).status).toBe(401)
    expect((await f.state())?.state).not.toBe('ready')
    expect(await f.db.prepare('SELECT count(*) n FROM admin_sessions').first('n')).toBe(1)
  } finally {
    await f.close()
  }
})
it('A3: expired lease at final write cannot promote media; reconciliation terminates it', async () => {
  const f = await mediaFixture()
  try {
    await f.db
      .prepare(
        "CREATE TRIGGER a3 BEFORE UPDATE ON cms_media WHEN NEW.state='ready' BEGIN UPDATE cms_media_jobs SET expires_at=1 WHERE operation_id=NEW.revision; END",
      )
      .run()
    expect((await f.upload()).status).not.toBe(200)
    await f.reconcile()
    expect(await f.state()).toEqual({ state: 'rejected', status: 'failed' })
  } finally {
    await f.close()
  }
})
it('A4: interrupted worker and failed compensation recover without promotion', async () => {
  const f = await mediaFixture()
  try {
    await f.db
      .prepare(
        "CREATE TRIGGER a4 BEFORE UPDATE ON cms_media WHEN NEW.state IN ('ready','rejected') BEGIN SELECT RAISE(ABORT,'interrupted'); END",
      )
      .run()
    expect((await f.upload()).status).toBe(503)
    expect((await f.state())?.state).toBe('processing')
    await f.db.prepare('DROP TRIGGER a4').run()
    await f.db
      .prepare('UPDATE cms_media_jobs SET expires_at=1 WHERE operation_id=?')
      .bind(f.operation)
      .run()
    expect((await f.reconcile()).status).toBe(200)
    expect(await f.state()).toEqual({ state: 'rejected', status: 'failed' })
    expect((await f.env.CMS_MEDIA_BUCKET?.list({ prefix: 'cms/' }))?.objects).toHaveLength(0)
  } finally {
    await f.close()
  }
})
it('A5: lost response replays an immutable receipt even after later deletion', async () => {
  const f = await mediaFixture()
  try {
    const persisted = await f.upload()
    expect(persisted.status).toBe(200)
    const original = await persisted.json()
    const removed = await handleLocalMedia(
      f.request('DELETE', undefined, {
        'X-Operation-Id': crypto.randomUUID(),
        'If-Match': `"${f.operation}"`,
      }),
      f.env,
      f.id,
    )
    expect(removed.status).toBe(200)
    expect(await (await f.upload()).json()).toEqual(original)
    expect(await f.db.prepare('SELECT count(*) n FROM cms_media_jobs').first('n')).toBe(2)
  } finally {
    await f.close()
  }
})
it('A6: operation identity rejects changed bytes and target', async () => {
  const f = await mediaFixture()
  try {
    expect((await f.upload()).status).toBe(200)
    const bytes = f.png.slice()
    bytes[50] ^= 1
    expect((await handleLocalMedia(f.request('POST', bytes), f.env)).status).not.toBe(200)
    expect(
      (
        await handleLocalMedia(
          f.request('DELETE', undefined, { 'If-Match': `"${f.operation}"` }),
          f.env,
          f.id,
        )
      ).status,
    ).toBe(409)
  } finally {
    await f.close()
  }
})
it('A7: concurrent uploads admit one winner and one receipt', async () => {
  const f = await mediaFixture()
  try {
    expect((await Promise.all([f.upload(), f.upload()])).map((r) => r.status).sort()).toEqual([
      200, 409,
    ])
    expect(await f.db.prepare('SELECT count(*) n FROM cms_media_jobs').first('n')).toBe(1)
  } finally {
    await f.close()
  }
})
it('A8: reference/delete race cannot retain a reference to deleted media', async () => {
  const f = await mediaFixture()
  try {
    expect((await f.upload()).status).toBe(200)
    const input = f.command()
    Object.assign(input.document.modules[0].content, { media: { id: f.id, alt: 'private' } })
    const [save, removed] = await Promise.all([
      f.save(input),
      handleLocalMedia(
        f.request('DELETE', undefined, {
          'X-Operation-Id': crypto.randomUUID(),
          'If-Match': `"${f.operation}"`,
        }),
        f.env,
        f.id,
      ),
    ])
    expect([save.response.status, removed.status].filter((s) => s === 200)).toHaveLength(1)
    expect(
      await f.db
        .prepare(
          "SELECT count(*) n FROM cms_media_refs r JOIN cms_media m USING(media_id) WHERE m.state IN ('deleted','deleting')",
        )
        .first('n'),
    ).toBe(0)
  } finally {
    await f.close()
  }
})
it('A9: terminal jobs and media reject direct SQL mutation', async () => {
  const f = await mediaFixture()
  try {
    expect((await f.upload()).status).toBe(200)
    await expect(
      f.db
        .prepare("UPDATE cms_media_jobs SET status='failed' WHERE operation_id=?")
        .bind(f.operation)
        .run(),
    ).rejects.toThrow(/MEDIA_/)
    await expect(
      f.db.prepare("UPDATE cms_media SET state='rejected' WHERE media_id=?").bind(f.id).run(),
    ).rejects.toThrow(/MEDIA_/)
    expect(await f.state()).toEqual({ state: 'ready', status: 'done' })
  } finally {
    await f.close()
  }
})
for (const mode of ['missing', 'same-size', 'size', 'mime', 'identity'] as const)
  it(`A10-A12: ${mode} object cannot pass verification or modify immutable manifest`, async () => {
    const f = await mediaFixture()
    try {
      expect((await f.upload()).status).toBe(200)
      const before = await f.manifest(),
        key = before.hero.objectKey,
        bucket = f.env.CMS_MEDIA_BUCKET
      if (mode === 'missing') await bucket.delete(key)
      if (mode === 'same-size' || mode === 'size' || mode === 'mime') {
        const object = await bucket.get(key)
        if (!object) throw new Error('Expected stored fixture object')
        const bytes = new Uint8Array(await object.arrayBuffer())
        if (mode === 'same-size') bytes[bytes.length - 1] ^= 1
        await bucket.put(key, mode === 'size' ? bytes.slice(1) : bytes, {
          httpMetadata: { contentType: mode === 'mime' ? 'image/png' : 'image/webp' },
        })
      }
      if (mode === 'identity')
        f.env.CMS_MEDIA_BUCKET = new Proxy(bucket, {
          get(target, prop) {
            if (prop === 'get')
              return async (key: string) => {
                const obj = await target.get(key)
                return obj
                  ? {
                      key: 'cms/other',
                      size: obj.size,
                      httpMetadata: { contentType: 'image/webp' },
                      arrayBuffer: () => obj.arrayBuffer(),
                    }
                  : null
              }
            const v = Reflect.get(target, prop)
            return typeof v === 'function' ? v.bind(target) : v
          },
        })
      expect((await f.get()).status).toBe(503)
      expect(await f.manifest()).toEqual(before)
      expect((await f.state())?.state).toBe('ready')
    } finally {
      await f.close()
    }
  })
for (const [name, path, value] of [
  ['extra-profile', '$.extra', { objectKey: 'private' }],
  ['bad-key', '$.hero.objectKey', 'other/key'],
  ['bad-hash', '$.hero.sha256', 'not-a-sha'],
] as const)
  it(`A12-A13: finalization rejects ${name}`, async () => {
    const f = await mediaFixture()
    try {
      await f.db
        .prepare(
          `CREATE TRIGGER a13 AFTER UPDATE ON cms_media WHEN NEW.state='ready' BEGIN UPDATE cms_media SET derivatives_json=json_set(derivatives_json,?,json(?)) WHERE media_id=NEW.media_id; END`.replace(
            '?,json(?)',
            `'${path}',json('${JSON.stringify(value)}')`,
          ),
        )
        .run()
      expect((await f.upload()).status).not.toBe(200)
      expect((await f.state())?.state).not.toBe('ready')
    } finally {
      await f.close()
    }
  })
it('A15: missing/cross Origin and cross-site mutations are forbidden', async () => {
  const f = await mediaFixture()
  try {
    for (const headers of [
      { Origin: '' },
      { Origin: 'https://evil.invalid' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ] as Record<string, string>[])
      expect((await handleLocalMedia(f.request('POST', f.png, headers), f.env)).status).toBe(403)
  } finally {
    await f.close()
  }
})
it('A17: admin response never exposes private manifests, hashes or lease tokens', async () => {
  const f = await mediaFixture()
  try {
    expect((await f.upload()).status).toBe(200)
    const text = await (await f.get()).text()
    expect(text).not.toMatch(/objectKey|sha256|derivatives|lease|session|actor|quarantine/)
  } finally {
    await f.close()
  }
})

it('A6 supplemental: same operation with different bytes returns exactly 409', async () => {
  const f = await mediaFixture()
  try {
    expect((await f.upload()).status).toBe(200)
    const changed = f.png.slice()
    changed[50] ^= 1
    expect((await handleLocalMedia(f.request('POST', changed), f.env)).status).toBe(409)
  } finally {
    await f.close()
  }
})
it('A16: more than 5 MiB in chunks is rejected without processor or object writes', async () => {
  const f = await mediaFixture()
  try {
    let calls = 0
    f.env.CMS_MEDIA_PROCESSOR = {
      fetch: async () => {
        calls++
        throw Error('must not process')
      },
    }
    const base = f.request(),
      stream = new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1024 * 1024))
          c.enqueue(new Uint8Array(1))
          c.close()
        },
      })
    const request = new Request(base.url, {
      method: 'POST',
      headers: base.headers,
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect((await handleLocalMedia(request, f.env)).status).toBe(413)
    expect(calls).toBe(0)
    expect(await f.state()).toEqual({ state: 'rejected', status: 'failed' })
    expect((await f.env.CMS_MEDIA_BUCKET?.list({ prefix: 'cms/' }))?.objects).toHaveLength(0)
  } finally {
    await f.close()
  }
})
it('A10 recovery: integrity failure appends evidence and does not rewrite ready history', async () => {
  const f = await mediaFixture()
  try {
    expect((await f.upload()).status).toBe(200)
    const before = await f.manifest()
    await f.env.CMS_MEDIA_BUCKET.delete(before.hero.objectKey)
    expect((await f.reconcile()).status).toBe(503)
    expect(await f.manifest()).toEqual(before)
    expect(
      await f.db.prepare('SELECT count(*) n FROM cms_media_checks WHERE valid=0').first('n'),
    ).toBeGreaterThan(0)
    expect((await f.state())?.state).toBe('ready')
  } finally {
    await f.close()
  }
})

for (const point of ['job', 'media'] as const)
  it(`A1 supplemental: RAISE(IGNORE) on ${point} cannot produce partial success`, async () => {
    const f = await mediaFixture()
    try {
      const table = point === 'job' ? 'cms_media_jobs' : 'cms_media',
        condition = point === 'job' ? "NEW.status='done'" : "NEW.state='ready'"
      await f.db
        .prepare(
          `CREATE TRIGGER a1ignore BEFORE UPDATE ON ${table} WHEN ${condition} BEGIN SELECT RAISE(IGNORE); END`,
        )
        .run()
      expect((await f.upload()).status).toBe(503)
      expect(await f.state()).toEqual({ state: 'rejected', status: 'failed' })
      expect(await f.db.prepare('SELECT count(*) n FROM cms_media_write_guard').first('n')).toBe(0)
      expect(
        await f.db
          .prepare(
            "SELECT count(*) n FROM cms_media_receipts r JOIN cms_media_jobs j USING(operation_id) WHERE j.status='done'",
          )
          .first('n'),
      ).toBe(0)
    } finally {
      await f.close()
    }
  })

it('A12 supplemental: actual dimensions must match immutable manifest observations', async () => {
  const f = await mediaFixture()
  try {
    expect((await f.upload()).status).toBe(200)
    const original = await f.manifest(),
      altered = structuredClone(original)
    altered.hero.width += 1
    await expect(
      verifyMediaObjects(f.db, f.env.CMS_MEDIA_BUCKET, f.id, JSON.stringify(altered)),
    ).rejects.toThrow(/MEDIA_OBJECT_INTEGRITY/)
    expect(await f.manifest()).toEqual(original)
  } finally {
    await f.close()
  }
})
