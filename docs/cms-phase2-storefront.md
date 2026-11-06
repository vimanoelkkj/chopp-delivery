# CMS v2 — integração pública da vitrine

A homepage consulta somente `GET /api/site`, com credenciais restritas à mesma origem para respeitar o Access da homologação privada e sem seguir redirecionamentos. A projeção pública é validada com o contrato CMS v2 existente; envelopes administrativos, campos comerciais extras, visibilidade e anchors arbitrários são recusados. Loading, ausência (`CMS_NOT_PUBLISHED`) e erro mantêm a apresentação padrão, com estado acessível anunciado sem mudar o layout. Não há busca de rascunho ou reenvio automático.

O CMS fornece textos, composição, navegação, região editorial e destino WhatsApp publicado. `/api/catalog` continua sendo a única origem de produtos, preços, volumes e disponibilidade. A seleção editorial do carrossel usa apenas `itemId`; a tabela mantém o catálogo completo. Alterações posteriores de visibilidade comercial prevalecem sobre a seleção publicada.

Referências `media: {id, alt}` são validadas, mas não são convertidas em URLs. Hero, carrossel e seções conservam os assets locais aprovados. `carousel.media` permanece sem representação visual definida, conforme o contrato atual. Os estados editoriais não interrompem o catálogo e os botões existentes.

## Contrato mínimo para a Fase 3

- Definir um resolvedor de entrega pública por ID e perfil (`hero`/`section`), limitado às referências da versão efetivamente publicada; rascunhos e objetos órfãos nunca autorizam entrega.
- Entregar bytes verificados com MIME, dimensões, tamanho e integridade compatíveis com os perfis existentes; definir cache/revisão e comportamento de erro. Não devolver chaves R2, manifestos, URLs privadas ou cookies administrativos.
- No consumidor, aceitar apenas o recurso público autorizado e preservar o asset local em ausência/erro. Usar o alt editorial somente para a imagem editorial correspondente.
- Decidir separadamente a representação de `carousel.media`. Não alterar bucket, gates, processamento ou rotas privadas para viabilizar esta fase.

Nenhum endpoint de mídia pública foi criado. A biblioteca remota continua desabilitada. A integração da vitrine não demonstra prontidão de produção.
