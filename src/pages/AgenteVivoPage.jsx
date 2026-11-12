import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { agruparConversaciones, resumenDelDia, vistaPrevia } from '../lib/agenteVivo'
import { inicioDelDia } from '../lib/hoy'
import { Bot, User, Headphones, Info, ArrowLeft, ExternalLink, Radio } from 'lucide-react'

const HORAS = 48
const LIMITE = 3000

const ETIQUETA_ESTADO = {
  esperando: { texto: 'Esperando respuesta', tono: 'rojo' },
  humano: { texto: 'Atiende un asesor', tono: 'azul' },
  derivado: { texto: 'Pasado a asesor', tono: 'verde' },
  activa: { texto: 'Hablando ahora', tono: 'naranja' },
  quieta: { texto: '', tono: '' },
}

const hora = (f) => new Date(f).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
function cuando(f) {
  const d = new Date(f)
  const hoy = new Date()
  if (d.toDateString() === hoy.toDateString()) return hora(f)
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }) + ' ' + hora(f)
}

function Burbuja({ e }) {
  if (e.tipo === 'dato' || e.tipo === 'flujo' || e.tipo === 'otro') {
    return (
      <div className="vivo-dato">
        <Info size={13} /> {e.texto} <span>{hora(e.created_at)}</span>
      </div>
    )
  }
  const lado = e.autor === 'cliente' ? 'cliente' : e.autor === 'humano' ? 'humano' : 'agente'
  const Icono = lado === 'cliente' ? User : lado === 'humano' ? Headphones : Bot
  return (
    <div className={`vivo-msj ${lado}`}>
      <div className="vivo-msj-autor"><Icono size={12} /> {lado === 'cliente' ? 'Cliente' : lado === 'humano' ? 'Asesor' : 'Valen'} · {hora(e.created_at)}</div>
      <div className="vivo-msj-texto">{e.texto || '—'}</div>
    </div>
  )
}

