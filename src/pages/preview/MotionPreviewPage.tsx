import { useState } from 'react'
import { ExpandableCatalogView } from '@/features/catalog-expansion/ExpandableCatalogView'
import { FIXTURE_PUBLIC_CATALOG_V2 } from '@/features/catalog-expansion/fixtures'
import { TickerMarquee } from '@/features/motion/TickerMarquee'
import { Hero } from '@/pages/landing/sections/Hero'
import { HeroRefined } from '@/pages/landing/sections/HeroRefined'
import styles from './MotionPreviewPage.module.css'

type TabType = 'marquee' | 'hero' | 'integrated' | 'catalog'
type ViewportPreset = 360 | 390 | 430 | 768 | 1440 | 2560 | 3840 | '100%'

function getInitialTab(): TabType {
  if (typeof window === 'undefined') return 'marquee'
  const search = new URLSearchParams(window.location.search)
  const tab = search.get('preview')
  if (tab === 'catalog') return 'catalog'
  if (tab === 'hero') return 'hero'
  if (tab === 'integrated') return 'integrated'
  return 'marquee'
}

export function MotionPreviewPage() {
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab)

  // Estado do Marquee
  const [marqueePaused, setMarqueePaused] = useState(false)
  const [marqueeSpeed, setMarqueeSpeed] = useState(55)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [viewportWidth, setViewportWidth] = useState<ViewportPreset>('100%')
  const [marqueeMetrics, setMarqueeMetrics] = useState({
    containerWidth: 0,
    sequenceWidth: 0,
    singleSetWidth: 0,
    repetitions: 4,
    calculatedDuration: 85,
  })

  // Estado do Hero
  const [heroMode, setHeroMode] = useState<'refined' | 'original' | 'split'>('refined')
  const [heroReplayKey, setHeroReplayKey] = useState(0)

  // Estado do Catálogo Expansível (v2)
  const [filterHidden, setFilterHidden] = useState(true)
  const [omitEmptyCategories, setOmitEmptyCategories] = useState(true)
  const [catalogDataSource, setCatalogDataSource] = useState<'api' | 'fixture'>('api')

  const hasZeroGaps =
    marqueeMetrics.containerWidth > 0 &&
    marqueeMetrics.sequenceWidth >= marqueeMetrics.containerWidth

  return (
    <div className={styles.previewPage}>
      {/* Barra superior de navegação do laboratório */}
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <span className={styles.badge}>Motion &amp; Catalog</span>
          <h1 className={styles.brandTitle}>Chopp Delivery Delegas</h1>
        </div>

        <nav className={styles.tabList} aria-label="Abas do laboratório de movimento e catálogo">
          <button
            type="button"
            className={[styles.tabBtn, activeTab === 'marquee' ? styles.tabBtnActive : ''].join(
              ' ',
            )}
            onClick={() => setActiveTab('marquee')}
          >
            1. Letreiro Amarelo
          </button>
          <button
            type="button"
            className={[styles.tabBtn, activeTab === 'hero' ? styles.tabBtnActive : ''].join(' ')}
            onClick={() => setActiveTab('hero')}
          >
            2. Hero: Antes / Depois
          </button>
          <button
            type="button"
            className={[styles.tabBtn, activeTab === 'integrated' ? styles.tabBtnActive : ''].join(
              ' ',
            )}
            onClick={() => setActiveTab('integrated')}
          >
            3. Composição Integrada
          </button>
          <button
            type="button"
            className={[styles.tabBtn, activeTab === 'catalog' ? styles.tabBtnActive : ''].join(
              ' ',
            )}
            onClick={() => setActiveTab('catalog')}
          >
            4. Catálogo Expansível (v2)
          </button>
        </nav>

        <a href="/" className={styles.exitBtn}>
          ← Voltar à Loja
        </a>
      </header>

      <main className={styles.content}>
        {/* ABA 1: LETREIRO AMARELO INFINITO */}
        {activeTab === 'marquee' && (
          <section aria-labelledby="marquee-heading">
            <div className={styles.sectionHeader}>
              <h2 id="marquee-heading" className={styles.sectionTitle}>
                Letreiro Amarelo Infinito (Seamless Marquee)
              </h2>
              <p className={styles.sectionDesc}>
                Movimento contínuo 100% em CSS Modules e aceleração por GPU (transform3d). Elimina
                lacunas e saltos em qualquer largura de tela ou após carregamento de fontes.
              </p>
            </div>

            {/* Painel de telemetria e diagnóstico */}
            <div className={styles.diagnosticGrid}>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Status do Loop</div>
                <div className={[styles.diagValue, styles.diagOk].join(' ')}>
                  {hasZeroGaps ? '✓ Sem Lacunas (Perfeito)' : 'Medindo...'}
                </div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Largura da Tela / Contêiner</div>
                <div className={styles.diagValue}>{marqueeMetrics.containerWidth || '—'} px</div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Largura da Sequência (Trilho A)</div>
                <div className={styles.diagValue}>{marqueeMetrics.sequenceWidth || '—'} px</div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Repetições Dinâmicas</div>
                <div className={styles.diagValue}>
                  {marqueeMetrics.repetitions}x por metade do trilho
                </div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Velocidade Linear Constante</div>
                <div className={styles.diagValue}>{marqueeSpeed} px/s</div>
              </div>
            </div>

            {/* Controles interativos */}
            <div className={styles.controlsBar}>
              <div className={styles.controlGroup}>
                <span className={styles.controlLabel}>Simular Largura:</span>
                {([360, 390, 430, 768, 1440, 2560, 3840, '100%'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={[
                      styles.btnAction,
                      viewportWidth === w ? styles.btnActionActive : '',
                    ].join(' ')}
                    onClick={() => setViewportWidth(w)}
                  >
                    {w === '100%' ? '100% Total' : w === 3840 ? '3840px (4K)' : `${w}px`}
                  </button>
                ))}
              </div>

              <div className={styles.controlGroup}>
                <span className={styles.controlLabel}>Velocidade:</span>
                {[
                  { label: '0.5x (Lenta)', val: 28 },
                  { label: '1.0x (Padrão)', val: 55 },
                  { label: '1.5x (Rápida)', val: 82 },
                ].map(({ label, val }) => (
                  <button
                    key={val}
                    type="button"
                    className={[
                      styles.btnAction,
                      marqueeSpeed === val ? styles.btnActionActive : '',
                    ].join(' ')}
                    onClick={() => setMarqueeSpeed(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={styles.controlGroup}>
                <button
                  type="button"
                  className={[styles.btnAction, marqueePaused ? styles.btnActionActive : ''].join(
                    ' ',
                  )}
                  onClick={() => setMarqueePaused((p) => !p)}
                >
                  {marqueePaused ? '▶ Retomar Movimento' : '⏸ Pausar'}
                </button>

                <button
                  type="button"
                  className={[styles.btnAction, reducedMotion ? styles.btnActionActive : ''].join(
                    ' ',
                  )}
                  onClick={() => setReducedMotion((r) => !r)}
                >
                  {reducedMotion ? '♿ Movimento Reduzido (Ativo)' : '♿ Testar Movimento Reduzido'}
                </button>
              </div>
            </div>

            {/* Moldura da prévia com largura simulada */}
            <div className={styles.previewFrameWrapper}>
              <div className={styles.previewFrameHeader}>
                <span>Prévia Funcional do Componente</span>
                <span>
                  Largura Ativa: {viewportWidth === '100%' ? '100% (Fluida)' : `${viewportWidth}px`}
                </span>
              </div>
              <div
                className={styles.simulatedViewport}
                style={{
                  maxWidth: viewportWidth === '100%' ? '100%' : `${viewportWidth}px`,
                }}
              >
                <TickerMarquee
                  speed={marqueeSpeed}
                  paused={marqueePaused}
                  forceReducedMotion={reducedMotion}
                  onMetricsChange={setMarqueeMetrics}
                />
              </div>
            </div>

            <div className={styles.featureList}>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>Garantia Matemática de Loop Sem Lacunas</div>
                <div className={styles.featureText}>
                  A largura da Sequência A é sempre maior que a largura visível da tela (
                  {marqueeMetrics.sequenceWidth}px vs {marqueeMetrics.containerWidth}px). Assim, no
                  instante exato do loop (reset de -50% para 0%), a Sequência B já cobre 100% da
                  extensão visível.
                </div>
              </div>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>Aceleração Hardware (60 Hz / 120 Hz)</div>
                <div className={styles.featureText}>
                  Usa exclusivamente <code>translate3d</code> na camada do compositor. Zero
                  recalculação de layout ou repaints contínuos da CPU.
                </div>
              </div>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>Acessibilidade WCAG 2.2</div>
                <div className={styles.featureText}>
                  Pausa instantânea ao passar o cursor (hover) ou focar com teclado (focus-within).
                  Leitores de tela recebem um resumo sem repetições infinitas via cabeçalho
                  acessível.
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ABA 2: HERO ANTES / DEPOIS */}
        {activeTab === 'hero' && (
          <section aria-labelledby="hero-heading">
            <div className={styles.sectionHeader}>
              <h2 id="hero-heading" className={styles.sectionTitle}>
                Refinamento Visual do Hero (Prévia Isolada)
              </h2>
              <p className={styles.sectionDesc}>
                Proposta de identidade refinada preservando exatamente a diagramação, textos e foto,
                adicionando calor âmbar, textura de chopp artesanal e entrada suave.
              </p>
            </div>

            <div className={styles.controlsBar}>
              <div className={styles.comparisonToggle}>
                <button
                  type="button"
                  className={[
                    styles.btnAction,
                    heroMode === 'refined' ? styles.btnActionActive : '',
                  ].join(' ')}
                  onClick={() => setHeroMode('refined')}
                >
                  ★ Hero Refinado (Proposta F1)
                </button>
                <button
                  type="button"
                  className={[
                    styles.btnAction,
                    heroMode === 'original' ? styles.btnActionActive : '',
                  ].join(' ')}
                  onClick={() => setHeroMode('original')}
                >
                  Hero Atual (Original)
                </button>
                <button
                  type="button"
                  className={[
                    styles.btnAction,
                    heroMode === 'split' ? styles.btnActionActive : '',
                  ].join(' ')}
                  onClick={() => setHeroMode('split')}
                >
                  Comparação Lado a Lado
                </button>
              </div>

              <button
                type="button"
                className={styles.btnAction}
                onClick={() => setHeroReplayKey((k) => k + 1)}
              >
                ↻ Replay da Animação de Entrada
              </button>

              <button
                type="button"
                className={[styles.btnAction, reducedMotion ? styles.btnActionActive : ''].join(
                  ' ',
                )}
                onClick={() => setReducedMotion((r) => !r)}
              >
                {reducedMotion ? '♿ Movimento Reduzido (Ativo)' : '♿ Testar Movimento Reduzido'}
              </button>
            </div>

            <div className={styles.comparisonView}>
              {(heroMode === 'refined' || heroMode === 'split') && (
                <div className={styles.previewFrameWrapper}>
                  <div className={styles.previewFrameHeader}>
                    <span>★ Hero Refinado — Glow Âmbar + Textura + Gradiente + Entrada</span>
                    <span className={styles.diagOk}>Alternativa Visual Proposta</span>
                  </div>
                  <HeroRefined
                    key={`refined-${heroReplayKey}`}
                    forceReducedMotion={reducedMotion}
                  />
                </div>
              )}

              {(heroMode === 'original' || heroMode === 'split') && (
                <div className={styles.previewFrameWrapper}>
                  <div className={styles.previewFrameHeader}>
                    <span>Hero Original — Fundo preto sólido, sem textura ou entrada</span>
                    <span>Versão Atual em Produção</span>
                  </div>
                  <Hero />
                </div>
              )}
            </div>

            {/* Detalhes dos elementos de refinamento */}
            <div className={styles.featureList}>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>1. Glow Âmbar Discreto</div>
                <div className={styles.featureText}>
                  Dois gradientes radiais quentes iluminam a área de leitura e a tulipa de chope (8%
                  de opacidade), simulando iluminação cênica de bar/cervejaria.
                </div>
              </div>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>2. Textura Sutil de Fundo</div>
                <div className={styles.featureText}>
                  Micro-pontilhado tátil de 24x24px sobre preto profundo. Quebra a esterilidade do
                  fundo plano sem gerar ruído visual pesado.
                </div>
              </div>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>3. Gradiente Escuro com Profundidade</div>
                <div className={styles.featureText}>
                  Transição suave de preto vinílico (#050403) a carvão quente (#0d0b08), conferindo
                  densidade e elegância à composição.
                </div>
              </div>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>4. Entrada Suave da Tipografia</div>
                <div className={styles.featureText}>
                  Escalonamento elegante em <code>translate3d</code> (14px) e <code>opacity</code>{' '}
                  com curva cúbica desacelerada, desligando automaticamente se o usuário preferir
                  menos movimento.
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ABA 3: COMPOSIÇÃO INTEGRADA */}
        {activeTab === 'integrated' && (
          <section aria-labelledby="integrated-heading">
            <div className={styles.sectionHeader}>
              <h2 id="integrated-heading" className={styles.sectionTitle}>
                Composição Integrada (Hero Refinado + Letreiro Amarelo)
              </h2>
              <p className={styles.sectionDesc}>
                Demonstração da transição natural entre o Hero refinado e o letreiro amarelo
                deslizando continuamente na base da dobra principal.
              </p>
            </div>

            <div className={styles.previewFrameWrapper}>
              <div className={styles.previewFrameHeader}>
                <span>Composição F1 Completa</span>
                <span>Hero Refinado + Letreiro Contínuo</span>
              </div>
              <HeroRefined key={`int-${heroReplayKey}`} forceReducedMotion={reducedMotion} />
              <TickerMarquee
                speed={marqueeSpeed}
                paused={marqueePaused}
                forceReducedMotion={reducedMotion}
              />
            </div>
          </section>
        )}

        {/* ABA 4: CATÁLOGO EXPANSÍVEL (V2) */}
        {activeTab === 'catalog' && (
          <section aria-labelledby="catalog-preview-heading">
            <div className={styles.sectionHeader}>
              <h2 id="catalog-preview-heading" className={styles.sectionTitle}>
                Prévia do Catálogo Público Expansível (Contrato v2)
              </h2>
              <p className={styles.sectionDesc}>
                Interface modular e responsiva com múltiplos produtos e variantes comerciais (9
                chopes, opções de cachaça com suporte a garrafa de 700 ml e teste de múltiplos
                volumes, barris de 7,5 L a 50 L, preços em centavos e proteção de itens ocultos).
              </p>
            </div>

            {/* Painel de telemetria da fixture v2 */}
            <div className={styles.diagnosticGrid}>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Chopes Visíveis</div>
                <div className={[styles.diagValue, styles.diagOk].join(' ')}>
                  9 Rótulos (8 + 1 Novo)
                </div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Opções de Cachaça</div>
                <div className={styles.diagValue}>1 Real (700 ml) + 2 Demonstração</div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Barris Suportados</div>
                <div className={styles.diagValue}>7,5 L · 20 L · 30 L · 50 L</div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Volumes de Garrafa</div>
                <div className={styles.diagValue}>500 ml · 700 ml · 750 ml · 1.000 ml</div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Segurança Preço Nulo</div>
                <div className={styles.diagValue}>Brahma 30 L = "—" (Não Comprável)</div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Fonte de Dados</div>
                <div className={[styles.diagValue, styles.diagOk].join(' ')}>
                  {catalogDataSource === 'api'
                    ? 'API Real (/api/catalog)'
                    : 'Fixture de Teste (v2)'}
                </div>
              </div>
              <div className={styles.diagCard}>
                <div className={styles.diagLabel}>Proteção Itens Ocultos</div>
                <div className={[styles.diagValue, styles.diagOk].join(' ')}>
                  {filterHidden ? '✓ Ocultos Filtrados' : 'Exibindo Tudo (Debug)'}
                </div>
              </div>
            </div>

            {/* Controles do simulador */}
            <div className={styles.controlsBar}>
              <div className={styles.controlGroup}>
                <span className={styles.controlLabel}>Origem dos Dados:</span>
                <button
                  type="button"
                  className={[
                    styles.btnAction,
                    catalogDataSource === 'api' ? styles.btnActionActive : '',
                  ].join(' ')}
                  onClick={() => setCatalogDataSource('api')}
                >
                  {catalogDataSource === 'api'
                    ? '✓ API Pública Real (GET /api/catalog)'
                    : 'API Pública Real'}
                </button>
                <button
                  type="button"
                  className={[
                    styles.btnAction,
                    catalogDataSource === 'fixture' ? styles.btnActionActive : '',
                  ].join(' ')}
                  onClick={() => setCatalogDataSource('fixture')}
                >
                  {catalogDataSource === 'fixture'
                    ? '✓ Fixture Demonstração (v2)'
                    : 'Fixture Demonstração'}
                </button>
              </div>

              <div className={styles.controlGroup}>
                <span className={styles.controlLabel}>Filtros do Contrato:</span>
                <button
                  type="button"
                  className={[styles.btnAction, filterHidden ? styles.btnActionActive : ''].join(
                    ' ',
                  )}
                  onClick={() => setFilterHidden((v) => !v)}
                >
                  {filterHidden
                    ? '✓ Ocultar visible: false (Padrão Público)'
                    : '⚠ Exibir Produtos Ocultos'}
                </button>

                <button
                  type="button"
                  className={[
                    styles.btnAction,
                    omitEmptyCategories ? styles.btnActionActive : '',
                  ].join(' ')}
                  onClick={() => setOmitEmptyCategories((v) => !v)}
                >
                  {omitEmptyCategories
                    ? '✓ Omitir Categorias Vazias (Padrão)'
                    : 'Exibir Categorias Vazias'}
                </button>
              </div>
            </div>

            {/* Frame da visualização pública do catálogo */}
            <div className={styles.previewFrameWrapper}>
              <div className={styles.previewFrameHeader}>
                <span>
                  Vitrine do Catálogo Público —{' '}
                  {catalogDataSource === 'api'
                    ? 'Conectado a /api/catalog'
                    : 'Fixture Demonstrativa'}
                </span>
                <span className={styles.diagOk}>Contrato v2 F3A.2</span>
              </div>
              <ExpandableCatalogView
                catalog={catalogDataSource === 'fixture' ? FIXTURE_PUBLIC_CATALOG_V2 : undefined}
                filterHidden={filterHidden}
                omitEmptyCategories={omitEmptyCategories}
              />
            </div>

            {/* Destaques arquiteturais */}
            <div className={styles.featureList}>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>1. Tabela Dinâmica Multi-Variante</div>
                <div className={styles.featureText}>
                  Detecta automaticamente as variantes de barril presentes no catálogo (7,5 L, 20 L,
                  30 L, 50 L), expandindo as colunas no desktop e chips de seleção no mobile sem
                  presumir quantidades fixas.
                </div>
              </div>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>2. Vitrine de Cachaças Multi-Volume</div>
                <div className={styles.featureText}>
                  Apresenta os rótulos de cachaça artesanal com suporte a volumes variáveis (500 ml,
                  700 ml, 750 ml, 1.000 ml). Cada produto permite alternar o volume desejado
                  atualizando o preço em centavos em tempo real.
                </div>
              </div>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>3. Tratamento Seguro de Preços Nulos</div>
                <div className={styles.featureText}>
                  Variantes com <code>priceCents: null</code> (como Brahma 30 L) exibem travessão
                  "—" com legenda acessível <em>não disponível</em>, e no card mobile o botão fica
                  desabilitado, impedindo envio de pedidos inválidos via WhatsApp.
                </div>
              </div>
              <div className={styles.featureCard}>
                <div className={styles.featureTitle}>4. Conformidade e Isolamento DEV-Only</div>
                <div className={styles.featureText}>
                  Preserva aviso legal 18+, nota de logística (entrega e instalação de chopeiras em
                  SJDR e região), e mantém 0 bytes de impacto no build de produção da LandingPage.
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
