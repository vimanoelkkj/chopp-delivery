import type { Ref } from 'react'
import { AdminButton } from '../ui/AdminButton'
import { Switch } from '../ui/Switch'
import { TextField } from '../ui/TextField'
import type { DraftItem } from './draft'
import styles from './ItemCard.module.css'
import { PriceField } from './PriceField'
import rowStyles from './ProductRow.module.css'
import type { ItemField, VariantField } from './useCatalogEditor'
import { formatVolume, sanitizeVolumeInput, volumeUnit } from './volume'

type ItemCardProps = {
  item: DraftItem
  categoryName: string
  priceRequired: boolean
  position: number
  total: number
  /** Mensagens já filtradas: `name`, `description`, `variants`, `row`, `price:<k>`, `label:<k>`, `volume:<k>`. */
  errors: Record<string, string>
  changed: boolean
  rowRef: Ref<HTMLLIElement>
  onItemField: (field: ItemField, text: string) => void
  onTouch: (field: string) => void
  onVariantField: (variant: string, field: VariantField, text: string) => void
  onBlurPrice: (variant: string) => void
  onAddVariant: () => void
  onRemoveVariant: (variant: string) => void
  onVisible: (visible: boolean) => void
  onMove: (direction: -1 | 1) => void
  /** Só para item ainda não salvo. */
  onCancel: () => void
}

/**
 * Cartão de produto: cadastro novo (ainda só no rascunho) ou item cujas variantes não cabem nas
 * colunas padrão da tabela. Nome/descrição são editáveis; variantes persistidas só mudam o preço.
 */
export function ItemCard({
  item,
  categoryName,
  priceRequired,
  position,
  total,
  errors,
  changed,
  rowRef,
  onItemField,
  onTouch,
  onVariantField,
  onBlurPrice,
  onAddVariant,
  onRemoveVariant,
  onVisible,
  onMove,
  onCancel,
}: ItemCardProps) {
  const isNew = item.id === null
  const unit = volumeUnit(item.categoryId)
  const title = item.name.trim() || 'Novo produto'
  return (
    <li
      ref={rowRef}
      className={styles.card}
      data-new={isNew}
      data-visible={item.visible}
      data-changed={changed}
      aria-label={isNew ? `${title} (novo, não salvo)` : title}
    >
      <div className={styles.top}>
        {isNew ? <p className={styles.badge}>Novo · não salvo</p> : null}
        <p className={styles.category}>{categoryName}</p>
      </div>

      <div className={styles.fields}>
        <TextField
          label="Nome"
          value={item.name}
          fieldKey={`${item.key}:name`}
          error={errors.name}
          onChange={(text) => onItemField('name', text)}
          onBlur={() => onTouch('name')}
        />
        <TextField
          label="Descrição"
          multiline
          value={item.description}
          fieldKey={`${item.key}:description`}
          error={errors.description}
          onChange={(text) => onItemField('description', text)}
          onBlur={() => onTouch('description')}
        />
      </div>

      <fieldset className={styles.variants}>
        <legend className={styles.legend}>Variantes</legend>
        {item.variants.map((variant, index) => {
          const fresh = variant.code === null
          const name = variant.label.trim() || `variante ${index + 1}`
          return (
            <div key={variant.key} className={styles.variant} data-new={fresh}>
              {fresh ? (
                <>
                  <TextField
                    label="Rótulo"
                    placeholder="Ex.: Barril de 20 L"
                    value={variant.label}
                    fieldKey={`${item.key}:label:${variant.key}`}
                    error={errors[`label:${variant.key}`]}
                    onChange={(text) => onVariantField(variant.key, 'label', text)}
                    onBlur={() => onTouch(`label:${variant.key}`)}
                  />
                  <TextField
                    label={`Volume (${unit})`}
                    inputMode={unit === 'L' ? 'decimal' : 'numeric'}
                    placeholder={unit === 'L' ? '20' : '700'}
                    value={variant.volumeText}
                    fieldKey={`${item.key}:volume:${variant.key}`}
                    error={errors[`volume:${variant.key}`]}
                    onChange={(text) =>
                      onVariantField(variant.key, 'volumeText', sanitizeVolumeInput(text, unit))
                    }
                    onBlur={() => onTouch(`volume:${variant.key}`)}
                  />
                </>
              ) : (
                <div className={styles.fixed}>
                  <p className={styles.fixedLabel}>{variant.label}</p>
                  <p className={styles.fixedVolume}>
                    {variant.volumeText
                      ? formatVolume(Number(variant.volumeText), unit)
                      : 'Sem volume'}
                  </p>
                </div>
              )}
              <PriceField
                alwaysLabel
                label="Preço (R$)"
                ariaLabel={`Preço em reais, ${name}, ${title}`}
                fieldKey={`${item.key}:price:${variant.key}`}
                value={variant.priceText}
                placeholder={priceRequired ? '0,00' : 'não vende'}
                error={errors[`price:${variant.key}`]}
                onChange={(text) => onVariantField(variant.key, 'priceText', text)}
                onBlur={() => onBlurPrice(variant.key)}
              />
              {fresh && item.variants.length > 1 ? (
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remover ${name}`}
                  onClick={() => onRemoveVariant(variant.key)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m7 7 10 10M17 7 7 17" />
                  </svg>
                </button>
              ) : null}
            </div>
          )
        })}
        {errors.variants ? <p className={styles.error}>{errors.variants}</p> : null}
        <AdminButton variant="outline" className={styles.add} onClick={onAddVariant}>
          Adicionar variante
        </AdminButton>
      </fieldset>

      <div className={styles.footer}>
        <Switch
          checked={item.visible}
          onChange={onVisible}
          label={`${title} visível no site`}
          onText="Visível"
          offText="Oculto"
        />
        <div className={styles.order}>
          <span className={rowStyles.position} style={{ display: 'inline' }}>
            Posição {position} de {total}
          </span>
          <div className={rowStyles.moves}>
            <button
              type="button"
              className={rowStyles.move}
              data-move={`${item.key}:-1`}
              disabled={position === 1}
              aria-label={`Subir ${title}`}
              onClick={() => onMove(-1)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 14 6-6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              className={rowStyles.move}
              data-move={`${item.key}:1`}
              disabled={position === total}
              aria-label={`Descer ${title}`}
              onClick={() => onMove(1)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 10 6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {errors.row ? <p className={styles.error}>{errors.row}</p> : null}
      {isNew ? (
        <AdminButton variant="outline" className={styles.cancel} onClick={onCancel}>
          Cancelar cadastro
        </AdminButton>
      ) : null}
    </li>
  )
}
