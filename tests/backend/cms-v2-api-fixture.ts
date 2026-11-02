import { type AuthEnv, wrongMethod } from '../../server/auth/http'
import * as handlers from '../../server/cms/handlers'
import { TEST_ORIGIN } from './auth-fixture'
import { cmsV2Fixture } from './cms-v2-sql-fixture'

// Heterogeneous success/error JSON is asserted at each call site.
type TestResponse = Omit<Response, 'json'> & { json(): Promise<Record<string, any>> }
export async function cp3Fixture(options: Parameters<typeof cmsV2Fixture>[0] = {}) {
  const f = await cmsV2Fixture(options)
  const send = (
    method: string,
    path: string,
    body?: unknown,
    revision?: string,
    headers: Record<string, string> = {},
    env: AuthEnv = f.env,
  ) => {
    const request = new Request(TEST_ORIGIN + path, {
      method,
      headers: {
        Cookie: f.base.cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
        ...(revision ? { 'If-Match': `"${revision}"` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (path.endsWith('/convert')) {
      const fn = (handlers as unknown as Record<string, unknown>).handleCmsConvert as
        | ((request: Request, env: AuthEnv) => Promise<Response>)
        | undefined
      return fn ? fn(request, env) : Promise.resolve(wrongMethod(request, 'GET, PUT'))
    }
    if (path.includes('/commands/'))
      return handlers.handleCmsCommand(request, env, path.split('/').at(-1))
    return path.endsWith('/draft')
      ? handlers.handleCmsDraft(request, env)
      : handlers.handleCmsSite(request, env)
  }
  const call = (...args: Parameters<typeof send>) => send(...args) as Promise<TestResponse>
  const intent = (action = 'convertToV2', expectedRevision = f.base.last.command.revision) => ({
    action,
    expectedRevision,
    operationId: crypto.randomUUID(),
  })
  const convert = async () => {
    const input = intent()
    const response = await call('POST', '/api/admin/site/convert', input, input.expectedRevision)
    return { input, response, result: await response.json() }
  }
  return { ...f, call, intent, convert }
}
export const site = '/api/admin/site',
  draft = site + '/draft',
  conversion = site + '/convert'
