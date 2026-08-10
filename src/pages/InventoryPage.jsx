import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, Edit, Trash2, Package } from 'lucide-react'

const STATUS_LABELS = { disponible: 'Disponible', reservada: 'Reservada', vendida: 'Vendida' }
const STATUS_COLORS = { disponible: 'nuevo', reservada: 'en_negociacion', vendida: 'venta_cerrada' }
const EMPTY_ITEM = { marca: '', modelo: '', anio: '', precio: '', estado: 'disponible', color: '', cilindrada: '', km: '', notas: '' }

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
  const [formData, setFormData] = useState(EMPTY_ITEM)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchInventory() }, [])

  async function fetchInventory() {
    try {
      const { data, error } = await supabase.from('inventario_motos').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setInventory(data || [])
    } catch (e) {
      console.error(e)
      // If table doesn't exist, show empty state
      setInventory([])
    } finally { setLoading(false) }
  }

  const filtered = useMemo(() => inventory.filter(i => {
    if (search && !`${i.marca} ${i.modelo}`.toLowerCase().includes(search.toLowerCase())) return false
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
      setFormData({ marca: item.marca || '', modelo: item.modelo || '', anio: item.anio || '', precio: item.precio || '', estado: item.estado || 'disponible', color: item.color || '', cilindrada: item.cilindrada || '', km: item.km || '', notas: item.notas || '' })
    } else {
      setEditingItem(null)
      setFormData(EMPTY_ITEM)
    }
    setIsModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...formData, precio: formData.precio ? Number(formData.precio) : null, anio: formData.anio ? Number(formData.anio) : null, km: formData.km ? Number(formData.km) : null }
      if (editingItem) {
        const { error } = await supabase.from('inventario_motos').update(payload).eq('id', editingItem.id)
        if (error) throw error
        addToast('Moto actualizada', 'success')
      } else {
        const { error } = await supabase.from('inventario_motos').insert([payload])
        if (error) throw error
        addToast('Moto agregada al inventario', 'success')
      }
      setIsModalOpen(false)
      fetchInventory()
    } catch (e) { addToast('Error al guardar', 'error'); console.error(e) }
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
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><Package size={20} /></div></div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Total Motos</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><Package size={20} /></div></div>
          <div className="stat-card-value">{stats.disponibles}</div>
          <div className="stat-card-label">Disponibles</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon purple"><Package size={20} /></div></div>
          <div className="stat-card-value">{stats.reservadas}</div>
          <div className="stat-card-label">Reservadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><Package size={20} /></div></div>
          <div className="stat-card-value">{fmt$(stats.valorStock)}</div>
          <div className="stat-card-label">Valor en Stock</div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar marca o modelo..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="filter-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => openModal()}><Plus size={14} /> Nueva Moto</button>}
        <span className="results-count">{filtered.length} motos</span>
      </div>

      <div className="card">
        <div className="card-body-flush">
          <table className="data-table">
            <thead>
              <tr><th>Marca</th><th>Modelo</th><th>Año</th><th>Color</th><th>Cilindrada</th><th>Km</th><th>Precio</th><th>Estado</th>{isAdmin && <th>Acciones</th>}</tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={isAdmin ? 9 : 8}><div className="empty-state"><p>No hay motos en el inventario</p></div></td></tr>
              ) : filtered.map(i => (
                <tr key={i.id}>
                  <td className="table-cell-primary">{i.marca}</td>
                  <td className="table-cell-primary">{i.modelo}</td>
                  <td>{i.anio || '-'}</td>
                  <td>{i.color || '-'}</td>
                  <td>{i.cilindrada ? `${i.cilindrada}cc` : '-'}</td>
                  <td>{i.km ? `${Number(i.km).toLocaleString('es-AR')} km` : '-'}</td>
                  <td className="table-cell-primary">{fmt$(i.precio)}</td>
                  <td><span className={`badge badge-${STATUS_COLORS[i.estado] || 'nuevo'}`}>{STATUS_LABELS[i.estado] || i.estado}</span></td>
                  {isAdmin && (
                    <td>
                      <div className="table-actions">
                        <button className="btn-icon" title="Editar" onClick={() => openModal(i)}><Edit size={16} /></button>
                        <button className="btn-icon danger" title="Eliminar" onClick={() => handleDelete(i.id)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingItem ? 'Editar Moto' : 'Nueva Moto'}</h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Marca *</label><input className="form-input" value={formData.marca} onChange={e => setFormData({ ...formData, marca: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Modelo *</label><input className="form-input" value={formData.modelo} onChange={e => setFormData({ ...formData, modelo: e.target.value })} required /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Año</label><input className="form-input" type="number" value={formData.anio} onChange={e => setFormData({ ...formData, anio: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Color</label><input className="form-input" value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Cilindrada (cc)</label><input className="form-input" type="number" value={formData.cilindrada} onChange={e => setFormData({ ...formData, cilindrada: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Kilómetros</label><input className="form-input" type="number" value={formData.km} onChange={e => setFormData({ ...formData, km: e.target.value })} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Precio</label><input className="form-input" type="number" value={formData.precio} onChange={e => setFormData({ ...formData, precio: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Estado</label><select className="form-input" value={formData.estado} onChange={e => setFormData({ ...formData, estado: e.target.value })}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                </div>
                <div className="form-group"><label className="form-label">Notas</label><textarea className="form-input" rows="3" value={formData.notas} onChange={e => setFormData({ ...formData, notas: e.target.value })}></textarea></div>
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
