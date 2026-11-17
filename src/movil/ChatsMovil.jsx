import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MessagesSquare, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { agruparConversaciones } from '../lib/agenteVivo'
import { useRefrescoAuto } from '../hooks/useRefrescoAuto'
import { Pantalla, Avatar, Fila, Segmentos, Pastilla, Vacio, Esqueleto } from './ui'
import { Burbujas } from './Conversacion'
import { cuandoCorto } from './formato'

const DIAS = 7
const CAMPOS = 'id, created_at, canal, tipo, autor, contact_id, telefono, nombre, lead_id, texto'

// Todos los eventos del agente de la última semana, en vivo (compartido entre la lista y la conversación).
function useEventos() {
  const [eventos, setEventos] = useState(null)
  const [reloj, setReloj] = useState(() => new Date())
  const cargar = useCallback(async () => {
    const desde = new Date(Date.now() - DIAS * 864e5).toISOString()
    const { data } = await supabase.from('agente_eventos').select(CAMPOS).gte('created_at', desde).order('created_at', { ascending: false }).limit(3000)
    if (data) setEventos(data)
  }, [])
  useEffect(() => {
    cargar()
    const canal = supabase.channel('mv-agente')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agente_eventos' }, ({ new: f }) => {
        setEventos((prev) => (prev && !prev.some((x) => x.id === f.id) ? [f, ...prev] : prev))
      })
      .subscribe()
    const t = setInterval(() => setReloj(new Date()), 30000)
    return () => { supabase.removeChannel(canal); clearInterval(t) }
  }, [cargar])
  useRefrescoAuto(() => cargar(), 120000)
  const conversaciones = useMemo(() => (eventos ? agruparConversaciones(eventos, reloj) : null), [eventos, reloj])
  return { conversaciones, cargar }
}

const ESTADO = {
  esperando: { texto: 'Esperando', tono: 'rojo' },
  derivado: { texto: 'Para asesor', tono: 'naranja' },
  humano: { texto: 'Asesor', tono: 'azul' },
  activa: { texto: 'Activa', tono: 'verde' },
}

function vistaPrevia(e) {
  if (!e) return ''
  const quien = e.autor === 'cliente' ? '' : e.autor === 'humano' ? 'Asesor: ' : 'Valen: '
  return quien + (e.texto || (e.tipo === 'dato' ? 'Dato guardado' : '—')).replace(/\s+/g, ' ')
}

export default function ChatsMovil() {
  const navigate = useNavigate()
  const { conversaciones, cargar } = useEventos()
  const [filtro, setFiltro] = useState('todos')

  const lista = useMemo(() => (conversaciones ?? []).filter((c) => (
    filtro === 'todos' ? true : filtro === 'esperando' ? c.estado === 'esperando' : c.canal === filtro
  )), [conversaciones, filtro])
  const esperando = (conversaciones ?? []).filter((c) => c.estado === 'esperando').length

  return (
    <Pantalla titulo="Chats" subtitulo="Lo que habla Valen con los clientes, en vivo" onRefrescar={cargar}>
      <div className="mv-relleno">
        <Segmentos
          valor={filtro}
          onCambio={setFiltro}
          opciones={[
            { valor: 'todos', texto: 'Todos' },
            { valor: 'esperando', texto: 'Esperando', n: esperando || null },
            { valor: 'whatsapp', texto: 'WhatsApp' },
            { valor: 'instagram', texto: 'Instagram' },
          ]}
        />
      </div>
      {!conversaciones && <Esqueleto filas={8} />}
      {conversaciones && lista.length === 0 && <Vacio icono={MessagesSquare} titulo="Sin conversaciones" texto="Cuando un cliente le escriba al bot, aparece acá al instante." />}
      {lista.length > 0 && (
        <div className="mv-grupo mv-lista-chats">
          {lista.map((c) => {
            const est = ESTADO[c.estado]
            return (
              <Fila
                key={c.clave}
                onClick={() => navigate(c.lead_id ? `/leads/${c.lead_id}` : `/agente/${encodeURIComponent(c.clave)}`)}
                izq={<span className="mv-avatar-canal"><Avatar nombre={c.nombre || c.telefono} tam={48} /><i className={c.canal || ''} /></span>}
                titulo={c.nombre || c.telefono || 'Sin nombre'}
                sub={vistaPrevia(c.ultimoMensaje ?? c.ultimo)}
                der={
                  <span className="mv-fila-der-col">
                    <span className={`mv-hora ${c.estado === 'esperando' ? 'rojo' : ''}`}>{cuandoCorto(c.ultimo.created_at)}</span>
                    {est && <Pastilla tono={est.tono}>{est.texto}</Pastilla>}
                  </span>
                }
              />
            )
          })}
        </div>
      )}
    </Pantalla>
  )
}

// Conversación de alguien que todavía no es lead (solo lectura).
export function ConversacionMovil() {
  const { clave } = useParams()
  const navigate = useNavigate()
  const { conversaciones } = useEventos()
  const c = conversaciones?.find((x) => x.clave === decodeURIComponent(clave))
  const eventos = c ? c.eventos.filter((e) => ['mensaje_entrante', 'mensaje_saliente', 'dato'].includes(e.tipo)) : null
  const cuerpo = useRef(null)
  useLayoutEffect(() => { const el = cuerpo.current; if (el) el.scrollTop = el.scrollHeight }, [eventos?.length])

  return (
    <Pantalla
      titulo={c?.nombre || c?.telefono || 'Conversación'}
      atras
      sinTituloGrande
      className="mv-pantalla-lead en-chat"
      accion={c?.lead_id && <button className="mv-nav-boton" aria-label="Ver lead" onClick={() => navigate(`/leads/${c.lead_id}`)}><ExternalLink size={22} /></button>}
    >
      <div className="mv-chat">
        <div className="mv-chat-cuerpo" ref={cuerpo}>
          {conversaciones && !c ? <div className="mv-chat-vacio">No encontramos esta conversación.</div> : <Burbujas eventos={eventos} vacio="Sin mensajes." />}
        </div>
        <div className="mv-chat-cerrado">Todavía no es lead: cuando deje sus datos vas a poder contestarle desde acá.</div>
      </div>
    </Pantalla>
  )
}
