import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, LayoutGrid, List, Download, Phone, MessageCircle, Trash2, Edit, CheckSquare } from 'lucide-react'

const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', en_negociacion: 'En Negociación', venta_cerrada: 'Venta Cerrada', perdido: 'Perdido' }
const ORIGEN_LABELS = { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram', presencial: 'Presencial', referido: 'Referido', otro: 'Otro' }
const STATUS_ORDER = ['nuevo', 'contactado', 'en_negociacion', 'venta_cerrada', 'perdido']
const EMPTY_LEAD = { nombre: '', telefono: '', email: '', modelo_interes: '', origen: 'presencial', estado: 'nuevo', vendedor_asignado: '', presupuesto_estimado: '', fecha_agenda: '', notas: '' }

function getWaLink(ph) { if (!ph) return null; const c = ph.replace(/\D/g, ''); return 'https://wa.me/' + (c.startsWith('54') ? c : '54' + c) }
function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '-' }

export default function LeadsPage() {
  const navigate = useNavigate()
  const { profile, isAdmin, user } = useAuth()
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
  // Bulk selection (admin only)
  const [selected, setSelected] = useState([])
  const [bulkAction, setBulkAction] = useState('')

  useEffect(() => {
    fetchLeads()
    if (isAdmin) supabase.from('profiles').select('id, full_name').order('full_name').then(({ data }) => setVendedores(data || []))
    const h = () => openModal()
    window.addEventListener('open-new-lead', h)
    return () => window.removeEventListener('open-new-lead', h)
  }, [])

  async function fetchLeads() {
    try {
      let q = supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(id, full_name)').order('created_at', { ascending: false })
      if (!isAdmin) q = q.eq('vendedor_asignado', profile.id)
      const { data, error } = await q
      if (error) throw error
      setLeads(data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const filtered = useMemo(() => leads.filter(l => {
    if (search && !l.nombre?.toLowerCase().includes(search.toLowerCase()) && !l.telefono?.includes(search) && !l.modelo_interes?.toLowerCase().includes(search.toLowerCase())) return false
    if (filterEstado && l.estado !== filterEstado) return false
    if (filterOrigen && l.origen !== filterOrigen) return false
    if (filterVendedor && l.vendedor_asignado !== filterVendedor) return false
    return true
  }), [leads, search, filterEstado, filterOrigen, filterVendedor])

  function openModal(lead) {
    if (lead) {
      // Empleados no pueden editar si no es su lead
      if (!isAdmin && lead.vendedor_asignado !== profile.id) {
        addToast('No tenés permiso para editar este lead', 'error')
        return
      }
      setEditingLead(lead)
      setFormData({
        nombre: lead.nombre || '', telefono: lead.telefono || '', email: lead.email || '',
        modelo_interes: lead.modelo_interes || '', origen: lead.origen || 'presencial',
        estado: lead.estado || 'nuevo', vendedor_asignado: lead.vendedor_asignado || '',
        presupuesto_estimado: lead.presupuesto_estimado || '',
        fecha_agenda: lead.fecha_agenda ? lead.fecha_agenda.slice(0, 16) : '', notas: lead.notas || ''
      })
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

      // Empleado no puede modificar teléfono si está editando
      if (!isAdmin && editingLead && editingLead.telefono) {
        payload.telefono = editingLead.telefono
      }

      if (editingLead) {
        // Historial de cambios
        const changes = []
        const labels = { nombre: 'Nombre', telefono: 'Teléfono', email: 'Email', modelo_interes: 'Modelo', origen: 'Origen', estado: 'Estado', presupuesto_estimado: 'Presupuesto', fecha_agenda: 'Cita', notas: 'Notas' }
        for (const k of Object.keys(labels)) {
          if (String(editingLead[k] || '') !== String(payload[k] || ''))
            changes.push({ lead_id: editingLead.id, usuario_id: user.id, campo: labels[k], valor_anterior: String(editingLead[k] || '') || null, valor_nuevo: String(payload[k] || '') || null })
        }

        const { error } = await supabase.from('leads').update(payload).eq('id', editingLead.id)
        if (error) throw error
        if (changes.length > 0) await supabase.from('historial_cambios').insert(changes)
        addToast('Lead actualizado', 'success')
      } else {
        const { error } = await supabase.from('leads').insert([payload])
        if (error) throw error
        addToast('Lead creado', 'success')
      }
      setIsModalOpen(false)
      setSelected([])
      fetchLeads()
    } catch (e) { addToast('Error al guardar', 'error'); console.error(e) }
    finally { setSaving(false) }
  }

  // Admin: Eliminar lead
  async function handleDelete(leadId) {
    if (!isAdmin) return
    if (!window.confirm('¿Estás seguro de eliminar este lead? Esta acción no se puede deshacer.')) return
    try {
      const { error } = await supabase.from('leads').delete().eq('id', leadId)
      if (error) throw error
      addToast('Lead eliminado', 'success')
      fetchLeads()
    } catch (e) { addToast('Error al eliminar', 'error') }
  }

  // Admin: Bulk actions
  async function handleBulkAction() {
    if (!isAdmin || selected.length === 0 || !bulkAction) return
    try {
      if (bulkAction === 'delete') {
        if (!window.confirm(`¿Eliminar ${selected.length} leads?`)) return
        const { error } = await supabase.from('leads').delete().in('id', selected)
        if (error) throw error
        addToast(`${selected.length} leads eliminados`, 'success')
      } else if (bulkAction.startsWith('estado:')) {
        const newEstado = bulkAction.replace('estado:', '')
        const { error } = await supabase.from('leads').update({ estado: newEstado }).in('id', selected)
        if (error) throw error
        addToast(`${selected.length} leads actualizados a ${STATUS_LABELS[newEstado]}`, 'success')
      } else if (bulkAction.startsWith('asignar:')) {
        const vendedorId = bulkAction.replace('asignar:', '')
        const { error } = await supabase.from('leads').update({ vendedor_asignado: vendedorId || null }).in('id', selected)
        if (error) throw error
        const vName = vendedores.find(v => v.id === vendedorId)?.full_name || 'Sin asignar'
        addToast(`${selected.length} leads asignados a ${vName}`, 'success')
      }
      setSelected([])
      setBulkAction('')
      fetchLeads()
    } catch (e) { addToast('Error en acción masiva', 'error') }
  }

  function toggleSelect(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  function toggleSelectAll() {
    if (selected.length === filtered.length) setSelected([])
    else setSelected(filtered.map(l => l.id))
  }

  function exportCSV() {
    const rows = [['Nombre', 'Teléfono', 'Email', 'Modelo', 'Origen', 'Estado', 'Presupuesto', 'Vendedor', 'Cita', 'Creado']]
    filtered.forEach(l => rows.push([l.nombre, l.telefono || '', l.email || '', l.modelo_interes || '', ORIGEN_LABELS[l.origen] || l.origen, STATUS_LABELS[l.estado], l.presupuesto_estimado || '', l.vendedor?.full_name || '', l.fecha_agenda || '', new Date(l.created_at).toLocaleDateString('es-AR')]))
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    addToast('CSV exportado', 'success')
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* Filters */}
      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar nombre, teléfono o modelo..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="filter-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="filter-select" value={filterOrigen} onChange={e => setFilterOrigen(e.target.value)}>
          <option value="">Todo origen</option>
          {Object.entries(ORIGEN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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

      {/* Bulk Actions Bar (admin only) */}
      {isAdmin && selected.length > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{selected.length} seleccionados</span>
          <select className="filter-select" value={bulkAction} onChange={e => setBulkAction(e.target.value)}>
            <option value="">Acción masiva...</option>
            <optgroup label="Cambiar Estado">
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={`estado:${k}`}>{v}</option>)}
            </optgroup>
            <optgroup label="Asignar a Vendedor">
              {vendedores.map(v => <option key={v.id} value={`asignar:${v.id}`}>{v.full_name}</option>)}
              <option value="asignar:">Sin asignar</option>
            </optgroup>
            <optgroup label="Peligro">
              <option value="delete">🗑️ Eliminar seleccionados</option>
            </optgroup>
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleBulkAction} disabled={!bulkAction}>Aplicar</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>Cancelar</button>
        </div>
      )}

      {/* TABLE VIEW */}
      {viewMode === 'table' && (
        <div className="card">
          <div className="card-body-flush">
            <table className="data-table">
              <thead>
                <tr>
                  {isAdmin && <th style={{ width: 36 }}><input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleSelectAll} /></th>}
                  <th>Nombre</th><th>Teléfono</th><th>Modelo</th><th>Origen</th><th>Estado</th><th>Presupuesto</th>
                  {isAdmin && <th>Vendedor</th>}<th>Cita</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 11 : 8}><div className="empty-state"><p>No se encontraron leads</p></div></td></tr>
                ) : filtered.map(l => (
                  <tr key={l.id} className={`clickable ${selected.includes(l.id) ? 'selected' : ''}`}>
                    {isAdmin && <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.includes(l.id)} onChange={() => toggleSelect(l.id)} /></td>}
                    <td className="table-cell-primary" onClick={() => navigate(`/leads/${l.id}`)}>{l.nombre}</td>
                    <td onClick={() => navigate(`/leads/${l.id}`)}>{l.telefono || '-'}</td>
                    <td onClick={() => navigate(`/leads/${l.id}`)}>{l.modelo_interes || '-'}</td>
                    <td onClick={() => navigate(`/leads/${l.id}`)}>{ORIGEN_LABELS[l.origen] || l.origen}</td>
                    <td onClick={() => navigate(`/leads/${l.id}`)}><span className={`badge badge-${l.estado}`}>{STATUS_LABELS[l.estado]}</span></td>
                    <td onClick={() => navigate(`/leads/${l.id}`)}>{fmt$(l.presupuesto_estimado)}</td>
                    {isAdmin && <td className="table-cell-secondary" onClick={() => navigate(`/leads/${l.id}`)}>{l.vendedor?.full_name || '-'}</td>}
                    <td className="table-cell-secondary" onClick={() => navigate(`/leads/${l.id}`)}>{l.fecha_agenda ? new Date(l.fecha_agenda).toLocaleDateString('es-AR') : '-'}</td>
                    <td>
                      <div className="table-actions" onClick={e => e.stopPropagation()}>
                        {l.telefono && getWaLink(l.telefono) && <a href={getWaLink(l.telefono)} target="_blank" rel="noopener" className="btn-icon whatsapp" title="WhatsApp"><MessageCircle size={16} /></a>}
                        {l.telefono && <a href={`tel:${l.telefono}`} className="btn-icon phone" title="Llamar"><Phone size={16} /></a>}
                        <button className="btn-icon" title="Editar" onClick={() => openModal(l)}><Edit size={16} /></button>
                        {isAdmin && <button className="btn-icon danger" title="Eliminar" onClick={() => handleDelete(l.id)}><Trash2 size={16} /></button>}
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
          {STATUS_ORDER.map(status => {
            const items = filtered.filter(l => l.estado === status)
            return (
              <div key={status} className="kanban-column" data-status={status}>
                <div className="kanban-column-header">
                  <span className="kanban-column-title">{STATUS_LABELS[status]}</span>
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
                        <span className="kanban-card-budget">{fmt$(l.presupuesto_estimado)}</span>
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
                    <label className="form-label">Teléfono {!isAdmin && editingLead && editingLead.telefono ? '🔒' : ''}</label>
                    <input
                      className="form-input"
                      value={formData.telefono}
                      onChange={e => setFormData({ ...formData, telefono: e.target.value })}
                      disabled={!isAdmin && editingLead && !!editingLead.telefono}
                    />
                    {!isAdmin && editingLead && editingLead.telefono && <div className="form-hint">Solo el admin puede modificar el teléfono</div>}
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
                      {Object.entries(ORIGEN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Estado</label>
                    <select className="form-input" value={formData.estado} onChange={e => setFormData({ ...formData, estado: e.target.value })}>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
