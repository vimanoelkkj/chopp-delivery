import { ProtoA } from './ProtoA'
import { ProtoB } from './ProtoB'

/** Despacha os protótipos de demonstração. Só é importado em DEV (ver src/app/App.tsx). */
export default function ProtoRoutes({ variant }: { variant: 'a' | 'b' }) {
  return variant === 'a' ? <ProtoA /> : <ProtoB />
}
