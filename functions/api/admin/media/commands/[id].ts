import { handleMediaCommand } from '../../../../../server/cms/media-queries'
export const onRequest: PagesFunction<Env> = ({ request, env, params }) =>
  handleMediaCommand(request, env, String(params.id))
