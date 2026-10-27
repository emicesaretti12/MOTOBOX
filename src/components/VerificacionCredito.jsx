import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { ESTADO_DNI_LABELS, BCRA_LABELS, etiquetaRelacion, formatMonto, enmascararDni, detalleBcra } from '../lib/verificacion'
import { Copy, ShieldCheck } from 'lucide-react'

function fmtFecha(d) {
  return d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
}

// Tarjeta de la ficha del lead con los datos de verificación de DNI.
// No se muestra en los leads que nunca mandaron un DNI (ni pasaron por el Banco Central).
export default function VerificacionCredito({ lead }) {
  const { addToast } = useToast()
  const [resoluciones, setResoluciones] = useState([])

  useEffect(() => {
    if (!lead?.id || (!lead.dni && !lead.estado_dni)) return
    let activo = true
    supabase
      .from('dni_resoluciones')
      .select('id, intento, dni, relacion, resultado, monto_aprobado, origen, created_at, operador:profiles!operador_id(full_name)')
      .eq('lead_id', lead.id)
      .order('intento', { ascending: false })
      .then(({ data, error }) => { if (activo) setResoluciones(error ? [] : data || []) })
    return () => { activo = false }
  }, [lead?.id, lead?.dni, lead?.estado_dni, lead?.dni_intentos])

  if (!lead || (!lead.dni && !lead.estado_dni && !lead.bcra_resultado)) return null

  async function copiar() {
    try {
      await navigator.clipboard.writeText(lead.dni)
      addToast('DNI copiado', 'success')
    } catch {
      addToast('No se pudo copiar: seleccionalo a mano', 'error')
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <h3><ShieldCheck size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />Verificación de crédito</h3>
        {lead.estado_dni && <span className={`badge badge-dni-${lead.estado_dni}`}>{ESTADO_DNI_LABELS[lead.estado_dni] || lead.estado_dni}</span>}
      </div>
      <div className="card-body">
        <div className="detail-row">
          <span className="detail-label">DNI</span>
          <span className="detail-value">
            {lead.dni ? (
              <span className="cola-dni">
                {lead.dni}
                <button className="btn-icon" title="Copiar DNI" onClick={copiar}><Copy size={14} /></button>
              </span>
            ) : '-'}
          </span>
        </div>
        {lead.bcra_resultado && (
          <div className="detail-row">
            <span className="detail-label">Banco Central</span>
            <span className="detail-value">
              <span className={`badge badge-bcra-${lead.bcra_resultado}`}>{BCRA_LABELS[lead.bcra_resultado]}</span>
              {' '}<span className="aviso-detalle">{[detalleBcra(lead).split(' · ')[1], fmtFecha(lead.bcra_consultado_at)].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
        )}
        <div className="detail-row"><span className="detail-label">Relación</span><span className="detail-value">{etiquetaRelacion(lead.dni_titular_relacion)}</span></div>
        <div className="detail-row"><span className="detail-label">Intentos</span><span className="detail-value">{lead.dni_intentos ?? 0}</span></div>
        <div className="detail-row"><span className="detail-label">Monto aprobado</span><span className="detail-value">{formatMonto(lead.monto_aprobado)}</span></div>
        <div className="detail-row"><span className="detail-label">Última verificación</span><span className="detail-value">{fmtFecha(lead.dni_actualizado_at)}</span></div>

        {resoluciones.length > 0 && (
          <div className="credito-historial">
            <div className="detail-label" style={{ marginBottom: 6 }}>Intentos resueltos</div>
            {resoluciones.map(r => (
              <div key={r.id} className="credito-intento">
                <span>#{r.intento} · {etiquetaRelacion(r.relacion)} {enmascararDni(r.dni)}</span>
                <span>
                  <span className={`badge badge-dni-${r.resultado}`}>{ESTADO_DNI_LABELS[r.resultado]}</span>
                  {r.monto_aprobado != null && <> {formatMonto(r.monto_aprobado)}</>}
                </span>
                <span className="aviso-detalle">
                  {fmtFecha(r.created_at)} · {r.origen === 'sendpulse' ? 'desde SendPulse' : `por ${r.operador?.full_name || 'operador'}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
