import { handleLogout } from '../../../server/auth/handlers'

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleLogout(request, env)
