import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Users, Award, Target, DollarSign, ChevronRight, Phone, MessageCircle, Calendar, Flame, Snowflake, Clock, Zap, CalendarDays, ChevronDown, ChevronUp } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const STATUS_COLORS = { nuevo: '#2563EB', contactado: '#D97706', en_negociacion: '#7C3AED', venta_cerrada: '#16A34A', perdido: '#71717A' }
const TIPO_ICONS = { llamada: Phone, whatsapp: MessageCircle }

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000)
  if (s < 60) return 'Ahora'
  if (s < 3600) return `Hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} hs`
  return `Hace ${Math.floor(s / 86400)} días`
}

function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '-' }
function fmtTime(d) { return new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) }

// Local date key YYYY-MM-DD — uses browser local timezone, NOT UTC
// This ensures a lead created at 23:30 local time is counted on the correct local day
function toLocalDateKey(input) {
  const d = typeof input === 'string' ? new Date(input) : input
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Intelligent Lead Temperature
function getLeadTemp(lead, lastInteraction) {
  const now = Date.now()
  const created = new Date(lead.created_at).getTime()
  const daysSinceCreation = (now - created) / 86400000
  const daysSinceContact = lastInteraction ? (now - new Date(lastInteraction).getTime()) / 86400000 : daysSinceCreation
  const hasBudget = !!lead.presupuesto_estimado
  const hasAppointment = !!lead.fecha_agenda && new Date(lead.fecha_agenda) > new Date()

  let score = 0
  if (lead.estado === 'en_negociacion') score += 40
  else if (lead.estado === 'contactado') score += 20
  else if (lead.estado === 'nuevo') score += 10
  if (hasBudget) score += 15
  if (hasAppointment) score += 20
  if (daysSinceContact < 2) score += 25
  else if (daysSinceContact < 5) score += 10
  else if (daysSinceContact > 10) score -= 20

  if (score >= 60) return { temp: 'hot', label: '🔥 Caliente', color: '#DC2626' }
  if (score >= 30) return { temp: 'warm', label: '🟡 Tibio', color: '#D97706' }
  return { temp: 'cold', label: '🔵 Frío', color: '#2563EB' }
}

export default function DashboardPage() {
  const { profile, isAdmin, user } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [interacciones, setInteracciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDays, setExpandedDays] = useState({})
  const [daysRange, setDaysRange] = useState(30)

  useEffect(() => {
    fetchData()

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        fetchData()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interacciones' }, () => {
        fetchData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function fetchData() {
    try {
      let lq = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(full_name)')
      let iq = supabase.from('interacciones')
        .select('*, lead:leads!lead_id(id, nombre, modelo_interes), usuario:profiles!usuario_id(full_name)')
        .order('fecha', { ascending: false }).limit(15)
      if (!isAdmin) {
        lq = lq.eq('vendedor_asignado', profile.id)
        iq = iq.eq('usuario_id', profile.id)
      }
      const [lr, ir] = await Promise.all([lq, iq])
      setLeads(lr.data || [])
      setInteracciones(ir.data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Last interaction per lead
  const lastIntMap = useMemo(() => {
    const m = {}
    interacciones.forEach(i => {
      if (!m[i.lead_id] || new Date(i.fecha) > new Date(m[i.lead_id])) m[i.lead_id] = i.fecha
    })
    return m
  }, [interacciones])

  // Stats
  const stats = useMemo(() => {
    const total = leads.length
    const ventas = leads.filter(l => l.estado === 'venta_cerrada').length
    const negociacion = leads.filter(l => l.estado === 'en_negociacion').length
    const revenue = leads.filter(l => l.estado === 'venta_cerrada').reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0)
    const pipeline = leads.filter(l => l.estado === 'en_negociacion').reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0)
    const conversion = total > 0 ? ((ventas / total) * 100).toFixed(1) : '0'
    // "Esta semana" = últimos 7 días usando fecha local
    const todayKey = toLocalDateKey(new Date())
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const nuevosEstaSemana = leads.filter(l => {
      const leadDate = new Date(l.created_at)
      return leadDate >= weekAgo
    }).length
    return { total, ventas, negociacion, conversion, revenue, pipeline, nuevosEstaSemana }
  }, [leads])

  // Pie chart
  const pieData = useMemo(() =>
    Object.entries(leads.reduce((a, l) => { a[l.estado] = (a[l.estado] || 0) + 1; return a }, {}))
      .map(([k, v]) => ({ name: STATUS_LABELS[k], value: v, color: STATUS_COLORS[k] })),
    [leads])

  // Intelligent Alerts
  const alerts = useMemo(() => {
    const a = []
    const activeLeads = leads.filter(l => !['venta_cerrada', 'perdido'].includes(l.estado))

    const hotNoAppt = activeLeads.filter(l => {
      const t = getLeadTemp(l, lastIntMap[l.id])
      return t.temp === 'hot' && !l.fecha_agenda
    })
    if (hotNoAppt.length > 0) a.push({ type: 'warning', icon: Flame, title: `${hotNoAppt.length} lead${hotNoAppt.length > 1 ? 's' : ''} caliente${hotNoAppt.length > 1 ? 's' : ''} sin cita agendada`, leads: hotNoAppt.slice(0, 3) })

    const goingCold = activeLeads.filter(l => {
      const days = lastIntMap[l.id] ? (Date.now() - new Date(lastIntMap[l.id])) / 86400000 : (Date.now() - new Date(l.created_at)) / 86400000
      return days > 5 && days < 15
    })
    if (goingCold.length > 0) a.push({ type: 'danger', icon: Snowflake, title: `${goingCold.length} lead${goingCold.length > 1 ? 's' : ''} enfriándose (>5 días sin contacto)`, leads: goingCold.slice(0, 3) })

    const overdue = leads.filter(l => l.fecha_agenda && new Date(l.fecha_agenda) < new Date() && !['venta_cerrada', 'perdido'].includes(l.estado))
    if (overdue.length > 0) a.push({ type: 'info', icon: Clock, title: `${overdue.length} cita${overdue.length > 1 ? 's' : ''} vencida${overdue.length > 1 ? 's' : ''} sin cerrar`, leads: overdue.slice(0, 3) })

    const highValue = activeLeads.filter(l => l.estado === 'en_negociacion' && Number(l.presupuesto_estimado) > 500000)
    if (highValue.length > 0) a.push({ type: 'success', icon: Zap, title: `${highValue.length} oportunidad${highValue.length > 1 ? 'es' : ''} de alto valor en negociación`, leads: highValue.slice(0, 3) })

    return a
  }, [leads, lastIntMap])

  // Today's appointments
  const citasHoy = useMemo(() => {
    const todayKey = toLocalDateKey(new Date())
    return leads.filter(l => l.fecha_agenda && toLocalDateKey(l.fecha_agenda) === todayKey)
      .sort((a, b) => new Date(a.fecha_agenda) - new Date(b.fecha_agenda))
  }, [leads])

  // Leads with temperature
  const leadsWithTemp = useMemo(() =>
    leads.filter(l => !['venta_cerrada', 'perdido'].includes(l.estado))
      .map(l => ({ ...l, tempData: getLeadTemp(l, lastIntMap[l.id]) }))
      .sort((a, b) => {
        const order = { hot: 0, warm: 1, cold: 2 }
        return (order[a.tempData.temp] || 3) - (order[b.tempData.temp] || 3)
      }).slice(0, 8),
    [leads, lastIntMap])

  // Vendor ranking
  const vendorRanking = useMemo(() => {
    if (!isAdmin) return []
    const map = {}
    leads.forEach(l => {
      const name = l.vendedor?.full_name || 'Sin asignar'
      if (!map[name]) map[name] = { name, leads: 0, ventas: 0, revenue: 0 }
      map[name].leads++
      if (l.estado === 'venta_cerrada') { map[name].ventas++; map[name].revenue += Number(l.presupuesto_estimado) || 0 }
    })
    return Object.values(map).sort((a, b) => b.ventas - a.ventas)
  }, [leads, isAdmin])

  // ===== LEADS POR DÍA — Conteo exacto con timezone local =====

  // Step 1: Index ALL leads by their local creation date
  const leadsByLocalDate = useMemo(() => {
    const map = {}
    leads.forEach(l => {
      const key = toLocalDateKey(l.created_at)
      if (!map[key]) map[key] = []
      map[key].push(l)
    })
    return map
  }, [leads])

  // Step 2: Build array for the selected range (today → N days back)
  const dailyData = useMemo(() => {
    const result = []
    const today = new Date()
    // Reset to start of day to avoid partial-day issues
    today.setHours(23, 59, 59, 999)

    for (let i = 0; i < daysRange; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = toLocalDateKey(d)
      const dayLeads = leadsByLocalDate[key] || []
      const weekday = d.toLocaleDateString('es-AR', { weekday: 'long' })
      result.push({
        key,
        dateLabel: d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }),
        fullDate: d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        chartLabel: d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
        dayName: i === 0 ? 'Hoy' : i === 1 ? 'Ayer' : weekday.charAt(0).toUpperCase() + weekday.slice(1),
        leads: dayLeads,
        count: dayLeads.length,
      })
    }
    return result
  }, [leadsByLocalDate, daysRange])

  // Step 3: Chart data (chronological: oldest left → newest right)
  const chartData = useMemo(() => [...dailyData].reverse(), [dailyData])

  // Step 4: Summary — exact counts
  const totalInRange = useMemo(() => dailyData.reduce((s, d) => s + d.count, 0), [dailyData])
  const daysWithLeads = useMemo(() => dailyData.filter(d => d.count > 0).length, [dailyData])
  const avgPerDay = daysRange > 0 ? (totalInRange / daysRange).toFixed(1) : '0'
  const bestDay = useMemo(() => dailyData.reduce((best, d) => d.count > best.count ? d : best, { count: 0, dayName: '-', fullDate: '' }), [dailyData])

  // Leads de hoy (exact)
  const leadsHoy = useMemo(() => {
    const key = toLocalDateKey(new Date())
    return (leadsByLocalDate[key] || []).length
  }, [leadsByLocalDate])

  function toggleDay(key) {
    setExpandedDays(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* KPIs */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><Users size={20} /></div></div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">{isAdmin ? 'Total Leads' : 'Mis Leads'}</div>
          <div className="stat-card-trend up">+{stats.nuevosEstaSemana} esta semana</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><Award size={20} /></div></div>
          <div className="stat-card-value">{stats.ventas}</div>
          <div className="stat-card-label">Ventas Cerradas</div>
          <div className="stat-card-trend up">{stats.conversion}% conversión</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon purple"><Target size={20} /></div></div>
          <div className="stat-card-value">{stats.negociacion}</div>
          <div className="stat-card-label">En Negociación</div>
          <div className="stat-card-trend neutral">{fmt$(stats.pipeline)} pipeline</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><DollarSign size={20} /></div></div>
          <div className="stat-card-value">{fmt$(stats.revenue)}</div>
          <div className="stat-card-label">Revenue</div>
        </div>
      </div>

      {/* Smart Alerts */}
      {alerts.length > 0 && (
        <div className="alerts-grid">
          {alerts.map((alert, idx) => {
            const Icon = alert.icon
            return (
              <div key={idx} className={`alert-card alert-${alert.type}`}>
                <div className="alert-header"><Icon size={16} /> <strong>{alert.title}</strong></div>
                <div className="alert-leads">
                  {alert.leads.map(l => (
                    <div key={l.id} className="alert-lead" onClick={() => navigate(`/leads/${l.id}`)}>
                      <span>{l.nombre}</span>
                      <span className="alert-lead-model">{l.modelo_interes || ''}</span>
                      <ChevronRight size={14} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Leads por Día (admin) — FEATURED SECTION */}
      {isAdmin && (
        <>
          {/* Mini KPIs for leads per day */}
          <div className="lpd-summary-row">
            <div className="lpd-summary-card">
              <div className="lpd-summary-value">{leadsHoy}</div>
              <div className="lpd-summary-label">Leads hoy</div>
            </div>
            <div className="lpd-summary-card">
              <div className="lpd-summary-value">{totalInRange}</div>
              <div className="lpd-summary-label">Últimos {daysRange} días</div>
            </div>
            <div className="lpd-summary-card">
              <div className="lpd-summary-value">{avgPerDay}</div>
              <div className="lpd-summary-label">Promedio diario</div>
            </div>
            {bestDay.count > 0 && (
              <div className="lpd-summary-card lpd-summary-highlight">
                <div className="lpd-summary-value">{bestDay.count}</div>
                <div className="lpd-summary-label">Mejor día · {bestDay.dayName} {bestDay.fullDate}</div>
              </div>
            )}
          </div>

          {/* Chart card */}
          <div className="card">
            <div className="card-header">
              <h3><CalendarDays size={18} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />Leads por Día</h3>
              <select className="filter-select" value={daysRange} onChange={e => setDaysRange(Number(e.target.value))}>
                <option value={7}>7 días</option>
                <option value={14}>14 días</option>
                <option value={30}>30 días</option>
                <option value={60}>60 días</option>
                <option value={90}>90 días</option>
              </select>
            </div>
            <div className="card-body">
              <div className="leads-per-day-chart">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EBEBF0" vertical={false} />
                    <XAxis
                      dataKey="chartLabel"
                      tick={{ fontSize: 11, fill: '#8E8E93' }}
                      interval={daysRange <= 14 ? 0 : daysRange <= 30 ? 2 : 6}
                      angle={daysRange > 14 ? -45 : 0}
                      textAnchor={daysRange > 14 ? 'end' : 'middle'}
                      height={daysRange > 14 ? 50 : 30}
                      axisLine={{ stroke: '#EBEBF0' }}
                      tickLine={false}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#8E8E93' }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(0,122,255,0.04)' }}
                      contentStyle={{ background: '#fff', border: '1px solid #EBEBF0', borderRadius: '10px', fontSize: '0.8125rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                      formatter={(value) => [`${value} lead${value !== 1 ? 's' : ''}`, 'Cantidad']}
                      labelFormatter={(label) => `${label}`}
                    />
                    <Bar dataKey="count" fill="#007AFF" radius={[6, 6, 0, 0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Daily breakdown accordion */}
          <div className="card">
            <div className="card-header">
              <h3>Detalle por Día</h3>
              <span className="lpd-header-count">{totalInRange} leads en {daysRange} días · {daysWithLeads} días activos</span>
            </div>
            <div className="card-body-flush">
              {daysWithLeads === 0 ? (
                <div className="empty-state" style={{ padding: '40px 20px' }}><p>No hay leads en este período</p></div>
              ) : (
                <div className="lpd-day-list">
                  {dailyData.map(day => {
                    if (day.count === 0) return null
                    const isExpanded = expandedDays[day.key]
                    // Count statuses
                    const counts = {}
                    day.leads.forEach(l => { counts[l.estado] = (counts[l.estado] || 0) + 1 })
                    return (
                      <div key={day.key} className={`lpd-day-block ${isExpanded ? 'expanded' : ''}`}>
                        <div className="lpd-day-header" onClick={() => toggleDay(day.key)}>
                          <div className="lpd-day-left">
                            <span className="lpd-day-toggle">
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </span>
                            <div className="lpd-day-date">
                              <span className="lpd-day-name">{day.dayName}</span>
                              <span className="lpd-day-full">{day.fullDate}</span>
                            </div>
                          </div>
                          <div className="lpd-day-right">
                            <div className="lpd-day-badges">
                              {Object.entries(counts).map(([estado, n]) => (
                                <span key={estado} className={`badge badge-${estado}`}>{n} {STATUS_LABELS[estado]}</span>
                              ))}
                            </div>
                            <span className="lpd-total-badge">{day.count}</span>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="lpd-day-body">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Nombre</th>
                                  <th>Teléfono</th>
                                  <th>Modelo</th>
                                  <th>Estado</th>
                                  <th>Presupuesto</th>
                                  <th>Vendedor</th>
                                  <th>Hora</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...day.leads]
                                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                                  .map(l => (
                                  <tr key={l.id} className="clickable" onClick={() => navigate(`/leads/${l.id}`)}>
                                    <td className="table-cell-primary">{l.nombre}</td>
                                    <td>{l.telefono || '-'}</td>
                                    <td>{l.modelo_interes || '-'}</td>
                                    <td><span className={`badge badge-${l.estado}`}>{STATUS_LABELS[l.estado]}</span></td>
                                    <td>{fmt$(l.presupuesto_estimado)}</td>
                                    <td className="table-cell-secondary">{l.vendedor?.full_name || '-'}</td>
                                    <td className="table-cell-secondary">{new Date(l.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Citas Hoy / Temperature */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>{citasHoy.length > 0 ? `📅 Citas Hoy (${citasHoy.length})` : '🌡️ Temperatura de Leads'}</h3>
            {citasHoy.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => navigate('/agenda')}><Calendar size={14} /> Agenda</button>}
          </div>
          <div className="card-body">
            {citasHoy.length > 0 ? citasHoy.map(l => (
              <div key={l.id} className="followup-item" onClick={() => navigate(`/leads/${l.id}`)}>
                <div className="followup-dot" style={{ background: '#DC2626' }} />
                <div className="followup-info">
                  <div className="followup-name">{l.nombre}</div>
                  <div className="followup-sub">{l.modelo_interes || ''}</div>
                </div>
                <span className="followup-badge">{fmtTime(l.fecha_agenda)}</span>
                <ChevronRight size={16} className="followup-arrow" />
              </div>
            )) : leadsWithTemp.length > 0 ? leadsWithTemp.map(l => (
              <div key={l.id} className="followup-item" onClick={() => navigate(`/leads/${l.id}`)}>
                <div className="followup-dot" style={{ background: l.tempData.color }} />
                <div className="followup-info">
                  <div className="followup-name">{l.nombre}</div>
                  <div className="followup-sub">{l.modelo_interes || ''} · {STATUS_LABELS[l.estado]}</div>
                </div>
                <span className="followup-badge" style={{ color: l.tempData.color }}>{l.tempData.label}</span>
                <ChevronRight size={16} className="followup-arrow" />
              </div>
            )) : <div className="empty-state"><p>Sin leads activos</p></div>}
          </div>
        </div>

        {/* Activity */}
        <div className="card">
          <div className="card-header"><h3>{isAdmin ? 'Actividad Reciente' : 'Mi Actividad'}</h3></div>
          <div className="card-body">
            {interacciones.length > 0 ? interacciones.slice(0, 8).map(a => {
              const Icon = TIPO_ICONS[a.tipo] || Phone
              return (
                <div key={a.id} className="feed-item" onClick={() => navigate(`/leads/${a.lead?.id}`)}>
                  <div className="feed-icon"><Icon size={14} /></div>
                  <div className="feed-body">
                    <div className="feed-text">
                      {isAdmin && <><strong>{a.usuario?.full_name}</strong> → {a.tipo} con </>}
                      {!isAdmin && <>Registraste {a.tipo} con </>}
                      <span className="highlight">{a.lead?.nombre}</span>
                    </div>
                    <div className="feed-time">{timeAgo(a.fecha)}</div>
                  </div>
                </div>
              )
            }) : <div className="empty-state"><p>Sin actividad</p></div>}
          </div>
        </div>
      </div>

      {/* Vendor Ranking (admin) / My Performance (employee) */}
      {isAdmin && vendorRanking.length > 0 && (
        <div className="card">
          <div className="card-header"><h3>Ranking Vendedores</h3></div>
          <div className="card-body-flush">
            <table className="data-table">
              <thead><tr><th>#</th><th>Vendedor</th><th>Leads</th><th>Ventas</th><th>Conv.</th><th>Revenue</th></tr></thead>
              <tbody>
                {vendorRanking.map((v, i) => (
                  <tr key={i}>
                    <td><span className={`leaderboard-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze'}`}>{i + 1}</span></td>
                    <td className="table-cell-primary">{v.name}</td>
                    <td>{v.leads}</td>
                    <td>{v.ventas}</td>
                    <td>{v.leads > 0 ? ((v.ventas / v.leads) * 100).toFixed(0) : 0}%</td>
                    <td>{fmt$(v.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isAdmin && (
        <div className="card">
          <div className="card-header"><h3>Mi Rendimiento</h3></div>
          <div className="card-body">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}>
                    {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="empty-state"><p>Sin datos</p></div>}
          </div>
        </div>
      )}
    </div>
  )
}
