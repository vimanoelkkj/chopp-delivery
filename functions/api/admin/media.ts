import { handleLocalMedia } from '../../../server/cms/media-library'
import { handleMediaList } from '../../../server/cms/media-queries'
export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  request.method === 'GET' ? handleMediaList(request, env) : handleLocalMedia(request, env)
