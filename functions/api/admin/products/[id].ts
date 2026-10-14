import { handleAdminPatch } from '../../../../server/admin-catalog/handlers'

export const onRequest: PagesFunction<Env> = ({ request, env, params }) =>
  handleAdminPatch(request, env, 'products', params.id)
