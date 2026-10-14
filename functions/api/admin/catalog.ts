import { handleCatalog } from '../../../server/admin-catalog/catalog-handler'

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleCatalog(request, env)
