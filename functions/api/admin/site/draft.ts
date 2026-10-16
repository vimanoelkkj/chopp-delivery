import { handleCmsDraft } from '../../../../server/cms/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env }) => handleCmsDraft(request, env)
