import type { CmsDocumentV2 } from '../../../../../shared/cms/v2'
import type { MediaCapacity, MediaFailure, MediaItem } from './mediaApi'

/**
 * Regras da biblioteca de imagens (M2B): modelo puro, sem rede e sem DOM.
 * Os limites espelham `MEDIA_LIMITS` do servidor (um teste confere); o servidor continua sendo a
 * autoridade. Validar aqui evita tentativas recusadas que podem reservar capacidade até a limpeza.
 */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

export const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp'
export const MEDIA_UPLOAD_LIMITS = {
  bytes: 5 * 1024 * 1024,
  dimension: 6000,
  pixels: 12_000_000,
} as const
export const MEDIA_PAGE_SIZE = 12

/** O que a tela diz sobre formato e tamanho, na mesma frase em todo lugar. */
export const UPLOAD_RULES =
  'PNG, JPEG ou WebP, até 5 MB (no máximo 6000 px por lado e 12 megapixels). Um envio pode ocupar uma vaga até a exclusão concluída, mesmo se for recusado.'

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '').replace('.', ',')
  return `${mb} MB`
}

/** Formato real do arquivo pelos primeiros bytes (não confia no nome nem no tipo informado). */
export function sniffImage(head: Uint8Array): ImageMime | null {
  const at = (index: number, ...bytes: number[]) => bytes.every((b, i) => head[index + i] === b)
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

export type Preflight = { ok: true; mime: ImageMime } | { ok: false; message: string }

/** Confere nome/tipo/tamanho/assinatura antes de qualquer envio. */
export function preflightFile(file: { size: number; type: string }, head: Uint8Array): Preflight {
  if (file.size === 0) return { ok: false, message: 'O arquivo está vazio.' }
  if (file.size > MEDIA_UPLOAD_LIMITS.bytes)
    return {
      ok: false,
      message: `O arquivo tem ${formatBytes(file.size)}; o limite é ${formatBytes(MEDIA_UPLOAD_LIMITS.bytes)}.`,
    }
  const sniffed = sniffImage(head)
  const accepted = ['image/png', 'image/jpeg', 'image/webp']
  if (file.type !== '' && !accepted.includes(file.type))
    return { ok: false, message: 'Formato não aceito. Use PNG, JPEG ou WebP.' }
  if (!sniffed || (file.type !== '' && sniffed !== file.type))
    return {
      ok: false,
      message: 'O conteúdo do arquivo não é um PNG, JPEG ou WebP válido. Escolha outra imagem.',
    }
  return { ok: true, mime: sniffed }
}

/** Dimensões lidas no navegador; `null` quando está tudo dentro do limite. */
export function dimensionProblem(width: number, height: number): string | null {
  const { dimension, pixels } = MEDIA_UPLOAD_LIMITS
  if (width > dimension || height > dimension)
    return `A imagem tem ${width} × ${height} px; o máximo é ${dimension} px de largura ou altura.`
  if (width * height > pixels)
    return `A imagem tem ${((width * height) / 1_000_000).toFixed(1).replace('.', ',')} megapixels; o máximo é 12.`
  return null
}

// ---------------------------------------------------------------------------------------------
// Cota e miniaturas
// ---------------------------------------------------------------------------------------------

export type CapacityView = {
  used: string
  remaining: string
  level: 'ok' | 'low' | 'full'
  note: string
}

export function capacityView(capacity: MediaCapacity): CapacityView {
  const level = capacity.remaining === 0 ? 'full' : capacity.remaining <= 10 ? 'low' : 'ok'
  return {
    used: `${capacity.consumed} de ${capacity.limit} registros usados`,
    remaining:
      capacity.remaining === 0
        ? 'Nenhum envio restante'
        : `${capacity.remaining} ${capacity.remaining === 1 ? 'envio restante' : 'envios restantes'}`,
    level,
    note: capacity.includesTombstones
      ? 'Cota vitalícia: este banco ainda conta imagens apagadas e recusadas.'
      : 'Capacidade reutilizável: exclusões concluídas liberam vagas. Imagens recusadas aguardam limpeza; referências históricas continuam protegidas.',
  }
}

/** Resultado do carregamento da miniatura (a entrega do arquivo verifica ambos os perfis). */
export type ThumbState = 'loading' | 'ready' | 'failed'

/** CSS cover crops only when the scaled, delivered derivative exceeds its actual frame. */
export function frameCrops(
  fit: 'contain' | 'cover',
  frame: { width: number; height: number } | null,
  image: { width: number; height: number } | null,
): boolean | null {
  if (
    !frame ||
    !image ||
    ![frame.width, frame.height, image.width, image.height].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return null
  if (fit === 'contain') return false
  const scale = Math.max(frame.width / image.width, frame.height / image.height)
  // Ignore subpixel overflow from responsive sizing and the sample frame's border.
  return image.width * scale - frame.width > 1 || image.height * scale - frame.height > 1
}
export type TileView = { label: string; selectable: boolean; tone: 'ok' | 'wait' | 'bad' }

/**
 * Uma imagem só pode ser escolhida se o servidor a entregou de fato: `ready` na listagem não prova
 * que os arquivos existem e estão íntegros. Enquanto não carregar, ou se falhar, ela não é selecionável.
 */
export function tileView(item: MediaItem, thumb: ThumbState): TileView {
  switch (item.state) {
    case 'ready':
      if (thumb === 'ready') return { label: 'Pronta', selectable: true, tone: 'ok' }
      if (thumb === 'loading') return { label: 'Verificando…', selectable: false, tone: 'wait' }
      return { label: 'Indisponível', selectable: false, tone: 'bad' }
    case 'processing':
    case 'quarantined':
      return { label: 'Processando', selectable: false, tone: 'wait' }
    case 'rejected':
      return { label: 'Recusada', selectable: false, tone: 'bad' }
    case 'deleting':
      return { label: 'Em exclusão', selectable: false, tone: 'bad' }
    case 'deleted':
      return { label: 'Excluída', selectable: false, tone: 'bad' }
  }
}

/** Identificação curta e estável de uma imagem (a biblioteca não guarda nome de arquivo). */
export const shortId = (id: string) => id.slice(6, 14)

/** IDs de mídia referenciados pelo documento (para marcar "em uso" na biblioteca). */
export function usedMediaIds(doc: CmsDocumentV2): Set<string> {
  const ids = new Set<string>()
  for (const module of doc.modules) {
    const content = module.content as { media?: { id: string } | null; entries?: unknown }
    if (content.media) ids.add(content.media.id)
    if (Array.isArray(content.entries))
      for (const entry of content.entries as { media?: { id: string } | null }[])
        if (entry.media) ids.add(entry.media.id)
  }
  return ids
}

// ---------------------------------------------------------------------------------------------
// Textos de falha: sempre dizem se algo foi enviado e o que dá para fazer
// ---------------------------------------------------------------------------------------------

export type Message = { title: string; text: string }

export function listFailureText(failure: MediaFailure): Message {
  switch (failure.kind) {
    case 'unsupported':
      return {
        title: 'A biblioteca de imagens não está disponível aqui',
        text: 'Este ambiente não tem armazenamento de imagens ativado. O texto da página continua editável e nada foi alterado.',
      }
    case 'forbidden':
      return {
        title: 'Pedido recusado pelo servidor',
        text: 'O servidor não aceitou a origem do pedido. Nada foi alterado.',
      }
    default:
      return {
        title: 'Não foi possível carregar a biblioteca',
        text: 'Nada foi alterado. Tente de novo em instantes.',
      }
  }
}

export function uploadFailureText(failure: MediaFailure): Message {
  switch (failure.kind) {
    case 'invalid':
      return {
        title: 'O servidor recusou a imagem',
        text: 'Ela não é um PNG, JPEG ou WebP aceito, ou passa dos limites de dimensão. O registro desta tentativa pode ter consumido a cota. Escolha outra imagem.',
      }
    case 'too-large':
      return {
        title: 'Imagem grande demais',
        text: `O limite é ${formatBytes(MEDIA_UPLOAD_LIMITS.bytes)}. Nada utilizável foi criado. Escolha uma imagem menor.`,
      }
    case 'quota':
      return {
        title: 'A cota de imagens acabou',
        text: 'Não dá para enviar novas imagens enquanto a capacidade estiver ocupada. Imagens sem referências podem liberar vagas após a exclusão concluída. As já enviadas continuam disponíveis para escolher.',
      }
    case 'busy':
      return {
        title: 'Outro envio está em andamento',
        text: 'Aguarde alguns segundos e escolha o arquivo de novo. Nenhuma imagem desta tentativa foi criada.',
      }
    case 'failed-record':
      return {
        title: 'O servidor não conseguiu processar a imagem',
        text: 'A tentativa ficou registrada como falha e pode ter consumido um registro da cota. Escolha o arquivo de novo para fazer um novo envio.',
      }
    case 'forbidden':
      return {
        title: 'Pedido recusado pelo servidor',
        text: 'O servidor não aceitou a origem do pedido. Nenhuma imagem foi criada.',
      }
    case 'unsupported':
      return {
        title: 'A biblioteca de imagens não está disponível aqui',
        text: 'Este ambiente não recebe imagens. Nada foi enviado.',
      }
    case 'expired':
      return { title: 'Sessão expirada', text: 'Entre de novo para continuar.' }
    case 'unknown':
      return {
        title: 'Não conseguimos confirmar o envio',
        text: 'A conexão falhou antes da resposta. A imagem pode ter sido recebida. Um recibo ausente não prova que o envio falhou.',
      }
  }
}

/** Texto da imagem escolhida quando ela não pode ser exibida. */
export const SELECTED_UNAVAILABLE =
  'Esta imagem não está disponível agora: pode ter sido excluída, ainda estar em processamento ou estar corrompida. A associação continua no rascunho; a prévia mostrará um espaço reservado.'
