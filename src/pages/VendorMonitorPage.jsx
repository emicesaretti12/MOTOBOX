import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Users, Phone, MessageCircle, Mail, MapPin, TrendingUp, Award, Clock, Activity } from 'lucide-react'

export default function VendorMonitorPage() {
  const { profile, isAdmin } = useAuth()
  
  const [period, setPeriod] = useState('Este Mes')
  const [loading, setLoading] = useState(true)
  const [empleados, setEmpleados] = useState([])
  const [leads, setLeads] = useState([])
  const [interacciones, setInteracciones] = useState([])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [profilesRes, leadsRes, intRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('role', 'empleado'),
        supabase.from('leads').select('*'),
        supabase.from('interacciones')
          .select('*, lead:leads!lead_id(nombre), usuario:profiles!usuario_id(full_name)')
          .order('fecha', { ascending: false })
      ])

      if (profilesRes.error) throw profilesRes.error
      if (leadsRes.error) throw leadsRes.error
      if (intRes.error) throw intRes.error

      setEmpleados(profilesRes.data || [])
      setLeads(leadsRes.data || [])
      setInteracciones(intRes.data || [])
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getFilteredData = () => {
    const now = new Date()
    let startDate = new Date(0)
    
    if (period === 'Hoy') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    } else if (period === 'Esta Semana') {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is sunday
      startDate = new Date(now.getFullYear(), now.getMonth(), diff)
    } else if (period === 'Este Mes') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }

    const filteredInteracciones = interacciones.filter(int => new Date(int.fecha) >= startDate)
    const filteredLeads = leads.filter(l => new Date(l.created_at) >= startDate)
    
    // Convertidos in period (using updated_at)
    const convertidos = leads.filter(l => l.estado === 'venta_cerrada' && new Date(l.updated_at) >= startDate)

    return { filteredInteracciones, filteredLeads, convertidos }
  }

  const { filteredInteracciones, filteredLeads, convertidos } = getFilteredData()

  const llamadasRealizadas = filteredInteracciones.filter(int => int.tipo === 'llamada').length
  const whatsappEnviados = filteredInteracciones.filter(int => int.tipo === 'whatsapp').length
  const leadsConvertidos = convertidos.length

  const getIcon = (tipo) => {
    switch (tipo) {
      case 'llamada': return <Phone size={16} />
      case 'whatsapp': return <MessageCircle size={16} />
      case 'email': return <Mail size={16} />
      case 'visita': return <MapPin size={16} />
      default: return <Activity size={16} />
    }
  }

  const timeAgo = (dateStr) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const seconds = Math.floor((new Date() - date) / 1000)
    
    let interval = seconds / 31536000
    if (interval > 1) return `Hace ${Math.floor(interval)} años`
    interval = seconds / 2592000
    if (interval > 1) return `Hace ${Math.floor(interval)} meses`
    interval = seconds / 86400
    if (interval > 1) return `Hace ${Math.floor(interval)} días`
    interval = seconds / 3600
    if (interval > 1) return `Hace ${Math.floor(interval)} horas`
    interval = seconds / 60
    if (interval > 1) return `Hace ${Math.floor(interval)} minutos`
    return 'Hace unos segundos'
  }

  const vendorStats = empleados.map(emp => {
    const empLeads = filteredLeads.filter(l => l.vendedor_asignado === emp.id)
    const empVentas = convertidos.filter(l => l.vendedor_asignado === emp.id)
    const empInts = filteredInteracciones.filter(i => i.usuario_id === emp.id)
    const conversion = empLeads.length > 0 ? ((empVentas.length / empLeads.length) * 100).toFixed(1) : 0
    
    const llamadas = empInts.filter(i => i.tipo === 'llamada').length
    const whatsapp = empInts.filter(i => i.tipo === 'whatsapp').length
    const emails = empInts.filter(i => i.tipo === 'email').length
    const visitas = empInts.filter(i => i.tipo === 'visita').length
    
    const revenue = empVentas.reduce((sum, l) => sum + (Number(l.presupuesto_estimado) || 0), 0)

    return {
      id: emp.id,
      name: emp.full_name || 'Sin nombre',
      role: emp.role,
      initials: (emp.full_name || 'S N').substring(0, 2).toUpperCase(),
      totalLeads: empLeads.length,
      ventas: empVentas.length,
      conversion,
      totalInteracciones: empInts.length,
      llamadas,
      whatsapp,
      emails,
      visitas,
      revenue
    }
  }).sort((a, b) => b.ventas - a.ventas)

  const recentActivity = interacciones.slice(0, 15)

  if (!isAdmin) {
    return (
      <div className="empty-state">
        <Users className="feed-icon" />
        <h2>Acceso Denegado</h2>
        <p>Esta página es exclusiva para administradores.</p>
      </div>
    )
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
      <div className="filters-bar">
        <h2>Monitor de Vendedores</h2>
        <div>
          <select 
            className="filter-select"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option>Hoy</option>
            <option>Esta Semana</option>
            <option>Este Mes</option>
            <option>Todo</option>
          </select>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Total Interacciones</span>
            <Activity className="stat-card-icon blue" />
          </div>
          <div className="stat-card-value">{filteredInteracciones.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Llamadas Realizadas</span>
            <Phone className="stat-card-icon green" />
          </div>
          <div className="stat-card-value">{llamadasRealizadas}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">WhatsApp Enviados</span>
            <MessageCircle className="stat-card-icon yellow" />
          </div>
          <div className="stat-card-value">{whatsappEnviados}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Leads Convertidos</span>
            <Award className="stat-card-icon purple" />
          </div>
          <div className="stat-card-value">{leadsConvertidos}</div>
        </div>
      </div>

      <div className="vendor-grid">
        {vendorStats.map(vendor => (
          <div key={vendor.id} className="vendor-card">
            <div className="vendor-card-head">
              <div className="vendor-avatar">{vendor.initials}</div>
              <div>
                <div className="vendor-name">{vendor.name}</div>
                <div className="vendor-role">
                  <span className="badge badge-empleado">{vendor.role}</span>
                </div>
              </div>
            </div>
            <div className="vendor-stats">
              <div className="vendor-stat">
                <span className="vendor-stat-lbl">Total Leads</span>
                <span className="vendor-stat-val">{vendor.totalLeads}</span>
              </div>
              <div className="vendor-stat">
                <span className="vendor-stat-lbl">Ventas</span>
                <span className="vendor-stat-val">{vendor.ventas}</span>
              </div>
              <div className="vendor-stat">
                <span className="vendor-stat-lbl">Conversión</span>
                <span className="vendor-stat-val">{vendor.conversion}%</span>
              </div>
              <div className="vendor-stat">
                <span className="vendor-stat-lbl">Interacciones</span>
                <span className="vendor-stat-val">{vendor.totalInteracciones}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Actividad por Vendedor</h3>
        </div>
        <div className="card-body">
          <div className="chart-container" style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={vendorStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="llamadas" stackId="a" fill="#10b981" name="Llamadas" />
                <Bar dataKey="whatsapp" stackId="a" fill="#f59e0b" name="WhatsApp" />
                <Bar dataKey="emails" stackId="a" fill="#3b82f6" name="Emails" />
                <Bar dataKey="visitas" stackId="a" fill="#8b5cf6" name="Visitas" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Registro de Actividad Reciente</h3>
        </div>
        <div className="card-body card-body-flush">
          {recentActivity.length === 0 ? (
            <div className="empty-state">No hay actividad reciente</div>
          ) : (
            <div>
              {recentActivity.map(act => (
                <div key={act.id} className="feed-item">
                  <div className="feed-icon">
                    {getIcon(act.tipo)}
                  </div>
                  <div className="feed-body">
                    <div className="feed-text">
                      <strong>{act.usuario?.full_name || 'Usuario desconocido'}</strong> registró {act.tipo} con <span className="highlight">{act.lead?.nombre || 'Lead desconocido'}</span>
                    </div>
                    <div className="feed-time">
                      <Clock size={12} /> {timeAgo(act.fecha)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Rendimiento Detallado</h3>
        </div>
        <div className="card-body card-body-flush">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th>Leads Asignados</th>
                  <th>Llamadas</th>
                  <th>WhatsApp</th>
                  <th>Emails</th>
                  <th>Visitas</th>
                  <th>Ventas Cerradas</th>
                  <th>Conversión</th>
                  <th>Revenue (Est)</th>
                </tr>
              </thead>
              <tbody>
                {vendorStats.map(vendor => (
                  <tr key={vendor.id}>
                    <td className="table-cell-primary">{vendor.name}</td>
                    <td>{vendor.totalLeads}</td>
                    <td>{vendor.llamadas}</td>
                    <td>{vendor.whatsapp}</td>
                    <td>{vendor.emails}</td>
                    <td>{vendor.visitas}</td>
                    <td className="table-cell-secondary">{vendor.ventas}</td>
                    <td>{vendor.conversion}%</td>
                    <td>${vendor.revenue.toLocaleString()}</td>
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
