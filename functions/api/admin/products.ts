import { handleAdminList } from '../../../server/admin-catalog/handlers'

export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  handleAdminList(request, env, 'products')
