import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, Edit, Phone, MessageCircle, Briefcase } from 'lucide-react'

function getWaLink(ph) { if (!ph) return null; const c = ph.replace(/\D/g, ''); return 'https://wa.me/' + (c.startsWith('54') ? c : '54' + c) }

export default function ClientsPage() {
  const { isAdmin, profile } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { fetchClients() }, [])

  async function fetchClients() {
    try {
      // Clientes = leads con venta cerrada
      let q = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(full_name)').eq('estado', 'venta_cerrada').order('updated_at', { ascending: false })
      if (!isAdmin) q = q.eq('vendedor_asignado', profile.id)
      const { data, error } = await q
      if (error) throw error
      setLeads(data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const filtered = useMemo(() => leads.filter(l => {
    if (search && !l.nombre?.toLowerCase().includes(search.toLowerCase()) && !l.telefono?.includes(search) && !l.email?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [leads, search])

  const stats = useMemo(() => ({
    total: leads.length,
    revenue: leads.reduce((s, l) => s + (Number(l.presupuesto_estimado) || 0), 0),
    conEmail: leads.filter(l => l.email).length,
    conTelefono: leads.filter(l => l.telefono).length
  }), [leads])

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><Briefcase size={20} /></div></div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Total Clientes</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><Briefcase size={20} /></div></div>
          <div className="stat-card-value">${Number(stats.revenue).toLocaleString('es-AR')}</div>
          <div className="stat-card-label">Revenue Total</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon purple"><Phone size={20} /></div></div>
          <div className="stat-card-value">{stats.conTelefono}</div>
          <div className="stat-card-label">Con Teléfono</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><Briefcase size={20} /></div></div>
          <div className="stat-card-value">{stats.conEmail}</div>
          <div className="stat-card-label">Con Email</div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar cliente, teléfono o email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className="results-count">{filtered.length} clientes</span>
      </div>

      <div className="card">
        <div className="card-body-flush">
          <table className="data-table">
            <thead>
              <tr><th>Nombre</th><th>Teléfono</th><th>Email</th><th>Modelo Comprado</th><th>Monto</th>{isAdmin && <th>Vendedor</th>}<th>Acciones</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={isAdmin ? 7 : 6}><div className="empty-state"><p>No hay clientes aún — cerrá una venta para verlos aquí</p></div></td></tr>
              ) : filtered.map(l => (
                <tr key={l.id} className="clickable" onClick={() => navigate(`/leads/${l.id}`)}>
                  <td className="table-cell-primary">{l.nombre}</td>
                  <td>{l.telefono || '-'}</td>
                  <td>{l.email || '-'}</td>
                  <td>{l.modelo_interes || '-'}</td>
                  <td className="table-cell-primary">{l.presupuesto_estimado ? '$' + Number(l.presupuesto_estimado).toLocaleString('es-AR') : '-'}</td>
                  {isAdmin && <td className="table-cell-secondary">{l.vendedor?.full_name || '-'}</td>}
                  <td>
                    <div className="table-actions" onClick={e => e.stopPropagation()}>
                      {l.telefono && getWaLink(l.telefono) && <a href={getWaLink(l.telefono)} target="_blank" rel="noopener" className="btn-icon whatsapp" title="WhatsApp"><MessageCircle size={16} /></a>}
                      {l.telefono && <a href={`tel:${l.telefono}`} className="btn-icon phone" title="Llamar"><Phone size={16} /></a>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
