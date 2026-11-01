import { handleCmsSite } from '../../../server/cms/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env }) => handleCmsSite(request, env)
