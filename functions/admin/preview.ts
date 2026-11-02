import { handlePreviewPage } from '../../server/cms/preview-page'
export const onRequest: PagesFunction<Env> = (context) =>
  handlePreviewPage(context.request, context.env, () => context.next())
