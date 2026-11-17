import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { LEAD_STATUS_LABELS, LEAD_ORIGEN_LABELS } from '../lib/constants'
import { useLeads } from './datos'
import { Pantalla, Avatar, Fila, Pastilla, Vacio, Esqueleto, Hoja, Campo } from './ui'
import { agruparPorFecha, buscar, cuandoCorto } from './formato'

const FILTROS = [
  { valor: 'todos', texto: 'Todos', f: () => true },
  { valor: 'alta', texto: 'Listos para comprar', f: (l) => l.prioridad === 'alta' && ['nuevo', 'contactado', 'en_negociacion'].includes(l.estado) },
  { valor: 'nuevo', texto: 'Nuevos', f: (l) => l.estado === 'nuevo' },
  { valor: 'contactado', texto: 'Contactados', f: (l) => l.estado === 'contactado' },
  { valor: 'en_negociacion', texto: 'En negociación', f: (l) => l.estado === 'en_negociacion' },
  { valor: 'venta_cerrada', texto: 'Vendidos', f: (l) => l.estado === 'venta_cerrada' },
  { valor: 'perdido', texto: 'Perdidos', f: (l) => l.estado === 'perdido' },
]
const TONO_ESTADO = { nuevo: 'azul', contactado: 'naranja', en_negociacion: 'violeta', venta_cerrada: 'verde', perdido: 'gris' }
const POR_TANDA = 60

export default function LeadsMovil() {
  const navigate = useNavigate()
  const { leads, error, cargar } = useLeads()
  const [texto, setTexto] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [mostrar, setMostrar] = useState(POR_TANDA)
  const [nuevo, setNuevo] = useState(false)

  const lista = useMemo(() => {
    const f = FILTROS.find((x) => x.valor === filtro)?.f ?? (() => true)
    return (leads || []).filter((l) => f(l) && buscar(l, texto))
  }, [leads, filtro, texto])
  const grupos = useMemo(() => agruparPorFecha(lista.slice(0, mostrar), 'created_at'), [lista, mostrar])

  return (
    <Pantalla
      titulo="Leads"
      onRefrescar={cargar}
      accion={<button className="mv-nav-boton" aria-label="Nuevo lead" onClick={() => setNuevo(true)}><Plus size={26} /></button>}
    >
      <div className="mv-buscador">
        <Search size={17} />
        <input type="search" placeholder="Buscar nombre, teléfono o moto" value={texto} onChange={(e) => { setTexto(e.target.value); setMostrar(POR_TANDA) }} />
        {texto && <button aria-label="Borrar" onClick={() => setTexto('')}><X size={16} /></button>}
      </div>
      <div className="mv-chips">
        {FILTROS.map((f) => (
          <button key={f.valor} className={filtro === f.valor ? 'activo' : ''} onClick={() => { setFiltro(f.valor); setMostrar(POR_TANDA) }}>{f.texto}</button>
        ))}
      </div>

      {error && <Vacio titulo="Sin conexión" texto={error} />}
      {!leads && !error && <Esqueleto filas={8} />}
      {leads && lista.length === 0 && <Vacio icono={Users} titulo="Sin resultados" texto={texto ? 'Probá con otro nombre o número.' : 'No hay leads en este filtro.'} />}

      {grupos.map((g) => (
        <section key={g.titulo} className="mv-seccion">
          <div className="mv-seccion-titulo"><span>{g.titulo}</span></div>
          <div className="mv-grupo">
            {g.items.map((l) => (
              <Fila
                key={l.id}
                onClick={() => navigate(`/leads/${l.id}`)}
                izq={<Avatar nombre={l.nombre} />}
                titulo={l.nombre || 'Sin nombre'}
                sub={[l.modelo_interes, LEAD_ORIGEN_LABELS[l.origen]].filter(Boolean).join(' · ') || 'Sin moto elegida'}
                der={<span className="mv-fila-der-col"><span className="mv-hora">{cuandoCorto(l.created_at)}</span><Pastilla tono={TONO_ESTADO[l.estado]}>{LEAD_STATUS_LABELS[l.estado]}</Pastilla></span>}
              />
            ))}
          </div>
        </section>
      ))}
      {lista.length > mostrar && <button className="mv-mas" onClick={() => setMostrar((n) => n + POR_TANDA)}>Ver más ({lista.length - mostrar})</button>}
      {leads && <p className="mv-pie-lista">{lista.length} {lista.length === 1 ? 'lead' : 'leads'}</p>}

      <HojaNuevoLead abierta={nuevo} onCerrar={() => setNuevo(false)} onCreado={(id) => navigate(`/leads/${id}`)} />
    </Pantalla>
  )
}

function HojaNuevoLead({ abierta, onCerrar, onCreado }) {
  const { profile } = useAuth()
  const { addToast } = useToast()
  const [f, setF] = useState({ nombre: '', telefono: '', modelo_interes: '', origen: 'presencial' })
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    if (!f.nombre.trim()) { addToast('Poné el nombre', 'error'); return }
    setGuardando(true)
    const { data, error } = await supabase.from('leads')
      .insert({ ...f, nombre: f.nombre.trim(), telefono: f.telefono.trim() || null, modelo_interes: f.modelo_interes.trim() || null, estado: 'nuevo', vendedor_asignado: profile.id })
      .select('id').single()
    setGuardando(false)
    if (error) { addToast('No se pudo crear el lead', 'error'); return }
    addToast('Lead creado', 'success')
    setF({ nombre: '', telefono: '', modelo_interes: '', origen: 'presencial' })
    onCerrar()
    onCreado(data.id)
  }

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Nuevo lead" pie={<button className="mv-boton" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Crear lead'}</button>}>
      <div className="mv-form">
        <Campo etiqueta="Nombre"><input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre y apellido" /></Campo>
        <Campo etiqueta="Teléfono"><input type="tel" inputMode="tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} placeholder="351 123 4567" /></Campo>
        <Campo etiqueta="Moto que le interesa"><input value={f.modelo_interes} onChange={(e) => setF({ ...f, modelo_interes: e.target.value })} placeholder="Ej: Honda Wave S" /></Campo>
        <Campo etiqueta="De dónde vino">
          <select value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value })}>{Object.entries(LEAD_ORIGEN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Campo>
      </div>
    </Hoja>
  )
}
