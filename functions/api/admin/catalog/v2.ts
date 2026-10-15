import { handleExpandedCatalog } from '../../../../server/catalog-expansion/handlers'
export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  handleExpandedCatalog(request, env)
