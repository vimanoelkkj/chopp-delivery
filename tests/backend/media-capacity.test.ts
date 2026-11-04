import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { splitSql } from './cms-v2-sql-fixture'

const upgrade = readFileSync('migrations/0010_cms_media_capacity.sql', 'utf8')
let db: DatabaseSync
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const name of [
    '0001_catalog.sql',
    '0002_catalog_seed.sql',
    '0003_admin_auth.sql',
    '0004_catalog_revision.sql',
    '0005_catalog_expansion.sql',
    '0006_cms_foundation.sql',
    '0007_cms_media_local.sql',
    '0008_cms_media_atomic.sql',
    '0009_cms_v2.sql',
  ])
    db.exec(readFileSync(`migrations/${name}`, 'utf8'))
  db.exec(
    "INSERT INTO admin_users(id,username,password_hash) VALUES('quota-owner','quota-owner','test-only')",
  )
})
afterEach(() => db.close())
const seed = (state: string) => {
  const id = `media_${crypto.randomUUID()}`
  db.prepare(
    "INSERT INTO cms_media(media_id,state,created_at,derivatives_json) VALUES(?,?,1,CASE WHEN ?='ready' THEN '{}' ELSE NULL END)",
  ).run(id, state, state)
  return id
}
const claim = () => {
  const op = crypto.randomUUID()
  db.prepare(
    "INSERT INTO cms_media_jobs VALUES(?,'upload',?,'quota-owner','','*','running',9999999999999,1)",
  ).run(op, `media_${op}`)
}

describe('0010 occupied-slot capacity in SQLite', () => {
  it('upgrades an exhausted lifetime library without deleting tombstones and restores admission', () => {
    for (let i = 0; i < 100; i++) seed('deleted')
    expect(claim).toThrow(/MEDIA_QUOTA/)
    const before = JSON.stringify(db.prepare('SELECT * FROM cms_media ORDER BY media_id').all())
    db.exec(upgrade)
    expect(db.prepare('SELECT * FROM cms_media_capacity').get()).toMatchObject({
      capacity_limit: 100,
      consumed: 0,
      includes_tombstones: 0,
    })
    expect(JSON.stringify(db.prepare('SELECT * FROM cms_media ORDER BY media_id').all())).toBe(
      before,
    )
    claim()
    expect(db.prepare('SELECT consumed FROM cms_media_capacity').get()).toMatchObject({
      consumed: 1,
    })
    expect(db.prepare('SELECT count(*) n FROM cms_media').get()).toMatchObject({ n: 101 })
  })
  it('counts all reservations until deleted, including rejected, deleting and interrupted processing', () => {
    for (const state of ['quarantined', 'processing', 'ready', 'rejected', 'deleting', 'deleted'])
      seed(state)
    db.exec(upgrade)
    expect(db.prepare('SELECT consumed FROM cms_media_capacity').get()).toMatchObject({
      consumed: 5,
    })
    expect(() => db.exec("DELETE FROM cms_media WHERE state='deleted'")).toThrow(/TOMBSTONE/)
  })
  it('still refuses the 101st occupied reservation atomically', () => {
    for (let i = 0; i < 100; i++) seed('rejected')
    db.exec(upgrade)
    expect(claim).toThrow(/MEDIA_QUOTA/)
    expect(db.prepare('SELECT count(*) n FROM cms_media_jobs').get()).toMatchObject({ n: 0 })
    expect(db.prepare('SELECT consumed FROM cms_media_capacity').get()).toMatchObject({
      consumed: 100,
    })
  })
  it('partial trigger replacement cannot silently admit or reserve an unguarded upload', () => {
    const parts = splitSql(upgrade)
    expect(parts).toHaveLength(3)
    db.exec(parts[0])
    expect(claim).toThrow()
    expect(db.prepare('SELECT count(*) n FROM cms_media_jobs').get()).toMatchObject({ n: 0 })
    expect(db.prepare('SELECT count(*) n FROM cms_media').get()).toMatchObject({ n: 0 })
    expect(
      db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='cms_media_capacity'").get(),
    ).toMatchObject({ n: 0 })
  })
})
