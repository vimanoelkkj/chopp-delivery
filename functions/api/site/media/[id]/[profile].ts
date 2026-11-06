import { handlePublicMedia } from '../../../../../server/cms/public-media'
export const onRequest: PagesFunction<Env> = ({ request, env, params }) =>
  handlePublicMedia(request, env, params.id, params.profile)
