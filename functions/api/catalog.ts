import { handlePublicCatalog } from '../../server/catalog-expansion/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  handlePublicCatalog(request, env.DELEGAS_DB)
