import { createContext } from 'react'

/** Validated published contact only. Null preserves the existing build-time contact. */
export const WhatsAppNumberContext = createContext<string | null>(null)
