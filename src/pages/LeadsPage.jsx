import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, LayoutGrid, List, Download, Phone, MessageCircle } from 'lucide-react'
import { LEAD_STATUS_LABELS, LEAD_ORIGEN_LABELS, PIPELINE_ORDER, formatCurrency, getWhatsAppLink, exportToCSV, getErrorMessage } from '../lib/utils'

const EMPTY_LEAD = { nombre: '', telefono: '', email: '', modelo_interes: '', origen: 'presencial', estado: 'nuevo', vendedor_asignado: '', presupuesto_estimado: '', fecha_agenda: '', notas: '' }

export default function LeadsPage() {
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const { addToast } = useToast()
  const [leads, setLeads] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('table')
  const [search, setSearch] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [filterOrigen, setFilterOrigen] = useState('')
  const [filterVendedor, setFilterVendedor] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingLead, setEditingLead] = useState(null)
  const [formData, setFormData] = useState(EMPTY_LEAD)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchLeads()
    if (isAdmin) {
      supabase.from('profiles').select('id, full_name').order('full_name')
        .then(({ data, error }) => {
          if (error) {
            console.error('Error fetching vendors:', error)
            return
          }
          setVendedores(data || [])
        })
    }
    const h = () => openModal()
    window.addEventListener('open-new-lead', h)
    return () => window.removeEventListener('open-new-lead', h)
  }, [isAdmin, profile.id])

  async function fetchLeads() {
    try {
      let q = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(id, full_name)').order('created_at', { ascending: false })
      if (!isAdmin) q = q.eq('vendedor_asignado', profile.id)
      const { data, error } = await q
      if (error) throw error
      setLeads(data || [])
    } catch (e) {
      console.error('Error fetching leads:', e)
      addToast('Error al cargar leads', 'error')
    }
    finally { setLoading(false) }
  }

  const filtered = useMemo(() => leads.filter(l => {
    if (search && !l.nombre?.toLowerCase().includes(search.toLowerCase()) && !l.telefono?.includes(search)) return false
    if (filterEstado && l.estado !== filterEstado) return false
    if (filterOrigen && l.origen !== filterOrigen) return false
    if (filterVendedor && l.vendedor_asignado !== filterVendedor) return false
    return true
  }), [leads, search, filterEstado, filterOrigen, filterVendedor])

  function openModal(lead) {
    if (lead) {
      setEditingLead(lead)
      setFormData({ nombre: lead.nombre || '', telefono: lead.telefono || '', email: lead.email || '', modelo_interes: lead.modelo_interes || '', origen: lead.origen || 'presencial', estado: lead.estado || 'nuevo', vendedor_asignado: lead.vendedor_asignado || '', presupuesto_estimado: lead.presupuesto_estimado || '', fecha_agenda: lead.fecha_agenda ? lead.fecha_agenda.slice(0, 16) : '', notas: lead.notas || '' })
    } else {
      setEditingLead(null)
      setFormData({ ...EMPTY_LEAD, vendedor_asignado: isAdmin ? '' : profile?.id || '' })
    }
    setIsModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...formData, vendedor_asignado: formData.vendedor_asignado || null, presupuesto_estimado: formData.presupuesto_estimado ? Number(formData.presupuesto_estimado) : null, fecha_agenda: formData.fecha_agenda || null }
      if (editingLead) {
        const { error } = await supabase.from('leads').update(payload).eq('id', editingLead.id)
        if (error) throw error
        addToast('Lead actualizado', 'success')
      } else {
        const { error } = await supabase.from('leads').insert([payload])
        if (error) throw error
        addToast('Lead creado', 'success')
      }
      setIsModalOpen(false)
      fetchLeads()
    } catch (e) { addToast('Error al guardar', 'error'); console.error(e) }
    finally { setSaving(false) }
  }

  function exportCSV() {
    try {
      const data = filtered.map(l => ({
        Nombre: l.nombre,
        Teléfono: l.telefono || '',
        Email: l.email || '',
        Modelo: l.modelo_interes || '',
        Origen: LEAD_ORIGEN_LABELS[l.origen] || l.origen,
        Estado: LEAD_STATUS_LABELS[l.estado],
        Presupuesto: l.presupuesto_estimado || '',
        Vendedor: l.vendedor?.full_name || '',
        Cita: l.fecha_agenda ? new Date(l.fecha_agenda).toLocaleDateString('es-AR') : '',
        Creado: new Date(l.created_at).toLocaleDateString('es-AR')
      }))
      exportToCSV(data, `leads_${new Date().toISOString().slice(0, 10)}.csv`)
      addToast('CSV exportado', 'success')
    } catch (e) {
      console.error('Error exporting CSV:', e)
      addToast('Error al exportar CSV', 'error')
    }
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* Filters */}
      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar por nombre o teléfono..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="filter-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(LEAD_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="filter-select" value={filterOrigen} onChange={e => setFilterOrigen(e.target.value)}>
          <option value="">Todo origen</option>
          {Object.entries(LEAD_ORIGEN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isAdmin && (
          <select className="filter-select" value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)}>
            <option value="">Todos los vendedores</option>
            {vendedores.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
          </select>
        )}
        <div className="view-toggle">
          <button className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}><List size={14} /> Tabla</button>
          <button className={`view-toggle-btn ${viewMode === 'kanban' ? 'active' : ''}`} onClick={() => setViewMode('kanban')}><LayoutGrid size={14} /> Kanban</button>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={exportCSV}><Download size={14} /> CSV</button>
        <span className="results-count">{filtered.length} leads</span>
      </div>

      {/* TABLE VIEW */}
      {viewMode === 'table' && (
        <div className="card">
          <div className="card-body-flush">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th><th>Teléfono</th><th>Modelo</th><th>Origen</th><th>Estado</th><th>Presupuesto</th>
                  {isAdmin && <th>Vendedor</th>}<th>Cita</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 9 : 8}><div className="empty-state"><p>No se encontraron leads</p></div></td></tr>
                ) : filtered.map(l => (
                  <tr key={l.id} className="clickable" onClick={() => navigate(`/leads/${l.id}`)}>
                    <td className="table-cell-primary">{l.nombre}</td>
                    <td>{l.telefono || '-'}</td>
                    <td>{l.modelo_interes || '-'}</td>
                    <td>{LEAD_ORIGEN_LABELS[l.origen] || l.origen}</td>
                    <td><span className={`badge badge-${l.estado}`}>{LEAD_STATUS_LABELS[l.estado]}</span></td>
                    <td>{formatCurrency(l.presupuesto_estimado)}</td>
                    {isAdmin && <td className="table-cell-secondary">{l.vendedor?.full_name || '-'}</td>}
                    <td className="table-cell-secondary">{l.fecha_agenda ? new Date(l.fecha_agenda).toLocaleDateString('es-AR') : '-'}</td>
                    <td>
                      <div className="table-actions" onClick={e => e.stopPropagation()}>
                        {l.telefono && getWhatsAppLink(l.telefono) && <a href={getWhatsAppLink(l.telefono)} target="_blank" rel="noopener noreferrer" className="btn-icon whatsapp"><MessageCircle size={16} /></a>}
                        {l.telefono && <a href={`tel:${l.telefono}`} className="btn-icon phone"><Phone size={16} /></a>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* KANBAN VIEW */}
      {viewMode === 'kanban' && (
        <div className="kanban-board">
          {PIPELINE_ORDER.map(status => {
            const items = filtered.filter(l => l.estado === status)
            return (
              <div key={status} className="kanban-column" data-status={status}>
                <div className="kanban-column-header">
                  <span className="kanban-column-title">{LEAD_STATUS_LABELS[status]}</span>
                  <span className="kanban-column-count">{items.length}</span>
                </div>
                <div className="kanban-cards">
                  {items.map(l => (
                    <div key={l.id} className="kanban-card" onClick={() => navigate(`/leads/${l.id}`)}>
                      <div className="kanban-card-name">{l.nombre}</div>
                      {l.modelo_interes && <div className="kanban-card-model">{l.modelo_interes}</div>}
                      {l.telefono && <div className="kanban-card-meta"><Phone size={11} /> {l.telefono}</div>}
                      {l.fecha_agenda && <div className="kanban-card-meta">📅 {new Date(l.fecha_agenda).toLocaleDateString('es-AR')}</div>}
                      <div className="kanban-card-footer">
                        <span className="kanban-card-budget">{formatCurrency(l.presupuesto_estimado)}</span>
                        {isAdmin && <span className="kanban-card-vendor">{l.vendedor?.full_name || ''}</span>}
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <div className="empty-state"><p>Vacío</p></div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingLead ? 'Editar Lead' : 'Nuevo Lead'}</h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Nombre *</label>
                    <input className="form-input" value={formData.nombre} onChange={e => setFormData({ ...formData, nombre: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Teléfono</label>
                    <input className="form-input" value={formData.telefono} onChange={e => setFormData({ ...formData, telefono: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Modelo de Interés</label>
                    <input className="form-input" value={formData.modelo_interes} onChange={e => setFormData({ ...formData, modelo_interes: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Origen</label>
                    <select className="form-input" value={formData.origen} onChange={e => setFormData({ ...formData, origen: e.target.value })}>
                      {Object.entries(LEAD_ORIGEN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Estado</label>
                    <select className="form-input" value={formData.estado} onChange={e => setFormData({ ...formData, estado: e.target.value })}>
                      {Object.entries(LEAD_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Presupuesto</label>
                    <input className="form-input" type="number" value={formData.presupuesto_estimado} onChange={e => setFormData({ ...formData, presupuesto_estimado: e.target.value })} />
                  </div>
                  {isAdmin && (
                    <div className="form-group">
                      <label className="form-label">Vendedor</label>
                      <select className="form-input" value={formData.vendedor_asignado} onChange={e => setFormData({ ...formData, vendedor_asignado: e.target.value })}>
                        <option value="">Sin asignar</option>
                        {vendedores.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha y Hora de Cita</label>
                  <input className="form-input" type="datetime-local" value={formData.fecha_agenda} onChange={e => setFormData({ ...formData, fecha_agenda: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Notas</label>
                  <textarea className="form-input" rows="3" value={formData.notas} onChange={e => setFormData({ ...formData, notas: e.target.value })}></textarea>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar Lead'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
