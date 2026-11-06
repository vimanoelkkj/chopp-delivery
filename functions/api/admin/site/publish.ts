import { handleCmsPublish } from '../../../../server/cms/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env }) => handleCmsPublish(request, env)
