import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { pushSoportado, necesitaInstalar, clavePublica, estadoAvisos, activarAvisos, apagarAvisos } from '../lib/avisosPush'

// Interruptor "Avisos en este dispositivo". Devuelve null si el servidor todavía no tiene los avisos habilitados.
// render({ estado, texto, ocupado, alternar }) permite dibujarlo con el estilo de cada pantalla.
export default function AvisosPush({ render }) {
  const { profile } = useAuth()
  const { addToast } = useToast()
  const [habilitado, setHabilitado] = useState(false)
  const [estado, setEstado] = useState('cargando')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    clavePublica().then((c) => { if (vivo) setHabilitado(!!c) }).catch(() => {})
    estadoAvisos().then((e) => { if (vivo) setEstado(e) }).catch(() => { if (vivo) setEstado('no_soportado') })
    return () => { vivo = false }
  }, [])

  if (!habilitado) return null

  const instalar = necesitaInstalar()
  const texto = instalar
    ? 'En iPhone, primero instalá la app (Compartir → Agregar a inicio) y activalos desde ahí.'
    : estado === 'activos' ? 'Te avisamos al instante cuando entra un lead listo para comprar, aunque tengas el CRM cerrado.'
      : estado === 'bloqueado' ? 'Bloqueaste las notificaciones. Habilitalas en los ajustes del navegador o del celular.'
        : estado === 'no_soportado' || !pushSoportado() ? 'Este navegador no permite avisos.'
          : 'Activalos para enterarte al instante de cada lead listo para comprar.'

  async function alternar() {
    if (instalar || ocupado || ['bloqueado', 'no_soportado', 'cargando'].includes(estado)) return
    setOcupado(true)
    try {
      if (estado === 'activos') { await apagarAvisos(); setEstado('apagados'); addToast('Avisos apagados en este dispositivo', 'success') }
      else { await activarAvisos(profile.id); setEstado('activos'); addToast('¡Listo! Te vamos a avisar acá', 'success') }
    } catch (e) {
      addToast(e.message || 'No se pudo cambiar', 'error')
      estadoAvisos().then(setEstado).catch(() => {})
    } finally { setOcupado(false) }
  }

  return render({ estado: instalar ? 'instalar' : estado, texto, ocupado, alternar })
}
