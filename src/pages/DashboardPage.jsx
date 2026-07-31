import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Users, TrendingUp, Target, Award } from 'lucide-react'

const STATUS_COLORS = {
  nuevo: '#3B82F6',
  contactado: '#F59E0B',
  en_negociacion: '#8B5CF6',
  venta_cerrada: '#10B981',
  perdido: '#6B7280',
}

const STATUS_LABELS = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  en_negociacion: 'En Negociación',
  venta_cerrada: 'Venta Cerrada',
  perdido: 'Perdido',
}

export default function DashboardPage() {
  const { profile, isAdmin } = useAuth()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    try {
      let query = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(full_name)')
      if (!isAdmin) {
        query = query.eq('vendedor_asignado', profile.id)
      }
      const { data, error } = await query
      if (error) throw error
      setLeads(data || [])
    } catch (err) {
      console.error('Error fetching leads:', err)
    } finally {
      setLoading(false)
    }
  }

  const totalLeads = leads.length
  const ventasCerradas = leads.filter(l => l.estado === 'venta_cerrada').length
  const enNegociacion = leads.filter(l => l.estado === 'en_negociacion').length
  const tasaConversion = totalLeads > 0 ? ((ventasCerradas / totalLeads) * 100).toFixed(1) : '0'

  const statusData = Object.entries(
    leads.reduce((acc, lead) => {
      acc[lead.estado] = (acc[lead.estado] || 0) + 1
      return acc
    }, {})
  ).map(([estado, count]) => ({
    name: STATUS_LABELS[estado] || estado,
    value: count,
    color: STATUS_COLORS[estado] || '#888',
  }))

  const vendedorData = Object.entries(
    leads.reduce((acc, lead) => {
      const name = lead.vendedor?.full_name || 'Sin asignar'
      acc[name] = (acc[name] || 0) + 1
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value }))

  if (loading) {
    return (
      <div className="spinner-overlay">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon red">
            <Users size={22} />
          </div>
          <div className="stat-card-value">{totalLeads}</div>
          <div className="stat-card-label">Total de Leads</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon green">
            <Award size={22} />
          </div>
          <div className="stat-card-value">{ventasCerradas}</div>
          <div className="stat-card-label">Ventas Cerradas</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon purple">
            <Target size={22} />
          </div>
          <div className="stat-card-value">{enNegociacion}</div>
          <div className="stat-card-label">En Negociación</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon blue">
            <TrendingUp size={22} />
          </div>
          <div className="stat-card-value">{tasaConversion}%</div>
          <div className="stat-card-label">Tasa de Conversión</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="card">
          <div className="card-header">
            <h3>Leads por Estado</h3>
          </div>
          <div className="card-body">
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">
                <p>No hay datos para mostrar</p>
              </div>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="card">
            <div className="card-header">
              <h3>Leads por Vendedor</h3>
            </div>
            <div className="card-body">
              {vendedorData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={vendedorData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#E31837" radius={[6, 6, 0, 0]} name="Leads" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <p>No hay datos para mostrar</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
