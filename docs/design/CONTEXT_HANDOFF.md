# CHOPP DELIVERY | CONTEXTO DE CONTINUIDADE (HANDOFF V1)
> **Data:** 29 de Outubro de 2026  
> **Status:** Fases 1 (Discovery), 2 (Design Exploration) e 3 (Visual Review) Concluídas. Pronto para Fase 4/5.  
> **Repositório:** `vimanoelkkj/chopp-delivery`

---

## 1. Resumo do Trabalho Realizado

Atuando como equipe multidisciplinar (Art Director, UI/UX Designer, Creative Frontend Engineer e Especialista em Acessibilidade/Performance), desenvolvemos a proposta de redesign completa:

1. **Auditoria Técnica (Etapa Zero):**
   - Repositório React 19 + Vite 8 + TypeScript 7 + Biome + Cloudflare Pages Functions + Cloudflare D1 (`DELEGAS_DB`).
   - Mapeamento e preservação de todas as tabelas do CMS Modular (`catalog_categories`, `catalog_items`, `catalog_variants`) e do contrato HTTP v2 (`/api/admin/catalog/v2`).
   - Correção obrigatória de regra comercial: **a operação é 100% por entrega e instalação** em São João del-Rei e região (nenhuma retirada).
   - Os produtos protagonistas absolutos são **BARRIS DE CHOPP EM AÇO INOX** (30L e 50L), substituindo copos/tulipas na vitrine.
   - Dados de preços e chopes reais preservados (Dronken, Palato Beber, Villa Alemã, Krug Bier, Brahma, Kaiser, Heineken, Chopp de Vinho e Cachaça Artesanal).

2. **Elemento Assinatura - Carrossel 3D de Barris:**
   - Decisão arquitetural fundamentada: **CSS 3D puro** (`perspective: 1200px`, `transform-style: preserve-3d`), garantindo 60-120 FPS em mobile, zero dependências externas (sem Three.js) e suporte a `prefers-reduced-motion`.
   - Barril central com escala 1.0, e laterais com escala 0.8, rotação física de 22° e profundidade Z.

3. **Conceitos Visuais Desenvolvidos:**
   - **Conceito C: IMMERSIVE HYBRID (Prioridade Criativa e Recomendada):** Equilíbrio cinematográfico da MOVA Brewery com arquitetura comercial da BrewDog e produto minimalista da Corona.
   - **Conceito A: DARK CINEMATIC:** Foco em atmosfera escura densa (#101713) e direção editorial de arte.
   - **Conceito B: PREMIUM COMMERCE:** Foco em navegação ultrarrápida, cards com seletor de litragem e conversão direta via WhatsApp.
   - **Página de Produto (PDP):** Ficha técnica completa de barril, cálculo de copos (60 vs 100 copos) e indicação de chopeira/CO2 inclusos.

---

## 2. Inventário de Arquivos do Design

Todos os artefatos visuais e documentação técnica estão organizados na pasta `docs/design/`:

- `docs/design/chopp_redesign_studio.html`: Laboratório interativo completo. Permite navegar nos 3 conceitos, na PDP, testar redimensionamento responsivo (1440px, 1280px, 768px, 390px) e girar o carrossel 3D.
- `docs/design/carousel_3d_widget.html`: Widget interativo compacto do carrossel 3D.
- `docs/design/chopp_delivery_redesign_v1.md`: Relatório executivo completo com justificativas de UX, matriz comparativa e tokens WCAG 2.1 AA.
- `docs/design/craft_beer_keg_hero_1793303975353.jpg`: Fotografia de estúdio em alta resolução do barril 50L protagonista.
- `docs/design/barril_chopp_30l_studio_1793304022404.jpg`: Fotografia de estúdio do barril 30L.

---

## 3. Como Continuar em Casa (Passo a Passo)

### Opção 1: Via Git (Recomendado)
Antes de sair do computador atual, envie os novos arquivos de design para o seu repositório no GitHub:

```powershell
# No terminal do computador atual (em C:\Users\vitormanoel\dev\chopp-delivery):
git status
git checkout -b design/premium-experience-v1
git add docs/design
git commit -m "docs(design): add high-fidelity v1 redesign studio, 3d carousel and specs"
git push -u origin design/premium-experience-v1
```

Quando chegar em casa:
```powershell
# No computador de casa:
git clone https://github.com/vimanoelkkj/chopp-delivery.git
cd chopp-delivery
git checkout design/premium-experience-v1
```

---

## 4. Prompt de Continuidade para o Antigravity em Casa

Ao abrir o Antigravity em casa no repositório `chopp-delivery`, basta colar o seguinte prompt no chat:

```text
Olá! Estou continuando o projeto Chopp Delivery Redesign V1.
Por favor, leia o arquivo 'docs/design/CONTEXT_HANDOFF.md' e o relatório 'docs/design/chopp_delivery_redesign_v1.md' para carregar todo o contexto anterior.

O Conceito C (Immersive Hybrid) foi o escolhido, com o Carrossel 3D de Barris em CSS 3D.
Estamos prontos para a Fase 5 (Design System e Componentização dos novos módulos no frontend).
Como devemos proceder para iniciar a implementação dos componentes?
```

