import { handlePublicCms } from '../../server/cms/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env }) => handlePublicCms(request, env)
