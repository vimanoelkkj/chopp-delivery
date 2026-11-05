import { readFileSync } from 'node:fs'

// Same source as the private remote Worker; Miniflare supplies the offline Images backend.
export const localImageWorker = readFileSync(
  new URL('../server/cms/image-worker.mjs', import.meta.url),
  'utf8',
)
