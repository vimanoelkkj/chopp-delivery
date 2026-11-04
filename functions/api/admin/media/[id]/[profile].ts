import { handleMediaBytes } from '../../../../../server/cms/media-queries'
export const onRequest: PagesFunction<Env> = ({ request, env, params }) =>
  handleMediaBytes(request, env, String(params.id), String(params.profile))
