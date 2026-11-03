import { ProtoA } from './ProtoA'
import { ProtoB } from './ProtoB'
import { ProtoPastel } from './ProtoPastel'

/** Despacha os protótipos de demonstração. Só é importado em DEV (ver src/app/App.tsx). */
export default function ProtoRoutes({ variant }: { variant: 'a' | 'b' | 'pastel' }) {
  if (variant === 'pastel') return <ProtoPastel />
  return variant === 'a' ? <ProtoA /> : <ProtoB />
}
