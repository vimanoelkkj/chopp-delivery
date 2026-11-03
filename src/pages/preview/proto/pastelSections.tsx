import type { RefObject } from 'react'
import { CachacaBanner } from '@/features/catalog/CachacaBanner'
import { standardChopes } from '@/features/catalog/expanded-api'
import { lowestPrice, visibleProducts } from '@/features/catalog/pricing'
import { BARREL_SIZES, type BarrelSize, type Product } from '@/features/catalog/types'
import type { CatalogState } from '@/features/catalog/useCatalog'
import { VariantCatalog } from '@/features/catalog/VariantCatalog'
import { WhatsAppButton } from '@/features/contact/WhatsAppButton'
import { AboutSection } from '@/pages/landing/sections/AboutSection'
import catalogStyles from '@/pages/landing/sections/CatalogSection.module.css'
import { ContactSection } from '@/pages/landing/sections/ContactSection'
import { FaqSection } from '@/pages/landing/sections/FaqSection'
import { HowItWorks } from '@/pages/landing/sections/HowItWorks'
import { PromoSection } from '@/pages/landing/sections/PromoSection'
import { Ticker } from '@/pages/landing/sections/Ticker'
import { formatBRL } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { Container } from '@/shared/ui/Container'
import styles from './PastelSections.module.css'
import { Cutout, cutouts } from './pastelKegs'

/** Rendimento por barril: mesmos textos da grade oficial, exibidos juntos para comparar. */
const YIELD: Record<BarrelSize, string> = {
  30: '~60 copos de 500ml (ou 100 de 300ml)',
  50: '~100 copos de 500ml (ou 160 de 300ml)',
}

function orderMessage(product: Product, size: BarrelSize) {
  return `Olá! Vim pelo site da Chopp Delivery Delegas e gostaria de pedir o barril de ${product.name} (${size}L).`
}

function Offer({
  product,
  size,
  lowest,
}: {
  product: Product
  size: BarrelSize
  lowest: number | null
}) {
  const price = product.prices[size]
  const other: BarrelSize = size === 30 ? 50 : 30
  if (price === null) {
    const onlyOther = product.prices[other] !== null
    return (
      <td className={styles.offer} data-label={`${size} L`}>
        <span className={styles.unavailable}>
          {onlyOther ? `Só em ${other} L` : 'Indisponível'}
        </span>
        <span className="visually-hidden">{` não disponível em ${size} litros`}</span>
      </td>
    )
  }
  return (
    <td className={styles.offer} data-label={`${size} L`}>
      <div className={styles.offerInner}>
        <span className={styles.priceBox}>
          <span className={styles.price}>
            {formatBRL(price, { cents: !Number.isInteger(price) })}
          </span>
          {price === lowest && <span className={styles.lowest}>Menor valor</span>}
        </span>
        <WhatsAppButton
          customText={orderMessage(product, size)}
          variant="gold"
          className={styles.order}
        >
          Pedir
          <span className="visually-hidden">{` ${product.name}, barril de ${size} litros`}</span>
        </WhatsAppButton>
      </div>
    </td>
  )
}

/**
 * Catálogo do experimento: a tabela é o único lugar de comparação (30 L e 50 L lado a lado, com
 * pedido por volume). O carrossel acima segue como vitrine; a grade de fotos foi dispensada aqui
 * por repetir os mesmos barris. Dados, preços e mensagens de WhatsApp são os do catálogo real.
 */
