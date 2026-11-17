import { useEffect, useState } from 'react'

// Teléfono = pantalla angosta. La app móvil tiene sus propias pantallas; en la computadora se usa el CRM de siempre.
export const CONSULTA_MOVIL = '(max-width: 768px)'

export function useEsMovil() {
  const [es, setEs] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(CONSULTA_MOVIL).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(CONSULTA_MOVIL)
    if (!mq) return
    const cambio = () => setEs(mq.matches)
    mq.addEventListener?.('change', cambio)
    return () => mq.removeEventListener?.('change', cambio)
  }, [])
  return es
}
