import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { Miniflare } from 'miniflare'
import { bootstrapOwner } from '../server/auth/bootstrap.ts'
import { authConfig, normalizeUsername } from '../server/auth/http.ts'
import { randomToken } from '../server/auth/password.ts'

class BootstrapError extends Error {}

function hiddenPassword(prompt) {
  return new Promise((accept, reject) => {
    const characters = []
    const finish = (error) => {
      process.stdin.removeListener('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else accept(characters.join(''))
    }
    const onData = (chunk) => {
      if (chunk.includes('\u001b')) return
      for (const char of chunk) {
        if (char === '\u0003') return finish(new BootstrapError('Bootstrap cancelado.'))
        if (char === '\r' || char === '\n') return finish()
        if (char === '\u007f' || char === '\b') characters.pop()
        else if (char >= ' ') characters.push(char)
        if (characters.length > 128)
          return finish(new BootstrapError('Senha excede 128 caracteres.'))
      }
    }
    process.stdout.write(prompt)
    process.stdin.setEncoding('utf8')
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

function readSettings(text) {
  const settings = {}
  for (const name of ['ADMIN_ORIGIN', 'ADMIN_ALLOW_INSECURE_LOCAL', 'ADMIN_PASSWORD_PEPPER']) {
    const matches = [...text.matchAll(new RegExp(`^${name}=(.*)$`, 'gm'))]
    if (matches.length !== 1)
      throw new BootstrapError(
        'A configuração .dev.vars está incompleta ou duplicada; nada foi sobrescrito.',
      )
    const raw = matches[0][1].trim()
    settings[name] = raw.startsWith('"') ? JSON.parse(raw) : raw
  }
  return settings
}

async function main() {
  const { values } = parseArgs({
    options: {
      local: { type: 'boolean' },
      origin: { type: 'string', default: 'http://127.0.0.1:8788' },
    },
    allowPositionals: false,
  })
  const origin = new URL(values.origin)
  if (
    !values.local ||
    origin.origin !== values.origin ||
    origin.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(origin.hostname)
  ) {
    throw new BootstrapError('Bootstrap permitido somente com --local e origem HTTP de loopback.')
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new BootstrapError(
      'Use um terminal interativo; senhas não são aceitas em argumentos ou pipes.',
    )
  const wrangler = JSON.parse(await readFile('wrangler.jsonc', 'utf8'))
  const binding = wrangler.d1_databases.find((database) => database.binding === 'DELEGAS_DB')
  if (
    binding?.database_id !== 'delegas-local-only' ||
    binding?.preview_database_id !== 'DELEGAS_DB'
  ) {
    throw new BootstrapError('Binding local do Delegas divergente; bootstrap recusado.')
  }
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("local bootstrap") } }',
    compatibilityDate: wrangler.compatibility_date,
    d1Databases: { DELEGAS_DB: binding.preview_database_id },
    d1Persist: resolve('.wrangler/state/v3/d1'),
  })
  try {
    const db = await runtime.getD1Database('DELEGAS_DB')
    if (await db.prepare('SELECT id FROM admin_users LIMIT 1').first())
      throw new BootstrapError('A conta proprietária já existe; nada foi alterado.')
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    const username = normalizeUsername(
      await prompt.question('Identificador do proprietário (3–64 caracteres): '),
    )
    prompt.close()
    const password = await hiddenPassword('Senha (15–128 caracteres; entrada oculta): ')
    const confirmation = await hiddenPassword('Repita a senha (entrada oculta): ')
    if (password !== confirmation) throw new BootstrapError('As senhas não coincidem.')
    if (
      username === null ||
      [...password].length < 15 ||
      new TextEncoder().encode(password).length > 512
    )
      throw new BootstrapError('Identificador ou política de senha inválidos.')
    let settings
    try {
      settings = readSettings(await readFile('.dev.vars', 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const content = `ADMIN_ORIGIN=${origin.origin}\nADMIN_ALLOW_INSECURE_LOCAL=1\nADMIN_PASSWORD_PEPPER=${randomToken()}\n`
      try {
        await writeFile('.dev.vars', content, { flag: 'wx', mode: 0o600 })
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError
      }
      settings = readSettings(await readFile('.dev.vars', 'utf8'))
    }
    const config = authConfig(new Request(`${origin.origin}/api/auth/login`), settings)
    if (!config.local) throw new BootstrapError('Configuração de bootstrap deve ser local.')
    if (!(await bootstrapOwner(db, username, password, config.pepper)))
      throw new BootstrapError('Outra execução já criou a conta; nada foi sobrescrito.')
    process.stdout.write(
      'Conta proprietária criada somente no D1 local. Nenhuma credencial foi exibida.\n',
    )
  } finally {
    await runtime.dispose()
  }
}

main().catch((error) => {
  console.error(
    error instanceof BootstrapError
      ? error.message
      : 'Bootstrap não executado. Verifique migrations e configuração local; nenhum detalhe interno foi registrado.',
  )
  process.exitCode = 1
})
