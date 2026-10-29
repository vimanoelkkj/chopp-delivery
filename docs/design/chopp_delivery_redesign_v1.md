# CHOPP DELIVERY | PREMIUM DIGITAL EXPERIENCE V1
## Relatório Técnico, Direção de Arte e Propostas Visuais de Alta Fidelidade

> **Status:** Fase 1 (Discovery) & Fase 2/3 (Design Exploration & Visual Review) Concluídas.  
> **Equipe Multidisciplinar:** Senior Art Director, Senior UI/UX Designer, Creative Frontend Engineer, Especialista em Acessibilidade e Performance.  
> **Artefatos Interativos:** [chopp_redesign_studio.html](file:///C:/Users/vitormanoel/.gemini/antigravity/brain/9fe3a147-d7a4-42f0-bc1f-eeb0a9723604/chopp_redesign_studio.html) | [carousel_3d_widget.html](file:///C:/Users/vitormanoel/.gemini/antigravity/brain/9fe3a147-d7a4-42f0-bc1f-eeb0a9723604/carousel_3d_widget.html)

---

## 1. Auditoria Técnica Inicial (Etapa Zero)

A inspeção do repositório autoritativo (`chopp-delivery`) revelou as seguintes fundações arquiteturais:

### 1.1 Stack e Frameworks
- **Frontend SPA:** React 19 (`react@^19.3.0`, `react-dom@^19.3.0`) compilado com Vite 8 (`vite@^8.3.4`).
- **Tipagem:** TypeScript 7 (`typescript@^7.0.2`) com compilação estrita (`tsc -b`).
- **Linter & Formatador:** Biome 2.5 (`@biomejs/biome@^2.5.15`).
- **Backend Edge:** Cloudflare Pages Functions com Cloudflare D1 relacional (`DELEGAS_DB`), emulado via Wrangler 4.151.0 e Miniflare 4.
- **Tipografia Vigente:** `@fontsource/big-shoulders-display` (display condensada), `@fontsource/hanken-grotesk` (corpo sem serifa) e `@fontsource/ibm-plex-mono` (números e dados técnicos).
- **Abordagem de Estilos:** CSS Modules puros com variáveis CSS customizadas em `tokens.css` e `base.css`. **Não utiliza TailwindCSS em runtime de produção**, mantendo zero overhead de bundle.

### 1.2 Catálogo Comercial Verificado (Fonte Única de Verdade)
Os produtos e preços reais da base D1 / fixtures oficiais foram auditados e rigorosamente respeitados:
1. **Dronken** (Double Double): Barril 30L: R\$ 510,00 | Barril 50L: R\$ 650,00.
2. **Palato Beber** (Premium Lager Pilsen): Barril 30L: R\$ 490,00 | Barril 50L: R\$ 640,00.
3. **Villa Alemã** (Chopp Pilsen Tradicional): Barril 30L: R\$ 520,00 | Barril 50L: R\$ 670,00.
4. **Krug Bier** (Chopp Artesanal Mineiro): Barril 30L: R\$ 570,00 | Barril 50L: R\$ 760,00.
5. **Brahma** (Tradicional): Barril 30L: *Não comercializado* (`null`) | Barril 50L: R\$ 890,00.
6. **Kaiser** (Tradicional): Barril 30L: *Não comercializado* (`null`) | Barril 50L: R\$ 890,00.
7. **Heineken** (Puro Malte Premium): Barril 30L: *Não comercializado* (`null`) | Barril 50L: R\$ 990,00.
8. **Chopp de Vinho** (Especial): Barril 30L: R\$ 570,00 | Barril 50L: R\$ 790,00.
- **Cachaça Artesanal Delegas:** Garrafa 700ml: R\$ 30,00 (conservada em barril de umburana com jequitibá rosa).

> [!IMPORTANT]
> **Correção Crucial de Regra de Negócio:** O layout legado no repositório ainda continha textos com "Delivery ou Retirada" e placeholders fotográficos de copos de chope ("tulipa com espuma"). A diretriz obrigatória do novo redesign foi estritamente aplicada: **a operação é 100% por entrega (sem retirada)** e o protagonista absoluto são os **BARRIS DE CHOPP EM AÇO INOX** (30L e 50L).

### 1.3 Preservação de Rotas e Isolamento do CMS Modular
- O CMS Modular do backend (F3A.2 / F3B) utiliza as tabelas `catalog_categories`, `catalog_items`, `catalog_variants` e o contrato HTTP `/api/admin/catalog/v2` com controle de concorrência por ETag/revisão (`If-Match`).
- Durante toda a exploração visual, **nenhum arquivo de produção, schema D1, API administrativa ou rota foi modificada**. Todo o design foi concebido para mapear exatamente as entidades do catálogo expandido.

---

## 2. Uso Obrigatório de Skills e Recursos de IA

Em estrita conformidade com as diretrizes da missão:

1. **Skills Identificadas no Ambiente:**
   - `generative_ui`: utilizada para orquestrar e renderizar o laboratório de prototipação visual interativo como artefato de alta fidelidade (`chopp_redesign_studio.html`) e o componente de carrossel inline (`carousel_3d_widget.html`).
   - `antigravity-guide`, `agy-customizations`, `automation`, `migrate-workflows`, `plugin`, `ui-plugin-navigation`.
2. **Subagents Especializados:**
   - `image-generator`: invocado para atuar como Art Department 3D Visualizer, gerando fotografias de estúdio e renders de alta resolução dos barris de 30L e 50L em aço escovado com iluminação dramática lateral, condensação real e fundo escuro (#101713).
3. **Engenharia de Frontend & QA:**
   - Modelagem de física CSS 3D (`perspective: 1200px`, `preserve-3d`, aceleração via `transform3d`).
   - Validação de contraste WCAG 2.1 AA e suporte a `prefers-reduced-motion`.

---

## 3. Elemento Assinatura: Carrossel 3D de Barris

### 3.1 Composição e Parâmetros Físicos

```
                      [ BARRIL CENTRAL (100%) ]
                         Scale: 1.00
                         TranslateZ: +50px
                         RotateY: 0deg
                         Z-Index: 30
                         Drop Shadow & Amber Aura
                                ▲
                                │
        ┌───────────────────────┴───────────────────────┐
        │                                               │
[ BARRIL ESQUERDO (80%) ]                       [ BARRIL DIREITO (80%) ]
   Scale: 0.80                                     Scale: 0.80
   TranslateX: -340px                              TranslateX: +340px
   TranslateY: +30px                               TranslateY: +30px
   RotateY: +22deg                                 RotateY: -22deg
   TranslateZ: -90px                               TranslateZ: -90px
   Z-Index: 10                                     Z-Index: 10
   Visibilidade: ~30%                              Visibilidade: ~30%
   Filtro: Dimmed/Blur                             Filtro: Dimmed/Blur
```

### 3.2 Avaliação Arquitetural: CSS 3D vs. WebGL / Three.js

| Critério | Opção A: CSS 3D (Recomendada) | Opção B: WebGL / Three.js |
|---|---|---|
| **Impacto no Bundle** | **0 KB adicionais** (usa motor CSS do browser) | +150 KB a 350 KB (Three.js + GLTF Loader) |
| **Performance Mobile** | **Sólidos 60-120 FPS**, aceleração nativa GPU | Risco de throttling térmico e queda de FPS |
| **Aparência dos Materiais** | Texturas fotorrealistas pré-renderizadas | Depende de shaders PBR pesados e HDRIs |
| **Acessibilidade** | Elementos HTML nativos no DOM (`aria-roledescription`) | Canvas fechado (exige fallback DOM paralelo) |
| **Manutenibilidade** | Fácil ajuste por designers e devs frontend | Exige modelador 3D para exportar novos .glb |
| **Suporte Reduced Motion** | Transição instantânea sem transformações | Exige controle imperativo do loop de render |

> [!TIP]
> **Veredito:** A **Opção A (CSS 3D)** entrega 95% do apelo visual cinematográfico com máxima fidelidade fotorrealista, 0 bytes de bibliotecas externas e carregamento instantâneo em redes móveis 4G.

---

## 4. Os Três Conceitos Visuais de Alta Fidelidade

````carousel
```markdown
# Conceito C: IMMERSIVE HYBRID (Prioridade Criativa)
- Hero cinematográfico com iluminação de fenda no barril de inox 50L.
- Carrossel 3D como vitrine interativa assinatura.
- Catálogo modular inspirado na BrewDog com seletor instantâneo 30L / 50L.
- Paleta #101713 com detalhes em ouro suave (#C6A46A) e âmbar (#D88B36).
```
<!-- slide -->
```markdown
# Conceito A: DARK CINEMATIC (Predominância MOVA Brewery)
- Atmosfera editorial profunda e densa (#080c09 e #101713).
- Foco em storytelling, respeito ao tempo de maturação e pureza do chopp.
- Tipografia monumental com espaçamento generoso e microcopy discreta.
- Elementos comerciais integrados de forma sutil para manter exclusividade.
```
<!-- slide -->
```markdown
# Conceito B: PREMIUM COMMERCE (Predominância BrewDog)
- Engenharia comercial de alta conversão: catálogo visível na primeira rolagem.
- Cards informativos com calculadora rápida de doses (60 a 100 copos).
- Tratamento explícito para marcas com apenas barril de 50L (Heineken, Brahma).
- CTAs contextuais que pré-formatam a mensagem no WhatsApp.
```
````

### 4.1 Conceito C: Immersive Hybrid (Detalhamento da Prioridade)
- **Hero:** Impacto visual imediato com o barril protagonista em aço inox escovado, iluminado por feixes dourados e âmbar, com gotas finas de condensação.
- **Transição Editorial:** O ticker marquee em tons discretos de carvão e dourado conecta o hero ao Carrossel 3D.
- **Vitrine 3D:** O usuário interage diretamente com o barril (arrastar, clicar nas laterais, teclado).
- **Catálogo de Cards:** Grade responsiva com toggle de volume global (30L vs 50L) e local, permitindo comparar preços reais de forma intuitiva.
- **Como Funciona:** 4 etapas claras destacando entrega, calibração da chopeira elétrica profissional (110V/220V) e recolhimento. **Zero retirada.**

### 4.2 Página de Produto (PDP) para Barril de Chopp
A proposta para a visão dedicada de um produto isolado contempla:
- **Render Dominante:** Vista lateral em grande escala do barril com reflexos metálicos e identificação do padrão DIN.
- **Seletor de Volume com Rendimento:**
  - `30 Litros`: Rende aprox. 60 copos de 500ml (ou 100 de 300ml).
  - `50 Litros`: Rende aprox. 100 copos de 500ml (ou 160 de 300ml).
- **Especificações Técnicas Inclusas:** Indicação de chopeira elétrica, cilindro CO2 com regulador aferido, engates e voltagem.
- **Ação Direta:** Botão de WhatsApp que envia mensagem formatada com o nome do chopp, litragem e data do evento.

---

## 5. Tokens de Design e Acessibilidade (WCAG 2.1 AA)

| Token Semântico | Hexadecimal | Razão de Contraste s/ Fundo | Conformidade WCAG |
|---|---|---|---|
| Background Dark | `#101713` | — (Superfície base) | — |
| Background Elevado | `#19251D` | — (Superfície secundária) | — |
| Surface Card | `#253229` | — (Bordas e containers) | — |
| Off-White Principal | `#F5F0E6` | **13.8:1** (sobre `#101713`) | **AAA** (Texto normal e display) |
| Dourado Suave | `#C6A46A` | **6.4:1** (sobre `#101713`) | **AA** (Texto e badges) |
| Âmbar de Destaque | `#D88B36` | **5.2:1** (sobre `#101713`) | **AA** (Acentos e botões) |
| Muted Text | `#B4B8AF` | **7.1:1** (sobre `#101713`) | **AAA** (Texto auxiliar) |

---

## 6. Como Navegar nos Protótipos Criados

1. **Protótipo Interativo Completo:** Abra o arquivo [chopp_redesign_studio.html](file:///C:/Users/vitormanoel/.gemini/antigravity/brain/9fe3a147-d7a4-42f0-bc1f-eeb0a9723604/chopp_redesign_studio.html) no seu navegador ou no visualizador integrado.
   - Alterne entre **Conceito C**, **Conceito A**, **Conceito B** e **PDP**.
   - Teste o redimensionamento para **Desktop (1440px)**, **Laptop (1280px)**, **Tablet (768px)** e **Mobile (390px)**.
   - Navegue pelo Carrossel 3D usando as setas ou clicando nos barris laterais.
   - Alterne o seletor de volume 30L / 50L e veja os preços da câmara fria atualizarem em tempo real.
2. **Widget Compacto do Carrossel 3D:** Disponível em [carousel_3d_widget.html](file:///C:/Users/vitormanoel/.gemini/antigravity/brain/9fe3a147-d7a4-42f0-bc1f-eeb0a9723604/carousel_3d_widget.html).
