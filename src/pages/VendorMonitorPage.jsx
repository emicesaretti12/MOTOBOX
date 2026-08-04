import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Users, Phone, MessageCircle, Mail, MapPin, TrendingUp, Activity } from 'lucide-react'

const TIPO_ICONS = { llamada: Phone, whatsapp: MessageCircle, email: Mail, visita: MapPin, otro: Activity }

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000)
  if (s < 60) return 'Ahora'
  if (s < 3600) return `Hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} hs`
  return `Hace ${Math.floor(s / 86400)} días`
}

function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '$0' }

export default function VendorMonitorPage() {
  const { isAdmin } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [leads, setLeads] = useState([])
  const [interacciones, setInteracciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('mes')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    try {
      const [pr, lr, ir] = await Promise.all([
        supabase.from('profiles').select('*').eq('role', 'empleado'),
        supabase.from('leads').select('*'),
        supabase.from('interacciones').select('*, lead:leads!lead_id(nombre), usuario:profiles!usuario_id(full_name)').order('fecha', { ascending: false })
      ])
      setProfiles(pr.data || [])
      setLeads(lr.data || [])
      setInteracciones(ir.data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const periodStart = useMemo(() => {
    const now = new Date()
    if (period === 'hoy') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (period === 'semana') { const d = new Date(now); d.setDate(d.getDate() - d.getDay() + 1); d.setHours(0, 0, 0, 0); return d }
    if (period === 'mes') return new Date(now.getFullYear(), now.getMonth(), 1)
    return new Date(0)
  }, [period])

  const filteredInt = useMemo(() => interacciones.filter(i => new Date(i.fecha) >= periodStart), [interacciones, periodStart])
  const filteredLeads = useMemo(() => period === 'todo' ? leads : leads.filter(l => l.estado === 'venta_cerrada' && new Date(l.updated_at) >= periodStart), [leads, periodStart, period])

  const globalStats = useMemo(() => ({
    totalInt: filteredInt.length,
    llamadas: filteredInt.filter(i => i.tipo === 'llamada').length,
    whatsapp: filteredInt.filter(i => i.tipo === 'whatsapp').length,
    conversiones: filteredLeads.filter(l => l.estado === 'venta_cerrada').length
  }), [filteredInt, filteredLeads])

  const vendorData = useMemo(() => profiles.map(p => {
    const vLeads = leads.filter(l => l.vendedor_asignado === p.id)
    const vInt = filteredInt.filter(i => i.usuario_id === p.id)
    const ventas = vLeads.filter(l => l.estado === 'venta_cerrada').length
    const revenue = vLeads.filter(l => l.estado === 'venta_cerrada').reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0)
    return {
      id: p.id, name: p.full_name, initials: p.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?',
      leads: vLeads.length, ventas, revenue,
      conversion: vLeads.length > 0 ? ((ventas / vLeads.length) * 100).toFixed(0) : '0',
      totalInt: vInt.length,
      llamadas: vInt.filter(i => i.tipo === 'llamada').length,
      whatsapp: vInt.filter(i => i.tipo === 'whatsapp').length,
      emails: vInt.filter(i => i.tipo === 'email').length,
      visitas: vInt.filter(i => i.tipo === 'visita').length
    }
  }).sort((a, b) => b.ventas - a.ventas), [profiles, leads, filteredInt])

  const chartData = vendorData.map(v => ({ name: v.name?.split(' ')[0] || '?', Llamadas: v.llamadas, WhatsApp: v.whatsapp, Emails: v.emails, Visitas: v.visitas }))

  if (!isAdmin) return <div className="empty-state"><p>Acceso restringido a administradores</p></div>
  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* Period Filter */}
      <div className="filters-bar">
        <select className="filter-select" value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="hoy">Hoy</option>
          <option value="semana">Esta Semana</option>
          <option value="mes">Este Mes</option>
          <option value="todo">Todo</option>
        </select>
      </div>

      {/* Global Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><Activity size={20} /></div></div>
          <div className="stat-card-value">{globalStats.totalInt}</div>
          <div className="stat-card-label">Total Interacciones</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><Phone size={20} /></div></div>
          <div className="stat-card-value">{globalStats.llamadas}</div>
          <div className="stat-card-label">Llamadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon purple"><MessageCircle size={20} /></div></div>
          <div className="stat-card-value">{globalStats.whatsapp}</div>
          <div className="stat-card-label">WhatsApp</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><TrendingUp size={20} /></div></div>
          <div className="stat-card-value">{globalStats.conversiones}</div>
          <div className="stat-card-label">Ventas Cerradas</div>
        </div>
      </div>

      {/* Vendor Cards */}
      <div className="vendor-grid">
        {vendorData.map(v => (
          <div key={v.id} className="vendor-card">
            <div className="vendor-card-head">
              <div className="vendor-avatar">{v.initials}</div>
              <div><div className="vendor-name">{v.name}</div><div className="vendor-role">Vendedor</div></div>
            </div>
            <div className="vendor-stats">
              <div className="vendor-stat"><div className="vendor-stat-val">{v.leads}</div><div className="vendor-stat-lbl">Leads</div></div>
              <div className="vendor-stat"><div className="vendor-stat-val">{v.ventas}</div><div className="vendor-stat-lbl">Ventas</div></div>
              <div className="vendor-stat"><div className="vendor-stat-val">{v.conversion}%</div><div className="vendor-stat-lbl">Conversión</div></div>
              <div className="vendor-stat"><div className="vendor-stat-val">{v.totalInt}</div><div className="vendor-stat-lbl">Contactos</div></div>
            </div>
          </div>
        ))}
        {vendorData.length === 0 && <div className="empty-state"><p>No hay vendedores registrados</p></div>}
      </div>

      {/* Activity Chart */}
      {chartData.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><h3>Actividad por Vendedor</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Llamadas" fill="#2563EB" radius={[4, 4, 0, 0]} />
                <Bar dataKey="WhatsApp" fill="#16A34A" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Emails" fill="#D97706" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Visitas" fill="#7C3AED" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Activity Feed + Detail Table */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Actividad Reciente</h3></div>
          <div className="card-body">
            {interacciones.slice(0, 12).map(a => {
              const Icon = TIPO_ICONS[a.tipo] || Activity
              return (
                <div key={a.id} className="feed-item">
                  <div className="feed-icon"><Icon size={14} /></div>
                  <div className="feed-body">
                    <div className="feed-text"><strong>{a.usuario?.full_name}</strong> → {a.tipo} con <span className="highlight">{a.lead?.nombre}</span></div>
                    <div className="feed-time">{timeAgo(a.fecha)}</div>
                  </div>
                </div>
              )
            })}
            {interacciones.length === 0 && <div className="empty-state"><p>Sin actividad</p></div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Detalle por Vendedor</h3></div>
          <div className="card-body-flush">
            <table className="data-table">
              <thead><tr><th>Vendedor</th><th>Leads</th><th>☎️</th><th>💬</th><th>📧</th><th>Ventas</th><th>Revenue</th></tr></thead>
              <tbody>
                {vendorData.map(v => (
                  <tr key={v.id}>
                    <td className="table-cell-primary">{v.name}</td>
                    <td>{v.leads}</td>
                    <td>{v.llamadas}</td>
                    <td>{v.whatsapp}</td>
                    <td>{v.emails}</td>
                    <td>{v.ventas}</td>
                    <td>{fmt$(v.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
