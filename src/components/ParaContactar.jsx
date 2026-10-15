import { useNavigate } from 'react-router-dom'
import { getWhatsAppLink } from '../lib/utils'
import { leadsParaContactar, formatMonto, formatEspera, segundosDesde } from '../lib/verificacion'
import { MessageCircle, BadgeCheck, RotateCcw } from 'lucide-react'

const MAXIMO = 10

function Fila({ lead, detalle, isAdmin }) {
  const navigate = useNavigate()
  const wa = getWhatsAppLink(lead.telefono)
  return (
    <div className="contactar-fila">
      <button className="contactar-nombre" onClick={() => navigate(`/leads/${lead.id}`)}>
        {lead.nombre}
        <span className="aviso-detalle">
          {detalle}
          {isAdmin && ` · ${lead.vendedor?.full_name || 'Sin asignar'}`}
        </span>
      </button>
      {wa && (
        <a className="btn btn-sm btn-whatsapp-contactar" href={wa} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={14} /> WhatsApp
        </a>
      )}
    </div>
  )
}

// Bloque "para contactar ahora": va arriba de todo en Dashboard y Leads.
// Recibe los leads que la pantalla ya cargó (cada vendedor solo tiene los suyos).
export default function ParaContactar({ leads, isAdmin }) {
  const { aprobados, volvieron } = leadsParaContactar(leads)
  if (aprobados.length === 0 && volvieron.length === 0) return null
  const ahora = Date.now()

  return (
    <div className="contactar-grid">
      {aprobados.length > 0 && (
        <div className="card contactar-card aprobados">
          <div className="card-header">
            <h3><BadgeCheck size={16} /> DNI aprobado — para contactar ({aprobados.length})</h3>
          </div>
          <div className="card-body">
            {aprobados.slice(0, MAXIMO).map(l => (
              <Fila
                key={l.id}
                lead={l}
                isAdmin={isAdmin}
                detalle={`${l.monto_aprobado != null ? formatMonto(l.monto_aprobado) + ' · ' : ''}aprobado hace ${formatEspera(segundosDesde(l.dni_actualizado_at, ahora))}`}
              />
            ))}
            {aprobados.length > MAXIMO && <div className="aviso-detalle">Y {aprobados.length - MAXIMO} más: filtrá "DNI aprobado" en Leads.</div>}
          </div>
        </div>
      )}
      {volvieron.length > 0 && (
        <div className="card contactar-card volvieron">
          <div className="card-header">
            <h3><RotateCcw size={16} /> Volvieron a escribir ({volvieron.length})</h3>
          </div>
          <div className="card-body">
            {volvieron.slice(0, MAXIMO).map(l => (
              <Fila key={l.id} lead={l} isAdmin={isAdmin} detalle={`Estaba perdido · escribió hace ${formatEspera(segundosDesde(l.reingreso_at, ahora))}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
