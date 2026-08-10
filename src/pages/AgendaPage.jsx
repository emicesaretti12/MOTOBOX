import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Calendar, Clock, ChevronLeft, ChevronRight, Phone, MessageCircle, Plus, MapPin } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const DAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function getWa(ph) { if (!ph) return null; const c = ph.replace(/\D/g, ''); return 'https://wa.me/' + (c.startsWith('54') ? c : '54' + c) }
function fmtTime(d) { return new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) }
function isSameDay(a, b) { return a.toDateString() === b.toDateString() }
function isToday(d) { return d.toDateString() === new Date().toDateString() }
function isPast(d) { return d < new Date() && !isToday(d) }

function getDaysInRange(start, count) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

function getMonday(offset) {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7
  return new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0)
}

export default function AgendaPage() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [allLeads, setAllLeads] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [filterVendedor, setFilterVendedor] = useState('')
  const [viewMode, setViewMode] = useState('semana') // semana | dia

  const today = new Date()
  const monday = useMemo(() => getMonday(weekOffset), [weekOffset])
  const weekDays = useMemo(() => getDaysInRange(monday, 7), [monday])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    try {
      let q = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(id, full_name)')
      if (!isAdmin) q = q.eq('vendedor_asignado', profile.id)
      const { data } = await q
      const all = data || []
      setAllLeads(all)
      setLeads(all.filter(l => l.fecha_agenda))
      if (isAdmin) {
        const { data: v } = await supabase.from('profiles').select('id, full_name').order('full_name')
        setVendedores(v || [])
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const filteredLeads = useMemo(() => {
    let f = leads
    if (filterVendedor) f = f.filter(l => l.vendedor_asignado === filterVendedor)
    return f
  }, [leads, filterVendedor])

  // Stats
  const stats = useMemo(() => ({
    hoy: leads.filter(l => l.fecha_agenda && isToday(new Date(l.fecha_agenda))).length,
    semana: leads.filter(l => { const d = new Date(l.fecha_agenda); return d >= weekDays[0] && d <= new Date(weekDays[6].getTime() + 86400000) }).length,
    vencidas: leads.filter(l => isPast(new Date(l.fecha_agenda)) && !['venta_cerrada', 'perdido'].includes(l.estado)).length,
    sinAgendar: allLeads.filter(l => !l.fecha_agenda && !['venta_cerrada', 'perdido'].includes(l.estado)).length
  }), [leads, allLeads, weekDays])

  function getEventsForDay(date) {
    return filteredLeads.filter(l => isSameDay(new Date(l.fecha_agenda), date))
      .sort((a, b) => new Date(a.fecha_agenda) - new Date(b.fecha_agenda))
  }

  function fmtWeekRange() {
    const start = weekDays[0]
    const end = weekDays[6]
    if (start.getMonth() === end.getMonth()) {
      return `${start.getDate()} - ${end.getDate()} de ${start.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`
    }
    return `${start.getDate()} ${start.toLocaleDateString('es-AR', { month: 'short' })} - ${end.getDate()} ${end.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })}`
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon red"><Calendar size={20} /></div></div><div className="stat-card-value">{stats.hoy}</div><div className="stat-card-label">Citas Hoy</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon blue"><Clock size={20} /></div></div><div className="stat-card-value">{stats.semana}</div><div className="stat-card-label">Esta Semana</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon purple"><Calendar size={20} /></div></div><div className="stat-card-value">{stats.vencidas}</div><div className="stat-card-label">Vencidas</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon yellow"><Calendar size={20} /></div></div><div className="stat-card-value">{stats.sinAgendar}</div><div className="stat-card-label">Sin Agendar</div></div>
      </div>

      {/* Toolbar */}
      <div className="filters-bar">
        <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(w => w - 1)}><ChevronLeft size={16} /></button>
        <button className="btn btn-primary btn-sm" onClick={() => setWeekOffset(0)}>Hoy</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(w => w + 1)}><ChevronRight size={16} /></button>
        <span className="results-count" style={{ fontWeight: 700, color: '#18181B', textTransform: 'capitalize' }}>{fmtWeekRange()}</span>
        {isAdmin && (
          <select className="filter-select" value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)}>
            <option value="">Todos los vendedores</option>
            {vendedores.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
          </select>
        )}
      </div>

      {/* Mini Calendar Strip */}
      <div className="agenda-strip">
        {weekDays.map((date, i) => {
          const events = getEventsForDay(date)
          const isT = isToday(date)
          const isP = isPast(date)
          return (
            <div key={i} className={`agenda-strip-day ${isT ? 'today' : ''} ${isP ? 'past' : ''}`}>
              <div className="agenda-strip-name">{DAY_NAMES_SHORT[date.getDay()]}</div>
              <div className="agenda-strip-num">{date.getDate()}</div>
              {events.length > 0 && <div className="agenda-strip-dots">{events.length}</div>}
            </div>
          )
        })}
      </div>

      {/* Day-by-day list */}
      <div className="agenda-days">
        {weekDays.map((date, dayIdx) => {
          const events = getEventsForDay(date)
          const isT = isToday(date)
          const isP = isPast(date)
          if (events.length === 0 && isP) return null // hide empty past days
          return (
            <div key={dayIdx} className={`agenda-day-block ${isT ? 'today' : ''}`}>
              <div className="agenda-day-header">
                <div className="agenda-day-title">
                  <span className="agenda-day-name">{isT ? '📍 Hoy' : date.toLocaleDateString('es-AR', { weekday: 'long' })}</span>
                  <span className="agenda-day-date">{date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })}</span>
                </div>
                <span className="agenda-day-count">{events.length} cita{events.length !== 1 ? 's' : ''}</span>
              </div>

              {events.length > 0 ? (
                <div className="agenda-events">
                  {events.map(l => (
                    <div key={l.id} className={`agenda-event agenda-event-${l.estado}`} onClick={() => navigate(`/leads/${l.id}`)}>
                      <div className="agenda-event-time">{fmtTime(l.fecha_agenda)}</div>
                      <div className="agenda-event-body">
                        <div className="agenda-event-name">{l.nombre}</div>
                        <div className="agenda-event-meta">
                          {l.modelo_interes && <span>{l.modelo_interes}</span>}
                          {isAdmin && l.vendedor?.full_name && <span>· {l.vendedor.full_name}</span>}
                        </div>
                      </div>
                      <div className="agenda-event-actions" onClick={e => e.stopPropagation()}>
                        {l.telefono && getWa(l.telefono) && <a href={getWa(l.telefono)} target="_blank" rel="noopener" className="btn-icon whatsapp"><MessageCircle size={15} /></a>}
                        {l.telefono && <a href={`tel:${l.telefono}`} className="btn-icon phone"><Phone size={15} /></a>}
                      </div>
                      <span className={`badge badge-${l.estado}`} style={{ fontSize: '0.625rem' }}>{STATUS_LABELS[l.estado]}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="agenda-empty">Sin citas este día</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
