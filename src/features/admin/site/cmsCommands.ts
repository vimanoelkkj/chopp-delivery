import type { CmsDocumentV2 } from '../../../../shared/cms/v2'
import { requireApiJson, requireF2SessionError } from '../httpResponse'
import {
  type CommandReceipt,
  type ConversionPreview,
  readCommandResult,
  readConversionPreview,
} from './siteModel'

/**
 * Cliente dos comandos do CMS v2 (`POST /api/admin/site/convert` e `GET /api/admin/site/commands/:id`).
 * Só reutiliza os endpoints existentes. Regras que esta camada garante:
 * - uma chamada, uma requisição: nunca reenvia por conta própria (quem decide é a tela, com o administrador);
 * - `If-Match` sempre igual à `expectedRevision`, como o contrato exige;
 * - toda falha vira uma categoria: o que a tela precisa saber é se a operação pode ter sido gravada.
 */

export type CommandInput =
  | { action: 'saveDraft'; expectedRevision: string; operationId: string; document: CmsDocumentV2 }
  | { action: 'previewConversion'; expectedRevision: string; operationId: string }
  | {
      action: 'convertToV2'
      expectedRevision: string
      operationId: string
      acknowledge?: string[]
    }
  | {
      action: 'startV2'
      expectedRevision: string
      operationId: string
      document: CmsDocumentV2
    }

export type Failure =
  /** 401: sessão inválida. */
  | { kind: 'expired' }
  /** 403: origem recusada pela proteção do servidor. */
  | { kind: 'forbidden' }
  /** O CMS v2 ainda não está disponível no servidor: nada foi gravado. */
  | { kind: 'unavailable' }
  /** 409: a revisão mudou, o documento já é v2 ou o estado não permite a operação. Nada foi gravado. */
  | { kind: 'conflict'; code: string }
  /** 409: este `operationId` já foi usado com outro comando. */
  | { kind: 'operation-conflict' }
  /** 409: faltou reconhecer uma perda da conversão. */
  | { kind: 'acknowledgement' }
  /** 400/428: o servidor recusou o comando. Nada foi gravado. */
  | { kind: 'invalid'; code?: string }
  /** Rede, tempo esgotado, 5xx ou resposta ilegível: a operação PODE ter sido gravada. */
  | { kind: 'unknown' }

export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: Failure }

const TIMEOUT_MS = 15000
const BODY_LIMIT = 250000

/** Uma requisição JSON com tempo limite; também usada pela biblioteca de mídia (`media/mediaApi.ts`). */
export async function send(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      ...init,
      redirect: 'error',
    })
    requireApiJson(response)
    const raw = await response.text()
    if (raw.length > BODY_LIMIT) throw new Error('ADMIN_RESPONSE_TOO_LARGE')
    const body: unknown = JSON.parse(raw)
    requireF2SessionError(response.status, body)
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

export const errorCode = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined
  const error = (body as { error: unknown }).error
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

/** Traduz status e código de erro do servidor para o que a tela precisa decidir. */
export function classify(status: number, body: unknown): Failure {
  const code = errorCode(body)
  if (status === 401) return { kind: 'expired' }
  if (status === 403) return { kind: 'forbidden' }
  if (status === 409) {
    if (code === 'CMS_OPERATION_CONFLICT') return { kind: 'operation-conflict' }
    if (code === 'CMS_ACKNOWLEDGEMENT_REQUIRED') return { kind: 'acknowledgement' }
    return { kind: 'conflict', code: code ?? 'CMS_REVISION_CONFLICT' }
  }
  if (status === 400 || status === 413 || status === 428) return { kind: 'invalid', code }
  // 503 com o esquema ainda indisponível é certeza de que nada foi gravado; os demais 5xx
  // (inclusive CMS_WRITE_INCOMPLETE) deixam o desfecho em aberto.
  if (status === 503 && code === 'CMS_SCHEMA_UNAVAILABLE') return { kind: 'unavailable' }
  return { kind: 'unknown' }
}

function bodyOf(input: CommandInput) {
  return {
    action: input.action,
    expectedRevision: input.expectedRevision,
    operationId: input.operationId,
    ...(input.action === 'convertToV2' && input.acknowledge
      ? { acknowledge: input.acknowledge }
      : {}),
    ...(input.action === 'startV2' || input.action === 'saveDraft'
      ? { document: input.document }
      : {}),
  }
}

async function post(input: CommandInput) {
  // Salvar rascunho usa o endpoint próprio do contrato (PUT); os demais comandos, o de conversão.
  const save = input.action === 'saveDraft'
  return send(save ? '/api/admin/site/draft' : '/api/admin/site/convert', {
    method: save ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': `"${input.expectedRevision}"` },
    body: JSON.stringify(bodyOf(input)),
  })
}

/** Prévia da conversão v1 para v2. Não escreve nada: só calcula e responde. */
export async function previewConversion(
  expectedRevision: string,
  operationId: string,
): Promise<Outcome<ConversionPreview>> {
  try {
    const { status, body } = await post({
      action: 'previewConversion',
      expectedRevision,
      operationId,
    })
    if (status !== 200) return { ok: false, failure: classify(status, body) }
    return { ok: true, value: readConversionPreview(body) }
  } catch {
    return { ok: false, failure: { kind: 'unknown' } }
  }
}

/** `startV2`, `convertToV2` ou `saveDraft`: escrita. Uma só tentativa; o desfecho incerto é tratado por quem chama. */
export async function runCommand(
  input: Exclude<CommandInput, { action: 'previewConversion' }>,
): Promise<Outcome<CommandReceipt>> {
  try {
    const { status, body } = await post(input)
    if (status !== 200) return { ok: false, failure: classify(status, body) }
    return { ok: true, value: readCommandResult(body) }
  } catch {
    // Rede, tempo esgotado ou recibo ilegível: o servidor pode ter gravado.
    return { ok: false, failure: { kind: 'unknown' } }
  }
}

/**
 * Consulta o recibo de uma operação pelo `operationId` (somente leitura). `value: null` quer dizer que o
 * recibo não estava disponível nessa leitura (404). O POST ainda pode estar em andamento;
 * isso não confirma ausência de gravação nem libera uma nova tentativa.
 */
export async function fetchReceipt(operationId: string): Promise<Outcome<CommandReceipt | null>> {
  try {
    const { status, body } = await send(`/api/admin/site/commands/${operationId}`, {
      method: 'GET',
    })
    if (status === 404) return { ok: true, value: null }
    if (status !== 200) return { ok: false, failure: classify(status, body) }
    return { ok: true, value: readCommandResult(body) }
  } catch {
    return { ok: false, failure: { kind: 'unknown' } }
  }
}
