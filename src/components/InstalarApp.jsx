import { useEffect, useState } from 'react'
import { Smartphone, X } from 'lucide-react'
import { esIOS, estaInstalada } from '../lib/instalarApp'

// Botón "Instalar app" en el menú. Android/Chrome: abre el diálogo de instalación del navegador.
// iPhone: Safari no tiene ese diálogo, así que se explica cómo agregarla a la pantalla de inicio.
export default function InstalarApp() {
  const [evento, setEvento] = useState(null)
  const [ayudaIOS, setAyudaIOS] = useState(false)
  const [instalada, setInstalada] = useState(() => estaInstalada(window))

  useEffect(() => {
    const guardar = (e) => { e.preventDefault(); setEvento(e) }
    const listo = () => { setInstalada(true); setEvento(null) }
    window.addEventListener('beforeinstallprompt', guardar)
    window.addEventListener('appinstalled', listo)
    return () => { window.removeEventListener('beforeinstallprompt', guardar); window.removeEventListener('appinstalled', listo) }
  }, [])

  if (instalada) return null
  const ios = esIOS(navigator.userAgent)
  if (!evento && !ios) return null

  return (
    <>
      <button
        className="sidebar-link instalar-app"
        onClick={async () => {
          if (evento) { evento.prompt(); const r = await evento.userChoice; if (r.outcome === 'accepted') setInstalada(true); setEvento(null) }
          else setAyudaIOS(true)
        }}
      >
        <Smartphone size={18} /> Instalar app
      </button>
      {ayudaIOS && (
        <div className="modal-overlay" onClick={() => setAyudaIOS(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h3>Instalar en el iPhone</h3><button className="modal-close" onClick={() => setAyudaIOS(false)}><X size={18} /></button></div>
            <div className="modal-body instalar-pasos">
              <p>1. Abrí esta página en <strong>Safari</strong>.</p>
              <p>2. Tocá el botón <strong>Compartir</strong> (el cuadrado con la flecha para arriba).</p>
              <p>3. Elegí <strong>Agregar a inicio</strong> y tocá <strong>Agregar</strong>.</p>
              <p>Te queda el ícono de MotoBox en la pantalla y se abre como una app.</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
