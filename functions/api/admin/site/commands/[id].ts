import { handleCmsCommand } from '../../../../../server/cms/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env, params }) =>
  handleCmsCommand(request, env, params.id)
