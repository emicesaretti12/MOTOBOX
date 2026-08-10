import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, Edit, Trash2, Package, Eye } from 'lucide-react'

const STATUS_LABELS = { disponible: 'Disponible', reservada: 'Reservada', vendida: 'Vendida' }
const STATUS_BADGE = { disponible: 'nuevo', reservada: 'en_negociacion', vendida: 'venta_cerrada' }

function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '-' }

export default function InventoryPage() {
  const { isAdmin } = useAuth()
  const { addToast } = useToast()
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [viewItem, setViewItem] = useState(null)
  const [formData, setFormData] = useState({ marca: '', modelo: '', anio: '', precio: '', estado: 'disponible', color: '', cilindrada: '', km: '', notas: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchInventory() }, [])

  async function fetchInventory() {
    try {
      const { data, error } = await supabase.from('inventario_motos').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setInventory(data || [])
    } catch (e) { console.error(e); setInventory([]) }
    finally { setLoading(false) }
  }

  const filtered = useMemo(() => inventory.filter(i => {
    if (search && !`${i.marca} ${i.modelo} ${i.color || ''}`.toLowerCase().includes(search.toLowerCase())) return false
    if (filterEstado && i.estado !== filterEstado) return false
    return true
  }), [inventory, search, filterEstado])

  const stats = useMemo(() => ({
    total: inventory.length,
    disponibles: inventory.filter(i => i.estado === 'disponible').length,
    reservadas: inventory.filter(i => i.estado === 'reservada').length,
    valorStock: inventory.filter(i => i.estado === 'disponible').reduce((s, i) => s + (Number(i.precio) || 0), 0)
  }), [inventory])

  function openModal(item) {
    if (item) {
      setEditingItem(item)
      setFormData({ marca: item.marca || '', modelo: item.modelo || '', anio: item.anio ? String(item.anio) : '', precio: item.precio ? String(item.precio) : '', estado: item.estado || 'disponible', color: item.color || '', cilindrada: item.cilindrada || '', km: item.km ? String(item.km) : '', notas: item.notas || '' })
    } else {
      setEditingItem(null)
      setFormData({ marca: '', modelo: '', anio: '', precio: '', estado: 'disponible', color: '', cilindrada: '', km: '', notas: '' })
    }
    setIsModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!formData.marca.trim() || !formData.modelo.trim()) {
      addToast('Marca y modelo son obligatorios', 'error')
      return
    }
    setSaving(true)
    try {
      // Build clean payload - only send non-empty values
      const payload = {
        marca: formData.marca.trim(),
        modelo: formData.modelo.trim(),
        estado: formData.estado || 'disponible',
      }
      // Optional fields - only include if they have values
      if (formData.anio) payload.anio = parseInt(formData.anio, 10)
      if (formData.precio) payload.precio = parseFloat(formData.precio)
      if (formData.color.trim()) payload.color = formData.color.trim()
      if (formData.cilindrada.trim()) payload.cilindrada = formData.cilindrada.trim()
      if (formData.km) payload.km = parseInt(formData.km, 10)
      if (formData.notas.trim()) payload.notas = formData.notas.trim()

      let error
      if (editingItem) {
        ({ error } = await supabase.from('inventario_motos').update(payload).eq('id', editingItem.id))
      } else {
        ({ error } = await supabase.from('inventario_motos').insert(payload))
      }
      if (error) throw error
      addToast(editingItem ? 'Moto actualizada' : 'Moto agregada', 'success')
      setIsModalOpen(false)
      fetchInventory()
    } catch (e) {
      console.error('Inventory save error:', e)
      addToast(`Error: ${e.message || 'No se pudo guardar'}`, 'error')
    }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!isAdmin) return
    if (!window.confirm('¿Eliminar esta moto del inventario?')) return
    try {
      const { error } = await supabase.from('inventario_motos').delete().eq('id', id)
      if (error) throw error
      addToast('Moto eliminada', 'success')
      fetchInventory()
    } catch (e) { addToast('Error al eliminar', 'error') }
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon blue"><Package size={20} /></div></div><div className="stat-card-value">{stats.total}</div><div className="stat-card-label">Total Motos</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon green"><Package size={20} /></div></div><div className="stat-card-value">{stats.disponibles}</div><div className="stat-card-label">Disponibles</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon purple"><Package size={20} /></div></div><div className="stat-card-value">{stats.reservadas}</div><div className="stat-card-label">Reservadas</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon red"><Package size={20} /></div></div><div className="stat-card-value">{fmt$(stats.valorStock)}</div><div className="stat-card-label">Valor en Stock</div></div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="search-input-wrap"><Search size={16} /><input placeholder="Buscar marca, modelo o color..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <select className="filter-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => openModal()}><Plus size={14} /> Nueva Moto</button>}
        <span className="results-count">{filtered.length} motos</span>
      </div>

      {/* Inventory Cards Grid */}
      <div className="inventory-grid">
        {filtered.length === 0 ? (
          <div className="card" style={{ gridColumn: '1/-1' }}><div className="card-body"><div className="empty-state"><p>{inventory.length === 0 ? 'No hay motos en el inventario. Agregá la primera.' : 'No se encontraron motos con esos filtros.'}</p></div></div></div>
        ) : filtered.map(item => (
          <div key={item.id} className="inventory-card">
            <div className="inventory-card-top">
              <div className="inventory-card-badge"><span className={`badge badge-${STATUS_BADGE[item.estado]}`}>{STATUS_LABELS[item.estado]}</span></div>
              <div className="inventory-card-icon"><Package size={32} /></div>
            </div>
            <div className="inventory-card-body">
              <div className="inventory-card-title">{item.marca} {item.modelo}</div>
              <div className="inventory-card-specs">
                {item.anio && <span className="inventory-spec">{item.anio}</span>}
                {item.color && <span className="inventory-spec">{item.color}</span>}
                {item.cilindrada && <span className="inventory-spec">{item.cilindrada}cc</span>}
                {item.km != null && item.km > 0 && <span className="inventory-spec">{Number(item.km).toLocaleString('es-AR')} km</span>}
              </div>
              <div className="inventory-card-price">{fmt$(item.precio)}</div>
            </div>
            <div className="inventory-card-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setViewItem(item)}><Eye size={14} /> Ver</button>
              {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => openModal(item)}><Edit size={14} /> Editar</button>}
              {isAdmin && <button className="btn btn-ghost btn-sm" style={{ color: '#DC2626' }} onClick={() => handleDelete(item.id)}><Trash2 size={14} /></button>}
            </div>
          </div>
        ))}
      </div>

      {/* View Detail Modal */}
      {viewItem && (
        <div className="modal-overlay" onClick={() => setViewItem(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{viewItem.marca} {viewItem.modelo}</h3><button className="modal-close" onClick={() => setViewItem(null)}><X size={18} /></button></div>
            <div className="modal-body">
              <div className="detail-row"><span className="detail-label">Marca</span><span className="detail-value">{viewItem.marca}</span></div>
              <div className="detail-row"><span className="detail-label">Modelo</span><span className="detail-value">{viewItem.modelo}</span></div>
              <div className="detail-row"><span className="detail-label">Año</span><span className="detail-value">{viewItem.anio || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Color</span><span className="detail-value">{viewItem.color || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Cilindrada</span><span className="detail-value">{viewItem.cilindrada ? `${viewItem.cilindrada}cc` : '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Kilómetros</span><span className="detail-value">{viewItem.km ? `${Number(viewItem.km).toLocaleString('es-AR')} km` : '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Precio</span><span className="detail-value" style={{ fontWeight: 700, color: '#DC2626' }}>{fmt$(viewItem.precio)}</span></div>
              <div className="detail-row"><span className="detail-label">Estado</span><span className="detail-value"><span className={`badge badge-${STATUS_BADGE[viewItem.estado]}`}>{STATUS_LABELS[viewItem.estado]}</span></span></div>
              {viewItem.notas && <div className="detail-row"><span className="detail-label">Notas</span><span className="detail-value">{viewItem.notas}</span></div>}
            </div>
            <div className="modal-footer">
              {isAdmin && <button className="btn btn-primary" onClick={() => { setViewItem(null); openModal(viewItem) }}>Editar</button>}
              <button className="btn btn-secondary" onClick={() => setViewItem(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editingItem ? 'Editar Moto' : 'Nueva Moto'}</h3><button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button></div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Marca *</label><input className="form-input" value={formData.marca} onChange={e => setFormData({ ...formData, marca: e.target.value })} required placeholder="Ej: Honda" /></div>
                  <div className="form-group"><label className="form-label">Modelo *</label><input className="form-input" value={formData.modelo} onChange={e => setFormData({ ...formData, modelo: e.target.value })} required placeholder="Ej: CB 250 Twister" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Año</label><input className="form-input" type="number" min="1990" max="2030" value={formData.anio} onChange={e => setFormData({ ...formData, anio: e.target.value })} placeholder="2024" /></div>
                  <div className="form-group"><label className="form-label">Color</label><input className="form-input" value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} placeholder="Rojo" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Cilindrada (cc)</label><input className="form-input" value={formData.cilindrada} onChange={e => setFormData({ ...formData, cilindrada: e.target.value })} placeholder="250" /></div>
                  <div className="form-group"><label className="form-label">Kilómetros</label><input className="form-input" type="number" min="0" value={formData.km} onChange={e => setFormData({ ...formData, km: e.target.value })} placeholder="0" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Precio</label><input className="form-input" type="number" min="0" value={formData.precio} onChange={e => setFormData({ ...formData, precio: e.target.value })} placeholder="1500000" /></div>
                  <div className="form-group"><label className="form-label">Estado</label><select className="form-input" value={formData.estado} onChange={e => setFormData({ ...formData, estado: e.target.value })}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                </div>
                <div className="form-group"><label className="form-label">Notas</label><textarea className="form-input" rows="3" value={formData.notas} onChange={e => setFormData({ ...formData, notas: e.target.value })} placeholder="Detalles adicionales..."></textarea></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
