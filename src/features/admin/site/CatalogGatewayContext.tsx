import { createContext, useContext } from 'react'
import type { AdminCatalogGateway } from '../catalog/gateway'

const CatalogGatewayContext = createContext<AdminCatalogGateway | null>(null)

/** O transporte é escolhido só em AdminApp; a edição do site recebe o gateway já pronto. */
export const CatalogGatewayProvider = CatalogGatewayContext.Provider

export function useCatalogGateway(): AdminCatalogGateway {
  const gateway = useContext(CatalogGatewayContext)
  if (!gateway) throw new Error('CatalogGatewayProvider ausente')
  return gateway
}
