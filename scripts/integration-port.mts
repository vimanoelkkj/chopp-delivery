/** Porta do servidor descartável local: uma regra só para o runner, o servidor e o navegador. */
export const DEFAULT_INTEGRATION_PORT = 4185

/**
 * Lê e VALIDA `DELEGAS_INTEGRATION_PORT` (vazio ou ausente = padrão 4185). Aceita só inteiros
 * decimais de 1024 a 65535; qualquer outra coisa lança, em vez de virar porta "parecida".
 */
export function integrationPort(
  value: string | undefined = process.env.DELEGAS_INTEGRATION_PORT,
): number {
  if (value === undefined || value === '') return DEFAULT_INTEGRATION_PORT
  const port = /^\d{1,5}$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(`DELEGAS_INTEGRATION_PORT inválida: ${JSON.stringify(value)} (use 1024-65535)`)
  return port
}
