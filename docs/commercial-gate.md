# Gate comercial local

- `npm run validate:commercial`: valida a configuração resolvida, sem gerar artefatos.
- `npm run build:commercial`: typecheck, build em modo `release` com o mesmo gate e auditoria existente do artefato. Saída: `dist-commercial/`, separada de `dist-release/` usado na homologação. Relatório fora da pasta publicável: `dist-commercial.audit.json`. Qualquer saída não zero reprova o candidato.

Obrigatório: `VITE_WHATSAPP_NUMBER` já normalizado pelo fluxo existente, somente dígitos com país. O valor precisa ser igual ao retorno de `normalizeWhatsAppNumber`. Exemplos de `.env.example` e fixtures CMS, além de sequências inteiramente repetidas, são rejeitados. Máscaras, números nacionais sem país e placeholders não são configurações comerciais aceitas.

O gate lê o `define` final de `import.meta.env.VITE_WHATSAPP_NUMBER` resolvido pelo próprio Vite, não um `.env` genérico. A configuração de release existente usa `.env`, `.env.local`, `.env.release`, `.env.release.local`, com prioridade das variáveis do processo. `.env.homologation` não configura o candidato comercial. O gate também exige modo release/produção e reutiliza a auditoria estrutural e de integridade do release. Nenhum gate é adicionado a dev, previews, build normal ou `build:release`.

Nenhuma configuração comercial adicional de build possui contrato obrigatório definido. Catálogo e contato publicado pelo CMS são dados de runtime e não são consultados nem certificados por este comando. A aprovação humana deve confirmar titularidade/atividade da conta WhatsApp, destino publicado no CMS (que prevalece sobre o fallback do build), preços, disponibilidade e condições comerciais. O normalizador atual não confirma DDD, operadora, existência de conta ou recebimento de pedidos; um PASS técnico não substitui essa aprovação. Não publique arquivos de ambiente nem o relatório auxiliar.
