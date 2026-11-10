import { handleCatalogMedia } from '../../../../server/catalog-media/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env }) => handleCatalogMedia(request, env)
