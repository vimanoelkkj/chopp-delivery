import { handleLocalMedia } from '../../../../server/cms/media-library'
export const onRequest: PagesFunction<Env> = ({ request, env, params }) =>
  handleLocalMedia(request, env, String(params.id))
