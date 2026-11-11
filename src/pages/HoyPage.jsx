import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, traerTodos } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { colaDeHoy, avanceDeHoy, resultadoContacto, MOTIVOS_PERDIDO, INTENTOS_MAXIMOS } from '../lib/hoy'
import { linkCaliente } from '../lib/calientes'
import { FORMA_PAGO_LABELS } from '../lib/verificacion'
import { MessageCircle, Phone, Check, PhoneOff, CalendarPlus, Clock, XCircle, PartyPopper } from 'lucide-react'

const CAMPOS = 'id, nombre, telefono, notas, modelo_interes, forma_pago, bcra_resultado, estado_dni, estado, origen, puntaje_compra, ' +
  'fecha_agenda, caliente_at, caliente_atendido_at, caliente_motivo, dni_actualizado_at, duplicado_de, ' +
  'proximo_contacto_at, ultimo_contacto_at, contacto_intentos, vendedor_asignado, vendedor:profiles!vendedor_asignado(full_name)'
const POR_GRUPO = 8

function hace(fecha) {
  if (!fecha) return ''
  const min = Math.max(1, Math.round((Date.now() - new Date(fecha).getTime()) / 60000))
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`
}

function detalle(l, clave) {
  const partes = []
  if (clave === 'citas') partes.push(`Cita ${new Date(l.fecha_agenda).toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`)
  if (l.caliente_motivo === 'asesor') partes.push('Pidió un asesor')
  if (FORMA_PAGO_LABELS[l.forma_pago]) partes.push(FORMA_PAGO_LABELS[l.forma_pago])
  if (l.estado_dni === 'aprobado' || l.bcra_resultado === 'apto') partes.push('Crédito aprobado')
  if (l.modelo_interes) partes.push(l.modelo_interes)
  if (clave === 'calientes') partes.push(hace(l.caliente_at))
  if (clave === 'enfriando' || clave === 'volver') partes.push(`último contacto ${hace(l.ultimo_contacto_at || l.caliente_atendido_at) || 'sin registrar'}`)
  return partes.filter(Boolean).join(' · ')
}

// Valor por defecto para los selectores de fecha: mañana a las 10:00 (hora del navegador).
function mananaALas10() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function Fila({ lead, clave, isAdmin, vendedor, onResultado, guardando }) {
  const navigate = useNavigate()
  const [modo, setModo] = useState(null) // 'visita' | 'posponer' | 'perdido'
  const [fecha, setFecha] = useState(mananaALas10)
  const [motivo, setMotivo] = useState(MOTIVOS_PERDIDO[0])
  const wa = linkCaliente(lead, vendedor)
  const tel = lead.telefono ? `tel:${String(lead.telefono).replace(/[^\d+]/g, '')}` : null
  const muchosIntentos = (lead.contacto_intentos ?? 0) >= INTENTOS_MAXIMOS

  async function confirmar(tipo, datos) {
    const ok = await onResultado(lead, tipo, datos)
    if (ok) setModo(null)
  }

  return (
    <div className="hoy-fila">
      <div className="hoy-fila-principal">
        <button className="contactar-nombre" onClick={() => navigate(`/leads/${lead.id}`)}>
          {lead.nombre}
          <span className="aviso-detalle">
            {detalle(lead, clave)}
            {isAdmin && ` · ${lead.vendedor?.full_name || 'Sin asignar'}`}
          </span>
          {muchosIntentos && <span className="hoy-aviso">Ya van {lead.contacto_intentos} intentos sin respuesta: si no contesta, marcalo como perdido.</span>}
        </button>
        <div className="hoy-contacto">
          {wa && <a className="btn btn-sm btn-whatsapp-contactar" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
          {tel && <a className="btn btn-sm btn-secondary" href={tel}><Phone size={14} /> Llamar</a>}
        </div>
      </div>

      <div className="hoy-resultados">
        <span className="hoy-resultados-label">¿Cómo te fue?</span>
        <button className="btn btn-sm btn-secondary" disabled={guardando} onClick={() => confirmar('escribi')}><Check size={14} /> Le escribí</button>
        <button className="btn btn-sm btn-secondary" disabled={guardando} onClick={() => confirmar('no_contesta')}><PhoneOff size={14} /> No contesta</button>
        <button className={`btn btn-sm ${modo === 'visita' ? 'btn-primary' : 'btn-secondary'}`} disabled={guardando} onClick={() => setModo(modo === 'visita' ? null : 'visita')}><CalendarPlus size={14} /> Agendó visita</button>
        <button className={`btn btn-sm ${modo === 'posponer' ? 'btn-primary' : 'btn-secondary'}`} disabled={guardando} onClick={() => setModo(modo === 'posponer' ? null : 'posponer')}><Clock size={14} /> Más adelante</button>
        <button className={`btn btn-sm ${modo === 'perdido' ? 'btn-primary' : 'btn-secondary'}`} disabled={guardando} onClick={() => setModo(modo === 'perdido' ? null : 'perdido')}><XCircle size={14} /> Perdido</button>
      </div>

      {(modo === 'visita' || modo === 'posponer') && (
        <div className="hoy-extra">
          <label className="form-label" htmlFor={`fecha-${lead.id}`}>{modo === 'visita' ? '¿Qué día y a qué hora viene?' : '¿Cuándo le volvés a escribir?'}</label>
          <input id={`fecha-${lead.id}`} className="form-input" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={guardando || !fecha} onClick={() => confirmar(modo, { fecha: new Date(fecha).toISOString() })}>Guardar</button>
        </div>
      )}
      {modo === 'perdido' && (
        <div className="hoy-extra">
          <label className="form-label" htmlFor={`motivo-${lead.id}`}>¿Por qué se perdió?</label>
          <select id={`motivo-${lead.id}`} className="form-input" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {MOTIVOS_PERDIDO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" disabled={guardando} onClick={() => confirmar('perdido', { motivo })}>Marcar perdido</button>
        </div>
      )}
    </div>
  )
}

export default function HoyPage() {
  const { profile, isAdmin } = useAuth()
  const { addToast } = useToast()
  const [leads, setLeads] = useState(null)
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(null)
  const [abiertos, setAbiertos] = useState({})
  const [soloMios, setSoloMios] = useState(false)

  const cargar = useCallback(async () => {
    if (!profile?.id) return
    const { data, error: e } = await traerTodos(() => {
      let q = supabase.from('leads').select(CAMPOS)
        .in('estado', ['nuevo', 'contactado', 'en_negociacion'])
        .is('duplicado_de', null)
        .or('caliente_at.not.is.null,proximo_contacto_at.not.is.null,estado_dni.eq.aprobado,bcra_resultado.eq.apto,fecha_agenda.not.is.null,ultimo_contacto_at.not.is.null')
        .order('id')
      if (!isAdmin) q = q.eq('vendedor_asignado', profile.id)
      return q
    })
    if (e) { setError('No se pudo cargar la lista. Revisá la conexión y recargá la página.'); return }
    setError(null)
    setLeads(data || [])
  }, [profile?.id, isAdmin])

  useEffect(() => {
    cargar()
    const reloj = setInterval(cargar, 120000)
    return () => clearInterval(reloj)
  }, [cargar])

  const visibles = useMemo(() => (soloMios ? (leads || []).filter((l) => l.vendedor_asignado === profile?.id) : leads || []), [leads, soloMios, profile?.id])
  const cola = useMemo(() => colaDeHoy(visibles), [visibles])
  const avance = useMemo(() => avanceDeHoy(visibles), [visibles])

  async function registrar(lead, tipo, datos) {
    let cambios
    try { cambios = resultadoContacto(lead, tipo, datos, new Date(), profile?.full_name) } catch (e) { addToast(e.message, 'error'); return false }
    // Un lead sin dueño queda a nombre de quien lo trabajó.
    if (!lead.vendedor_asignado) cambios.vendedor_asignado = profile.id
    setGuardando(lead.id)
    const { error: e } = await supabase.from('leads').update(cambios).eq('id', lead.id)
    setGuardando(null)
    if (e) { addToast('No se pudo guardar. Probá de nuevo.', 'error'); return false }
    setLeads((prev) => (prev || []).map((l) => (l.id === lead.id ? { ...l, ...cambios } : l)))
    addToast({ escribi: 'Anotado. Te lo recuerdo mañana si no avanza.', no_contesta: 'Anotado. Vuelve a la lista en 2 días.', visita: 'Visita agendada.', posponer: 'Listo, te lo recuerdo ese día.', perdido: 'Marcado como perdido.' }[tipo], 'success')
    return true
  }

  if (error) return <div className="card"><div className="card-body">{error}</div></div>
  if (leads === null) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div className="hoy">
      <div className="hoy-resumen">
        <div className="hoy-numero pendientes"><strong>{cola.total}</strong><span>para contactar</span></div>
        <div className="hoy-numero"><strong>{avance.contactados}</strong><span>contactados hoy</span></div>
        <div className="hoy-numero"><strong>{avance.citasFuturas}</strong><span>visitas agendadas</span></div>
        {isAdmin && (
          <label className="filter-check hoy-filtro"><input type="checkbox" checked={soloMios} onChange={(e) => setSoloMios(e.target.checked)} /> Solo mis leads</label>
        )}
      </div>

      {cola.total === 0 && (
        <div className="card"><div className="card-body hoy-vacio"><PartyPopper size={22} /> No queda nadie por contactar. Cuando entre un lead nuevo o toque un seguimiento, aparece acá.</div></div>
      )}

      {cola.grupos.map((g) => {
        const todos = abiertos[g.clave]
        const lista = todos ? g.leads : g.leads.slice(0, POR_GRUPO)
        return (
          <div key={g.clave} className={`card hoy-grupo ${g.clave}`}>
            <div className="card-header">
              <h3>{g.titulo} ({g.leads.length})</h3>
              <span className="aviso-detalle">{g.ayuda}</span>
            </div>
            <div className="card-body">
              {lista.map((l) => (
                <Fila key={l.id} lead={l} clave={g.clave} isAdmin={isAdmin} vendedor={profile?.full_name} onResultado={registrar} guardando={guardando === l.id} />
              ))}
              {g.leads.length > POR_GRUPO && (
                <button className="btn-link hoy-mas" onClick={() => setAbiertos((p) => ({ ...p, [g.clave]: !todos }))}>
                  {todos ? 'Ver menos' : `Ver los ${g.leads.length}`}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
