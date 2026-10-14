import { handleLogin } from '../../../server/auth/handlers'

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleLogin(request, env)
