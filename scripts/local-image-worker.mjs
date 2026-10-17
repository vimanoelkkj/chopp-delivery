// Private Miniflare Worker only. The emulator implements Images using native host code.
// No deployment configuration, public route, cache, URL fetch or source persistence.
export const localImageWorker = `export default {
  async fetch(request, env) {
    try {
      const profile = new URL(request.url).pathname;
      const bounds = profile === '/hero' ? [1920,1080] : profile === '/section' ? [1200,900] : null;
      if (request.method !== 'POST' || !bounds) return new Response(null,{status:404});
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 5242880) return new Response(null,{status:413});
      const source = () => new Blob([bytes]).stream();
      const info = await env.IMAGES.info(source());
      if (!['image/jpeg','image/png','image/webp'].includes(info.format) ||
          info.width < 1 || info.height < 1 || info.width > 6000 || info.height > 6000 ||
          info.width * info.height > 12000000)
        return new Response(null,{status:422});
      return (await env.IMAGES.input(source()).transform({
        width: bounds[0], height: bounds[1], fit:'scale-down',
      }).output({format:'image/webp',quality:82})).response();
    } catch { return new Response(null,{status:422}); }
  }
}`
