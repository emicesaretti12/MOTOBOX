import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const DAY_NAMES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7) // 7:00 to 20:00

function getWeekDates(offset) {
  const now = new Date()
  const day = now.getDay()
  const mondayDiff = now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7
  const monday = new Date(now.getFullYear(), now.getMonth(), mondayDiff)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function isSameDay(a, b) { return a.toDateString() === b.toDateString() }
function fmtTime(d) { return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) }
function fmtMonthYear(d) { return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) }

export default function AgendaPage() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [allLeads, setAllLeads] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [filterVendedor, setFilterVendedor] = useState('')
  const gridRef = useRef(null)

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset])
  const today = new Date()

  useEffect(() => { fetchData() }, [])

  useEffect(() => {
    // Scroll to 8am on load
    if (gridRef.current) {
      const hourHeight = 48
      gridRef.current.scrollTop = hourHeight * 1 // scroll past 7:00
    }
  }, [loading])

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
  const stats = useMemo(() => {
    const todayStr = today.toDateString()
    const weekStart = weekDates[0]
    const weekEnd = new Date(weekDates[6]); weekEnd.setHours(23, 59, 59)
    return {
      hoy: leads.filter(l => new Date(l.fecha_agenda).toDateString() === todayStr).length,
      semana: leads.filter(l => { const d = new Date(l.fecha_agenda); return d >= weekStart && d <= weekEnd }).length,
      pendientes: leads.filter(l => new Date(l.fecha_agenda) < today && !isSameDay(new Date(l.fecha_agenda), today) && !['venta_cerrada', 'perdido'].includes(l.estado)).length,
      sinAgendar: allLeads.filter(l => !l.fecha_agenda && !['venta_cerrada', 'perdido'].includes(l.estado)).length
    }
  }, [leads, allLeads, weekDates])

  // Get events for a specific day
  function getEventsForDay(date) {
    return filteredLeads.filter(l => isSameDay(new Date(l.fecha_agenda), date))
      .sort((a, b) => new Date(a.fecha_agenda) - new Date(b.fecha_agenda))
  }

  // Calculate event position in the grid
  function getEventStyle(lead) {
    const d = new Date(lead.fecha_agenda)
    const hour = d.getHours()
    const minutes = d.getMinutes()
    const topOffset = (hour - 7) * 48 + (minutes / 60) * 48
    return { top: `${topOffset}px`, height: '36px' }
  }

  // Now line position
  function getNowLineTop() {
    const now = new Date()
    const hour = now.getHours()
    const minutes = now.getMinutes()
    if (hour < 7 || hour > 20) return null
    return (hour - 7) * 48 + (minutes / 60) * 48
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  const nowTop = getNowLineTop()

  return (
    <div>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><Calendar size={20} /></div></div>
          <div className="stat-card-value">{stats.hoy}</div>
          <div className="stat-card-label">Citas Hoy</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><Clock size={20} /></div></div>
          <div className="stat-card-value">{stats.semana}</div>
          <div className="stat-card-label">Esta Semana</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon purple"><Calendar size={20} /></div></div>
          <div className="stat-card-value">{stats.pendientes}</div>
          <div className="stat-card-label">Vencidas</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon yellow"><Calendar size={20} /></div></div>
          <div className="stat-card-value">{stats.sinAgendar}</div>
          <div className="stat-card-label">Sin Agendar</div>
        </div>
      </div>

      {/* Calendar Container */}
      <div className="cal-container">
        {/* Toolbar */}
        <div className="cal-toolbar">
          <div className="cal-toolbar-nav">
            <button className="cal-toolbar-today" onClick={() => setWeekOffset(0)}>Hoy</button>
            <button className="cal-toolbar-arrow" onClick={() => setWeekOffset(w => w - 1)}><ChevronLeft size={18} /></button>
            <button className="cal-toolbar-arrow" onClick={() => setWeekOffset(w => w + 1)}><ChevronRight size={18} /></button>
            <span className="cal-toolbar-title">{fmtMonthYear(weekDates[0])}</span>
          </div>
          <div className="cal-toolbar-nav">
            {isAdmin && (
              <select className="filter-select" value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)}>
                <option value="">Todos los vendedores</option>
                {vendedores.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Header row (days) */}
        <div className="cal-header">
          <div className="cal-header-cell"></div>
          {weekDates.map((date, i) => (
            <div key={i} className={`cal-header-cell ${isSameDay(date, today) ? 'today' : ''}`}>
              <div className="cal-header-day">{DAY_NAMES[date.getDay()]}</div>
              <div className="cal-header-num">{date.getDate()}</div>
            </div>
          ))}
        </div>

        {/* Time Grid */}
        <div className="cal-grid-wrap" ref={gridRef}>
          <div className="cal-grid">
            {/* Time labels column */}
            <div className="cal-time-col">
              {HOURS.map(h => (
                <div key={h} className="cal-time-label">{`${h}:00`}</div>
              ))}
            </div>

            {/* Day columns */}
            {weekDates.map((date, dayIdx) => {
              const events = getEventsForDay(date)
              const isToday = isSameDay(date, today)
              return (
                <div key={dayIdx} className={`cal-day-col ${isToday ? 'today' : ''}`}>
                  {HOURS.map(h => <div key={h} className="cal-hour-row" />)}

                  {/* Now indicator */}
                  {isToday && nowTop !== null && <div className="cal-now-line" style={{ top: `${nowTop}px` }} />}

                  {/* Events */}
                  {events.map(lead => (
                    <div
                      key={lead.id}
                      className={`cal-event cal-event-${lead.estado}`}
                      style={getEventStyle(lead)}
                      onClick={() => navigate(`/leads/${lead.id}`)}
                      title={`${lead.nombre} - ${lead.modelo_interes || ''} (${fmtTime(new Date(lead.fecha_agenda))})`}
                    >
                      <div className="cal-event-title">{lead.nombre}</div>
                      <div className="cal-event-time">{fmtTime(new Date(lead.fecha_agenda))}{lead.modelo_interes ? ` · ${lead.modelo_interes}` : ''}</div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Mobile list fallback */}
        <div className="cal-list">
          {weekDates.map((date, i) => {
            const events = getEventsForDay(date)
            if (events.length === 0) return null
            return (
              <div key={i}>
                <div className={`cal-list-day ${isSameDay(date, today) ? 'today' : ''}`}>
                  {date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                {events.map(l => (
                  <div key={l.id} className="cal-list-event" onClick={() => navigate(`/leads/${l.id}`)}>
                    <div className="cal-list-time">{fmtTime(new Date(l.fecha_agenda))}</div>
                    <div className="cal-list-info">
                      <div className="cal-list-name">{l.nombre}</div>
                      <div className="cal-list-model">{l.modelo_interes || ''} {l.vendedor?.full_name ? `· ${l.vendedor.full_name}` : ''}</div>
                    </div>
                    <span className={`badge badge-${l.estado}`}>{STATUS_LABELS[l.estado]}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
