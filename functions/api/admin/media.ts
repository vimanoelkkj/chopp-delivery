import { handleLocalMedia } from '../../../server/cms/media-library'
export const onRequest: PagesFunction<Env> = ({ request, env }) => handleLocalMedia(request, env)
