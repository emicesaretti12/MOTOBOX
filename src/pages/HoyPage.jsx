import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, traerTodos } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { colaDeHoy, avanceDeHoy, resultadoContacto, comoPaga, asunto, MOTIVOS_PERDIDO, INTENTOS_MAXIMOS } from '../lib/hoy'
import { linkCaliente } from '../lib/calientes'
import { MessageCircle, Phone, Check, PhoneOff, CalendarPlus, Clock, XCircle, PartyPopper } from 'lucide-react'

const CAMPOS = 'id, nombre, telefono, notas, modelo_interes, forma_pago, anticipo, usada_detalle, monto_aprobado, bcra_resultado, estado_dni, estado, origen, prioridad, puntaje_compra, updated_at, ' +
  'fecha_agenda, caliente_at, caliente_atendido_at, caliente_motivo, dni_actualizado_at, duplicado_de, ' +
  'proximo_contacto_at, ultimo_contacto_at, contacto_intentos, vendedor_asignado, vendedor:profiles!vendedor_asignado(full_name)'
const POR_TANDA = 15

function hace(fecha) {
  if (!fecha) return ''
  const min = Math.max(1, Math.round((Date.now() - new Date(fecha).getTime()) / 60000))
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`
}

// Dato de tiempo según la pestaña: cuánto espera, cuándo es la cita o cuándo fue el último contacto.
function tiempo(l, clave) {
  if (clave === 'citas') return `Cita ${new Date(l.fecha_agenda).toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`
  if (clave === 'calientes') return `Espera ${hace(l.caliente_at).replace('hace ', '')}`
  if (clave === 'aprobados') return l.dni_actualizado_at ? `Aprobado ${hace(l.dni_actualizado_at)}` : ''
  const ultimo = l.ultimo_contacto_at || l.caliente_atendido_at
  return ultimo ? `Último contacto ${hace(ultimo)}` : 'Sin contacto registrado'
}

// Valor por defecto para los selectores de fecha: mañana a las 10:00 (hora del navegador).
function mananaALas10() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function Fila({ lead, clave, isAdmin, vendedor, onResultado, guardando }) {
  const navigate = useNavigate()
  const [abierta, setAbierta] = useState(false) // muestra "¿Cómo te fue?" recién después de contactar
  const [modo, setModo] = useState(null) // 'visita' | 'posponer' | 'perdido'
  const [fecha, setFecha] = useState(mananaALas10)
  const [motivo, setMotivo] = useState(MOTIVOS_PERDIDO[0])
  const wa = linkCaliente(lead, vendedor)
  const pago = comoPaga(lead)
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
          <span className="hoy-nombre">
            {lead.nombre}
            <span className={`hoy-pago ${pago.tono}`}>{pago.texto}</span>
          </span>
          <span className="hoy-asunto">{asunto(lead)}</span>
          <span className="aviso-detalle">
            {[tiempo(lead, clave), isAdmin && (lead.vendedor?.full_name || 'Sin asignar')].filter(Boolean).join(' · ')}
          </span>
          {muchosIntentos && <span className="hoy-aviso">Ya van {lead.contacto_intentos} intentos sin respuesta: si no contesta, marcalo como perdido.</span>}
        </button>
        <div className="hoy-contacto">
          {wa && <a className="btn btn-sm btn-whatsapp-contactar" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => setAbierta(true)}><MessageCircle size={14} /> WhatsApp</a>}
          {tel && <a className="btn btn-sm btn-secondary" href={tel} onClick={() => setAbierta(true)}><Phone size={14} /> Llamar</a>}
          {!abierta && <button className="btn btn-sm btn-secondary" onClick={() => setAbierta(true)}>Anotar resultado</button>}
        </div>
      </div>

      {abierta && <div className="hoy-resultados">
        <span className="hoy-resultados-label">¿Cómo te fue?</span>
        <button className="btn btn-sm btn-secondary" disabled={guardando} onClick={() => confirmar('escribi')}><Check size={14} /> Le escribí</button>
        <button className="btn btn-sm btn-secondary" disabled={guardando} onClick={() => confirmar('no_contesta')}><PhoneOff size={14} /> No contesta</button>
        <button className={`btn btn-sm ${modo === 'visita' ? 'btn-primary' : 'btn-secondary'}`} disabled={guardando} onClick={() => setModo(modo === 'visita' ? null : 'visita')}><CalendarPlus size={14} /> Agendó visita</button>
        <button className={`btn btn-sm ${modo === 'posponer' ? 'btn-primary' : 'btn-secondary'}`} disabled={guardando} onClick={() => setModo(modo === 'posponer' ? null : 'posponer')}><Clock size={14} /> Más adelante</button>
        <button className={`btn btn-sm ${modo === 'perdido' ? 'btn-primary' : 'btn-secondary'}`} disabled={guardando} onClick={() => setModo(modo === 'perdido' ? null : 'perdido')}><XCircle size={14} /> Perdido</button>
      </div>}

      {abierta && (modo === 'visita' || modo === 'posponer') && (
        <div className="hoy-extra">
          <label className="form-label" htmlFor={`fecha-${lead.id}`}>{modo === 'visita' ? '¿Qué día y a qué hora viene?' : '¿Cuándo le volvés a escribir?'}</label>
          <input id={`fecha-${lead.id}`} className="form-input" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={guardando || !fecha} onClick={() => confirmar(modo, { fecha: new Date(fecha).toISOString() })}>Guardar</button>
        </div>
      )}
      {abierta && modo === 'perdido' && (
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
  const [pestana, setPestana] = useState(null)
  const [mostrar, setMostrar] = useState(POR_TANDA)
  const [soloMios, setSoloMios] = useState(false)

  const cargar = useCallback(async () => {
    if (!profile?.id) return
    const { data, error: e } = await traerTodos(() => {
      let q = supabase.from('leads').select(CAMPOS)
        .in('estado', ['nuevo', 'contactado', 'en_negociacion'])
        .is('duplicado_de', null)
        .eq('prioridad', 'alta')
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
  // Pestaña elegida; si se vació, pasa sola a la primera con leads.
  const grupo = cola.grupos.find((g) => g.clave === pestana) || cola.grupos[0] || null

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

      {grupo && (
        <>
          <div className="hoy-pestanas" role="tablist">
            {cola.grupos.map((g) => (
              <button
                key={g.clave}
                role="tab"
                aria-selected={g.clave === grupo.clave}
                className={`hoy-pestana ${g.clave === grupo.clave ? 'activa' : ''}`}
                onClick={() => { setPestana(g.clave); setMostrar(POR_TANDA) }}
              >
                {g.titulo} <span className="hoy-pestana-n">{g.leads.length}</span>
              </button>
            ))}
          </div>

          <div className="card hoy-grupo">
            <div className="card-body">
              <p className="aviso-detalle hoy-ayuda">{grupo.ayuda}</p>
              {grupo.leads.slice(0, mostrar).map((l) => (
                <Fila key={l.id} lead={l} clave={grupo.clave} isAdmin={isAdmin} vendedor={profile?.full_name} onResultado={registrar} guardando={guardando === l.id} />
              ))}
              {grupo.leads.length > mostrar && (
                <button className="btn-link hoy-mas" onClick={() => setMostrar((n) => n + POR_TANDA)}>
                  Ver más ({grupo.leads.length - mostrar} restantes)
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
