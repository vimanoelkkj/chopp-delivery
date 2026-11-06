# CMS Fase 3B — integração visual de mídia publicada (implementação local)

Somente local. Nenhuma mudança em backend, banco, migrations, Workers, gates ou secrets. `/api/site` e `/api/catalog` inalterados.

## O que foi integrado

- `src/shared/ui/PublishedMedia.tsx`: imagem editorial sobre o asset local. URL só via `publicMediaPath`; ID validado com `cmsMediaId` antes de qualquer requisição.
- Hero (`media` do módulo hero, perfil `hero`, `object-fit: contain`) e Sobre (`media` do módulo about, perfil `section`, `object-fit: cover`). São as únicas seções que já tinham imagem.
- A mídia chega ao componente pela prop explícita `publishedMedia`, passada só por `LandingPage` e `EditorialSections`. O preview administrativo não a passa, portanto nunca consulta o endpoint público (nada de rascunho).

## Fallback

O asset local (`KegCutout`) fica montado até o evento `load` da imagem publicada. A imagem entra invisível (`opacity: 0`, `alt=""`, `aria-hidden`), absoluta sobre o palco que já tem altura definida: sem mudança de layout e sem quadro vazio. No `load` o fallback sai e a imagem passa a ser exposta com o `alt` editorial, no mesmo commit (sem animação, compatível com `prefers-reduced-motion`). Em `error` (404/5xx/rede/corpo inválido) a imagem é removida e o fallback permanece. Sem mídia, ID ausente/inválido ou publicação ausente: apenas o fallback, DOM idêntico ao anterior. Trocar a publicação muda o `key` e reinicia o estado. Sem cache manual: a revalidação é do endpoint (`no-cache` + ETag).

## Ajustes de texto/atributos

- Removido `data-editorial-media="fallback"` (marcador da Fase 2 que passaria a ser falso) e atualizada a frase do `role=status` quando há publicação.

## Pendências

- `carousel.media`, `barrels.media` e `highlight.media` continuam sem papel visual e não são consumidos.
- Gestão no painel: não existe ação de despublicar/revogar mídia, nem pré-visualização do enquadramento `cover`/`contain` por perfil; o editor não valida proporção da imagem original contra o palco (hero: palco horizontal, imagem `contain`; sobre: `cover` recorta).
- O baseline de pixels `e2e/cms-editorial-sections.spec.ts-snapshots` está desatualizado desde fases anteriores (parágrafo de status da Fase 2 e rótulo "Indisponível") e precisa ser regenerado por decisão do responsável.
