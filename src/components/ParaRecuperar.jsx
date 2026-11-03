import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { leadsParaRecuperar, linkRecupero } from '../lib/recupero'
import { nivelPuntaje } from '../lib/verificacion'
import { MessageCircle, Check, RotateCcw } from 'lucide-react'

const DE_A = 15

function ahoraAR() {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
}

// Leads fríos o perdidos con chances de compra, ordenados por probabilidad. El vendedor toca WhatsApp
// (se abre el chat con el mensaje escrito), lo manda desde su celular y marca "Listo".
export default function ParaRecuperar({ leads, isAdmin }) {
  const navigate = useNavigate()
  const [hechos, setHechos] = useState(() => new Set())
  const [mostrar, setMostrar] = useState(DE_A)
  const lista = useMemo(() => leadsParaRecuperar(leads), [leads])
  const pendientes = lista.filter(l => !hechos.has(l.id))
  if (pendientes.length === 0) return null

  async function marcar(l) {
    const nota = `[${ahoraAR()}] Recuperación manual: se le escribió por WhatsApp`
    const { error } = await supabase.from('leads')
      .update({ notas: [l.notas, nota].filter(Boolean).join('\n'), ...(l.estado === 'perdido' ? { estado: 'contactado' } : {}) })
      .eq('id', l.id)
    if (!error) setHechos(prev => new Set(prev).add(l.id))
  }

  return (
    <div className="card contactar-card recuperar" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <h3><RotateCcw size={16} /> Para recuperar ({pendientes.length})</h3>
        <span className="aviso-detalle">Fríos o perdidos con chances, de mayor a menor probabilidad. Escribile y marcá Listo.</span>
      </div>
      <div className="card-body">
        {pendientes.slice(0, mostrar).map(l => {
          const nivel = nivelPuntaje(l.puntaje_compra)
          const wa = linkRecupero(l)
          return (
            <div key={l.id} className="contactar-fila">
              <button className="contactar-nombre" onClick={() => navigate(`/leads/${l.id}`)}>
                {l.nombre}
                <span className="aviso-detalle">
                  <span className={`badge badge-puntaje-${nivel}`} title={l.puntaje_motivo || ''}>{l.puntaje_compra}</span>
                  {' '}{l.estado === 'perdido' ? 'Perdido · ' : ''}{l.modelo_interes || 'sin modelo'} · {l.origen}
                  {isAdmin && ` · ${l.vendedor?.full_name || 'Sin asignar'}`}
                </span>
              </button>
              <div className="recuperar-acciones">
                {wa && (
                  <a className="btn btn-sm btn-whatsapp-contactar" href={wa} target="_blank" rel="noopener noreferrer">
                    <MessageCircle size={14} /> WhatsApp
                  </a>
                )}
                <button className="btn btn-sm btn-secondary" onClick={() => marcar(l)} title="Ya le escribí">
                  <Check size={14} /> Listo
                </button>
              </div>
            </div>
          )
        })}
        {pendientes.length > mostrar && (
          <button className="btn-link" onClick={() => setMostrar(m => m + DE_A)}>Ver {Math.min(DE_A, pendientes.length - mostrar)} más</button>
        )}
      </div>
    </div>
  )
}