export function PastelCatalog({ state, retry }: { state: CatalogState; retry: () => void }) {
  const count = state.status === 'ready' ? state.catalog.products.length : null
  const categories = state.status === 'ready' ? state.catalog.expanded.categories : []
  const chopes = categories.find((c) => c.id === 'chopes')?.items ?? []
  const standard = standardChopes(chopes)
  const products = state.status === 'ready' ? visibleProducts(state.catalog.products) : []
  const lowest: Record<BarrelSize, number | null> =
    state.status === 'ready'
      ? { 30: lowestPrice(products, 30), 50: lowestPrice(products, 50) }
      : { 30: null, 50: null }

  return (
    <section id="chopes" className={catalogStyles.section} aria-labelledby="chopes-title">
      <Container className={catalogStyles.inner}>
        <div className={catalogStyles.top}>
          <div className={catalogStyles.headerCopy}>
            <p className={catalogStyles.eyebrow}>02 • Catálogo Real</p>
            <h2 id="chopes-title" className={catalogStyles.title}>
              Nossos Chopes &amp; Litragens
            </h2>
            <p className={catalogStyles.note}>
              {!standard
                ? 'Consulte os valores e as apresentações disponíveis diretamente da câmara fria.'
                : count === null
                  ? 'Consulte os valores dos barris de 30 e de 50 litros.'
                  : `${count === 8 ? 'Oito' : count} opções de chopp com valores verificados da câmara fria de São João del-Rei. Chopeira profissional inclusa.`}
            </p>
          </div>
        </div>

        {state.status === 'loading' && <p role="status">Carregando catálogo…</p>}
        {state.status === 'error' && (
          <>
            <p role="alert">Catálogo indisponível no momento. Tente novamente.</p>
            <Button onClick={retry}>Tentar novamente</Button>
          </>
        )}
        {state.status === 'ready' &&
          categories.map((c) =>
            c.id === 'chopes' ? (
              <div key={c.id}>
                {chopes.length ? (
                  standard ? (
                    <div className={styles.block}>
                      <p className={styles.yield}>
                        {BARREL_SIZES.map((size) => (
                          <span key={size}>
                            <strong>Barril {size} L:</strong> rende {YIELD[size]}
                          </span>
                        ))}
                      </p>
                      <table className={styles.table}>
                        <caption className="visually-hidden">
                          Valores dos barris de chopp por tamanho, com pedido pelo WhatsApp
                        </caption>
                        <thead className={styles.thead}>
                          <tr>
                            <th scope="col" className={styles.headName}>
                              Chopp
                            </th>
                            {BARREL_SIZES.map((size) => (
                              <th scope="col" key={size} className={styles.head}>
                                Barril {size} L
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((product) => (
                            <tr key={product.id} className={styles.row}>
                              <th scope="row" className={styles.name}>
                                <span className={styles.title}>{product.name}</span>
                                <span className={styles.description}>{product.description}</span>
                              </th>
                              {BARREL_SIZES.map((size) => (
                                <Offer
                                  key={size}
                                  product={product}
                                  size={size}
                                  lowest={lowest[size]}
                                />
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <VariantCatalog items={chopes} />
                  )
                ) : (
                  <p role="status">Nenhum chope disponível no catálogo no momento.</p>
                )}
              </div>
            ) : c.id === 'cachacas' ? (
              <div key={c.id}>
                {c.items.map((i) => (
                  <CachacaBanner
                    key={i.id}
                    item={{ title: i.name, description: i.description, variants: i.variants }}
                  />
                ))}
              </div>
            ) : c.items.length > 0 ? (
              <div key={c.id}>
                <h2>{c.name}</h2>
                <VariantCatalog items={c.items} />
              </div>
            ) : null,
          )}
      </Container>
    </section>
  )
}

/** Seções oficiais abaixo da vitrine, com a mídia escura do "Sobre" trocada pelo recorte. */
export function PastelLower({
  state,
  retry,
  finalCtaRef,
}: {
  state: CatalogState
  retry: () => void
  finalCtaRef: RefObject<HTMLDivElement | null>
}) {
  const aboutKeg = cutouts.studio30
  return (
    <>
      <div className={styles.ticker}>
        <Ticker />
      </div>
      <PastelCatalog state={state} retry={retry} />
      <div className={styles.how}>
        <HowItWorks />
      </div>
      <div className={styles.about}>
        <AboutSection
          mediaFallback={
            aboutKeg ? (
              <div className={styles.aboutStage}>
                <Cutout src={aboutKeg} alt="Barril de chopp em aço inox escovado" eager={false} />
              </div>
            ) : undefined
          }
        />
      </div>
      <div className={styles.promo}>
        <PromoSection />
      </div>
      <div className={styles.faq}>
        <FaqSection />
      </div>
      <ContactSection ctaRef={finalCtaRef} />
    </>
  )
}
