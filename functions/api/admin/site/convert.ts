import { handleCmsConvert } from '../../../../server/cms/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env }) => handleCmsConvert(request, env)
