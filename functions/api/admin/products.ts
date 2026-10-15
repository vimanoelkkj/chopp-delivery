import { handleLegacyAdmin } from '../../../server/catalog-expansion/legacy'
export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  handleLegacyAdmin(request, env, 'products')