export default function AgenteVivoPage() {
  const navigate = useNavigate()
  const [eventos, setEventos] = useState(null)
  const [error, setError] = useState(null)
  const [elegida, setElegida] = useState(null)
  const [canal, setCanal] = useState('todos')
  const [soloEsperando, setSoloEsperando] = useState(false)
  const [conectado, setConectado] = useState(false)
  const [reloj, setReloj] = useState(() => new Date())
  const finRef = useRef(null)

  useEffect(() => {
    let activo = true
    const desde = new Date(Date.now() - HORAS * 3600000).toISOString()
    supabase.from('agente_eventos')
      .select('id, created_at, canal, tipo, autor, contact_id, telefono, nombre, lead_id, texto')
      .gte('created_at', desde).order('created_at', { ascending: false }).limit(LIMITE)
      .then(({ data, error: err }) => {
        if (!activo) return
        if (err) setError('No se pudo cargar la actividad del agente.')
        else setEventos(data ?? [])
      })
    const sub = supabase.channel('agente-en-vivo')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agente_eventos' }, ({ new: fila }) => {
        setEventos((prev) => (prev && !prev.some((x) => x.id === fila.id) ? [fila, ...prev] : prev))
      })
      .subscribe((estado) => setConectado(estado === 'SUBSCRIBED'))
    const t = setInterval(() => setReloj(new Date()), 30000) // recalcula "esperando" sin recargar
    return () => { activo = false; supabase.removeChannel(sub); clearInterval(t) }
  }, [])

  const conversaciones = useMemo(() => (eventos ? agruparConversaciones(eventos, reloj) : []), [eventos, reloj])
  const resumen = useMemo(() => (eventos ? resumenDelDia(eventos, new Date(inicioDelDia(reloj))) : null), [eventos, reloj])
  const esperando = conversaciones.filter((c) => c.estado === 'esperando').length
  const visibles = conversaciones.filter((c) => (canal === 'todos' || c.canal === canal) && (!soloEsperando || c.estado === 'esperando'))
  const actual = conversaciones.find((c) => c.clave === elegida) ?? null

  useEffect(() => { finRef.current?.scrollIntoView({ block: 'end' }) }, [actual?.eventos.length, elegida])

  if (error) return <div className="card"><div className="card-body">{error}</div></div>
  if (eventos === null) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div className="vivo">
      <div className="hoy-resumen">
        <div className="hoy-numero"><strong>{resumen.conversaciones}</strong><span>conversaciones hoy</span></div>
        <div className="hoy-numero"><strong>{resumen.respuestasAgente}</strong><span>respuestas de Valen</span></div>
        <div className="hoy-numero"><strong>{resumen.nuevos}</strong><span>leads nuevos</span></div>
        <div className="hoy-numero"><strong>{resumen.dnis}</strong><span>DNI recibidos</span></div>
        <div className="hoy-numero"><strong>{resumen.listos}</strong><span>pasados a asesor</span></div>
        <div className={`hoy-numero ${esperando ? 'pendientes' : ''}`}><strong>{esperando}</strong><span>esperando respuesta</span></div>
        <span className={`vivo-en-linea ${conectado ? 'si' : ''}`}><Radio size={14} /> {conectado ? 'En vivo' : 'Conectando…'}</span>
      </div>

      <div className={`vivo-panel ${actual ? 'con-chat' : ''}`}>
        <div className="card vivo-lista">
          <div className="vivo-filtros">
            {['todos', 'whatsapp', 'instagram'].map((c) => (
              <button key={c} className={`hoy-pestana ${canal === c ? 'activa' : ''}`} onClick={() => setCanal(c)}>
                {c === 'todos' ? 'Todos' : c === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
              </button>
            ))}
            <label className="filter-check"><input type="checkbox" checked={soloEsperando} onChange={(e) => setSoloEsperando(e.target.checked)} /> Solo esperando</label>
          </div>
          {visibles.length === 0 ? (
            <p className="vivo-vacio">
              {eventos.length === 0
                ? 'Todavía no hay actividad registrada. Cada mensaje que entre o salga por el bot aparece acá al instante.'
                : 'No hay conversaciones con este filtro.'}
            </p>
          ) : visibles.map((c) => {
            const est = ETIQUETA_ESTADO[c.estado]
            return (
              <button key={c.clave} className={`vivo-conv ${c.clave === elegida ? 'activa' : ''}`} onClick={() => setElegida(c.clave)}>
                <div className="vivo-conv-arriba">
                  <strong>{c.nombre || c.telefono || 'Sin nombre'}</strong>
                  <span>{cuando(c.ultimo.created_at)}</span>
                </div>
                <div className="vivo-conv-texto">{vistaPrevia(c.ultimoMensaje ?? c.ultimo)}</div>
                <div className="vivo-conv-abajo">
                  <span className={`vivo-canal ${c.canal ?? ''}`}>{c.canal === 'instagram' ? 'Instagram' : c.canal === 'whatsapp' ? 'WhatsApp' : '—'}</span>
                  {est.texto && <span className={`vivo-estado ${est.tono}`}>{est.texto}</span>}
                </div>
              </button>
            )
          })}
        </div>

        <div className="card vivo-chat">
          {!actual ? (
            <p className="vivo-vacio">Elegí una conversación para ver qué le dijo Valen y qué datos tomó.</p>
          ) : (
            <>
              <div className="vivo-chat-cabecera">
                <button className="btn btn-secondary btn-sm vivo-volver" onClick={() => setElegida(null)}><ArrowLeft size={14} /></button>
                <div>
                  <strong>{actual.nombre || 'Sin nombre'}</strong>
                  <span>{[actual.telefono, actual.canal === 'instagram' ? 'Instagram' : 'WhatsApp'].filter(Boolean).join(' · ')}</span>
                </div>
                {actual.lead_id && (
                  <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/leads/${actual.lead_id}`)}><ExternalLink size={14} /> Ver lead</button>
                )}
              </div>
              <div className="vivo-chat-cuerpo">
                {actual.eventos.map((e) => <Burbuja key={e.id} e={e} />)}
                <div ref={finRef} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
