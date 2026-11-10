import { handleCatalogMedia } from '../../../../../server/catalog-media/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env, params }) =>
  handleCatalogMedia(request, env, String(params.itemId))
