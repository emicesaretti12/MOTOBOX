import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Users, TrendingUp, Target, Award, DollarSign, AlertCircle, ChevronRight, Phone, MessageCircle, Mail, MapPin, MoreHorizontal } from 'lucide-react'

const STATUS_COLORS = { nuevo: '#2563EB', contactado: '#D97706', en_negociacion: '#7C3AED', venta_cerrada: '#16A34A', perdido: '#71717A' }
const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }

const TIPO_ICONS = {
  llamada: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  visita: MapPin,
  otro: MoreHorizontal
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const seconds = Math.floor((now - date) / 1000)
  
  if (seconds < 60) return 'Hace un momento'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`
  const days = Math.floor(hours / 24)
  if (days < 30) return `Hace ${days} ${days === 1 ? 'día' : 'días'}`
  const months = Math.floor(days / 30)
  return `Hace ${months} ${months === 1 ? 'mes' : 'meses'}`
}

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  
  const [stats, setStats] = useState({ total: 0, closed: 0, negotiating: 0, conversion: 0, totalTrend: 0, closedTrend: 0, negotiatingTrend: 0, conversionTrend: 0 })
  const [funnelData, setFunnelData] = useState([])
  const [followupLeads, setFollowupLeads] = useState([])
  const [chartData, setChartData] = useState([])
  const [activityFeed, setActivityFeed] = useState([])
  const [leaderboard, setLeaderboard] = useState([])

  useEffect(() => {
    fetchData()
  }, [user])

  const fetchData = async () => {
    try {
      setLoading(true)
      
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile(prof)

      const isAdmin = prof?.role === 'admin'
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      let leadsQuery = supabase.from('leads').select('id, nombre, modelo_interes, estado, vendedor_asignado, presupuesto_estimado, created_at, vendedor:profiles!vendedor_asignado(full_name)')
      let interaccionesQuery = supabase.from('interacciones').select('id, lead_id, usuario_id, tipo, detalle, fecha, usuario:profiles!usuario_id(full_name), lead:leads!lead_id(id, nombre, modelo_interes)')
      
      if (!isAdmin) {
        leadsQuery = leadsQuery.eq('vendedor_asignado', prof.id)
        interaccionesQuery = interaccionesQuery.eq('usuario_id', prof.id)
      }

      const [{ data: leads = [] }, { data: interacciones = [] }] = await Promise.all([
        leadsQuery,
        interaccionesQuery.order('fecha', { ascending: false })
      ])

      // Calculate Stats
      const total = leads.length
      const closed = leads.filter(l => l.estado === 'venta_cerrada').length
      const negotiating = leads.filter(l => l.estado === 'en_negociacion').length
      const conversion = total > 0 ? ((closed / total) * 100).toFixed(1) : 0

      const recentLeads = leads.filter(l => new Date(l.created_at) > sevenDaysAgo)
      const totalTrend = recentLeads.length
      const closedTrend = recentLeads.filter(l => l.estado === 'venta_cerrada').length
      const negotiatingTrend = recentLeads.filter(l => l.estado === 'en_negociacion').length

      setStats({ total, closed, negotiating, conversion, totalTrend, closedTrend, negotiatingTrend, conversionTrend: 0 })

      // Calculate Funnel Data
      const getCount = (estado) => leads.filter(l => l.estado === estado).length
      const maxFunnel = Math.max(1, total) // Prevent division by 0
      setFunnelData([
        { label: STATUS_LABELS.nuevo, count: getCount('nuevo'), percent: (getCount('nuevo') / maxFunnel) * 100 },
        { label: STATUS_LABELS.contactado, count: getCount('contactado'), percent: (getCount('contactado') / maxFunnel) * 100 },
        { label: STATUS_LABELS.en_negociacion, count: getCount('en_negociacion'), percent: (getCount('en_negociacion') / maxFunnel) * 100 },
        { label: STATUS_LABELS.venta_cerrada, count: getCount('venta_cerrada'), percent: (getCount('venta_cerrada') / maxFunnel) * 100 }
      ])

      // Follow-ups
      const activeLeads = leads.filter(l => l.estado !== 'venta_cerrada' && l.estado !== 'perdido')
      const latestInt = {}
      interacciones.forEach(int => {
        const intDate = new Date(int.fecha)
        if (!latestInt[int.lead_id] || intDate > latestInt[int.lead_id]) {
          latestInt[int.lead_id] = intDate
        }
      })

      const followups = activeLeads.map(l => {
        const last = latestInt[l.id]
        const days = last ? Math.floor((new Date() - last) / (1000 * 60 * 60 * 24)) : Math.floor((new Date() - new Date(l.created_at)) / (1000 * 60 * 60 * 24))
        return { ...l, days, hasLast: !!last }
      }).filter(l => !l.hasLast || l.days >= 7)
        .sort((a, b) => b.days - a.days)
        .slice(0, 5)
      
      setFollowupLeads(followups)

      // Chart Data
      const pieData = Object.keys(STATUS_LABELS).map(key => ({
        name: STATUS_LABELS[key],
        value: leads.filter(l => l.estado === key).length,
        color: STATUS_COLORS[key]
      })).filter(d => d.value > 0)
      setChartData(pieData)

      // Feed
      setActivityFeed(interacciones.slice(0, 8))

      // Leaderboard
      if (isAdmin) {
        const sellers = {}
        leads.forEach(l => {
          const sellerId = l.vendedor_asignado
          if (!sellerId) return
          if (!sellers[sellerId]) {
            sellers[sellerId] = { id: sellerId, name: l.vendedor?.full_name || 'Desconocido', total: 0, ventas: 0, revenue: 0 }
          }
          sellers[sellerId].total += 1
          if (l.estado === 'venta_cerrada') {
            sellers[sellerId].ventas += 1
            sellers[sellerId].revenue += (l.presupuesto_estimado || 0)
          }
        })
        const lb = Object.values(sellers).map(s => ({
          ...s,
          conversion: s.total > 0 ? ((s.ventas / s.total) * 100).toFixed(1) : 0
        })).sort((a, b) => b.ventas - a.ventas)
        setLeaderboard(lb)
      }

    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="spinner-overlay">
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 text-gray-800">Dashboard</h1>
      
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-card-icon blue"><Users /></div>
            <div className="stat-card-trend up">+{stats.totalTrend} esta sem.</div>
          </div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Total Leads</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-card-icon green"><Award /></div>
            <div className="stat-card-trend up">+{stats.closedTrend} esta sem.</div>
          </div>
          <div className="stat-card-value">{stats.closed}</div>
          <div className="stat-card-label">Ventas Cerradas</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-card-icon purple"><Target /></div>
            <div className="stat-card-trend neutral">+{stats.negotiatingTrend} esta sem.</div>
          </div>
          <div className="stat-card-value">{stats.negotiating}</div>
          <div className="stat-card-label">En Negociación</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-card-icon yellow"><TrendingUp /></div>
            <div className="stat-card-trend neutral">Avg</div>
          </div>
          <div className="stat-card-value">{stats.conversion}%</div>
          <div className="stat-card-label">Tasa de Conversión</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-800">Funnel de Conversión</h3>
          </div>
          <div className="card-body">
            {funnelData.map(step => (
              <div key={step.label} className="funnel-step">
                <div className="funnel-label">{step.label}</div>
                <div className="funnel-track">
                  <div className="funnel-fill" style={{ width: `${step.percent}%` }}></div>
                </div>
                <div className="funnel-count">{step.count}</div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <AlertCircle size={18} className="text-amber-500"/> Alertas de Seguimiento
            </h3>
          </div>
          <div className="card-body">
            {followupLeads.length === 0 ? (
              <div className="empty-state">No hay alertas de seguimiento.</div>
            ) : (
              followupLeads.map(lead => (
                <div key={lead.id} className="followup-item" onClick={() => navigate(`/leads/${lead.id}`)}>
                  <div className="followup-dot"></div>
                  <div className="followup-info">
                    <div className="followup-name">{lead.nombre}</div>
                    <div className="followup-sub">{lead.modelo_interes || 'Sin modelo'}</div>
                  </div>
                  <div className="followup-badge">
                    {lead.hasLast ? `+${lead.days} días` : 'Sin contacto'}
                  </div>
                  <button className="followup-arrow"><ChevronRight size={16} /></button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-800">Leads por Estado</h3>
          </div>
          <div className="card-body" style={{ height: '300px' }}>
            {chartData.length === 0 ? (
              <div className="empty-state">Sin datos</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [value, name]} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-800">Actividad Reciente</h3>
          </div>
          <div className="card-body">
            {activityFeed.length === 0 ? (
              <div className="empty-state">No hay actividad reciente.</div>
            ) : (
              activityFeed.map(act => {
                const Icon = TIPO_ICONS[act.tipo] || MoreHorizontal
                return (
                  <div key={act.id} className="feed-item">
                    <div className="feed-icon"><Icon size={14} /></div>
                    <div className="feed-body">
                      <div className="feed-text">
                        <strong>{act.usuario?.full_name || 'Alguien'}</strong> registró {act.tipo} con <span className="highlight">{act.lead?.nombre || 'Lead'}</span>
                      </div>
                      <div className="feed-time">{timeAgo(act.fecha)}</div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {profile?.role === 'admin' && (
        <div className="card mt-6">
          <div className="card-header">
            <h3 className="font-semibold text-gray-800">Rendimiento de Vendedores</h3>
          </div>
          <div className="card-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="table-cell-primary">Pos</th>
                  <th className="table-cell-primary">Vendedor</th>
                  <th className="table-cell-secondary">Leads</th>
                  <th className="table-cell-secondary">Ventas</th>
                  <th className="table-cell-secondary">Conversión</th>
                  <th className="table-cell-secondary">Ingresos Est.</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((lb, index) => {
                  let rankClass = ''
                  if (index === 0) rankClass = 'gold'
                  else if (index === 1) rankClass = 'silver'
                  else if (index === 2) rankClass = 'bronze'
                  
                  return (
                    <tr key={lb.id}>
                      <td className="table-cell-primary">
                        <span className={`leaderboard-rank ${rankClass}`}>{index + 1}</span>
                      </td>
                      <td className="table-cell-primary">{lb.name}</td>
                      <td className="table-cell-secondary">{lb.total}</td>
                      <td className="table-cell-secondary">{lb.ventas}</td>
                      <td className="table-cell-secondary">{lb.conversion}%</td>
                      <td className="table-cell-secondary">${lb.revenue.toLocaleString()}</td>
                    </tr>
                  )
                })}
                {leaderboard.length === 0 && (
                  <tr>
                    <td colSpan="6" className="text-center py-4 text-gray-500">No hay datos de vendedores.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
