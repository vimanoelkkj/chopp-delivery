import { handleMe } from '../../../server/auth/handlers'

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleMe(request, env)
