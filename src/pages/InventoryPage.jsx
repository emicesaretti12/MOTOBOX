import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, Edit, Trash2, Package, Eye, Upload, Globe, Star } from 'lucide-react'

const STATUS_LABELS = { disponible: 'Disponible', reservada: 'Reservada', vendida: 'Vendida' }
const STATUS_BADGE = { disponible: 'nuevo', reservada: 'en_negociacion', vendida: 'venta_cerrada' }
const CAT_LABELS = { economica: 'Económica & Urbana', diario: 'Uso Diario & Sport', viajar: 'Aventura & Sierras' }

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
  const [uploading, setUploading] = useState(false)
  const [formData, setFormData] = useState({
    marca: '', modelo: '', anio: '', precio: '', estado: 'disponible',
    color: '', cilindrada: '', km: '', notas: '', imagen_url: '',
    consumo: '', potencia: '', frenos: '', tanque: '', arranque: '',
    tagline: '', categoria: 'economica', destacada: false, visible_web: true
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchInventory()

    const channel = supabase
      .channel('inventario-motos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventario_motos' }, () => {
        fetchInventory()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

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
    enWeb: inventory.filter(i => i.visible_web).length,
    valorStock: inventory.filter(i => i.estado === 'disponible').reduce((s, i) => s + (Number(i.precio) || 0), 0)
  }), [inventory])

  function openModal(item) {
    if (item) {
      setEditingItem(item)
      setFormData({
        marca: item.marca || '', modelo: item.modelo || '',
        anio: item.anio ? String(item.anio) : '', precio: item.precio ? String(item.precio) : '',
        estado: item.estado || 'disponible', color: item.color || '',
        cilindrada: item.cilindrada || '', km: item.km ? String(item.km) : '',
        notas: item.notas || '', imagen_url: item.imagen_url || '',
        consumo: item.consumo || '', potencia: item.potencia || '',
        frenos: item.frenos || '', tanque: item.tanque || '',
        arranque: item.arranque || '', tagline: item.tagline || '',
        categoria: item.categoria || 'economica',
        destacada: item.destacada || false, visible_web: item.visible_web !== false
      })
    } else {
      setEditingItem(null)
      setFormData({
        marca: '', modelo: '', anio: '', precio: '', estado: 'disponible',
        color: '', cilindrada: '', km: '', notas: '', imagen_url: '',
        consumo: '', potencia: '', frenos: '', tanque: '', arranque: '',
        tagline: '', categoria: 'economica', destacada: false, visible_web: true
      })
    }
    setIsModalOpen(true)
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { addToast('Solo imágenes', 'error'); return }
    if (file.size > 5 * 1024 * 1024) { addToast('Máximo 5MB', 'error'); return }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const fileName = `moto_${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('motobox-public').upload(`motos/${fileName}`, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('motobox-public').getPublicUrl(`motos/${fileName}`)
      setFormData(prev => ({ ...prev, imagen_url: data.publicUrl }))
      addToast('Imagen subida', 'success')
    } catch (e) {
      console.error(e)
      addToast('Error al subir. Verificá que el bucket "motobox-public" exista.', 'error')
    } finally { setUploading(false) }
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!formData.marca.trim() || !formData.modelo.trim()) { addToast('Marca y modelo obligatorios', 'error'); return }
    setSaving(true)
    try {
      const payload = { marca: formData.marca.trim(), modelo: formData.modelo.trim(), estado: formData.estado }
      if (formData.anio) payload.anio = parseInt(formData.anio, 10)
      if (formData.precio) payload.precio = parseFloat(formData.precio)
      if (formData.color.trim()) payload.color = formData.color.trim()
      if (formData.cilindrada.trim()) payload.cilindrada = formData.cilindrada.trim()
      if (formData.km) payload.km = parseInt(formData.km, 10)
      if (formData.notas.trim()) payload.notas = formData.notas.trim()
      // Web catalog fields
      payload.imagen_url = formData.imagen_url || null
      payload.consumo = formData.consumo.trim() || null
      payload.potencia = formData.potencia.trim() || null
      payload.frenos = formData.frenos.trim() || null
      payload.tanque = formData.tanque.trim() || null
      payload.arranque = formData.arranque.trim() || null
      payload.tagline = formData.tagline.trim() || null
      payload.categoria = formData.categoria || 'economica'
      payload.destacada = formData.destacada
      payload.visible_web = formData.visible_web

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
    } catch (e) { console.error(e); addToast(`Error: ${e.message}`, 'error') }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!isAdmin) return
    if (!window.confirm('¿Eliminar esta moto?')) return
    try {
      const { error } = await supabase.from('inventario_motos').delete().eq('id', id)
      if (error) throw error
      addToast('Moto eliminada', 'success')
      fetchInventory()
    } catch (e) { addToast('Error', 'error') }
  }

  async function toggleWebVisibility(item) {
    try {
      const { error } = await supabase.from('inventario_motos').update({ visible_web: !item.visible_web }).eq('id', item.id)
      if (error) throw error
      addToast(item.visible_web ? 'Oculta del catálogo web' : 'Visible en catálogo web', 'success')
      fetchInventory()
    } catch (e) { addToast('Error', 'error') }
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon blue"><Package size={20} /></div></div><div className="stat-card-value">{stats.total}</div><div className="stat-card-label">Total Motos</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon green"><Package size={20} /></div></div><div className="stat-card-value">{stats.disponibles}</div><div className="stat-card-label">Disponibles</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon purple"><Globe size={20} /></div></div><div className="stat-card-value">{stats.enWeb}</div><div className="stat-card-label">En Catálogo Web</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon red"><Package size={20} /></div></div><div className="stat-card-value">{fmt$(stats.valorStock)}</div><div className="stat-card-label">Valor en Stock</div></div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap"><Search size={16} /><input placeholder="Buscar marca, modelo o color..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <select className="filter-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => openModal()}><Plus size={14} /> Nueva Moto</button>}
        <span className="results-count">{filtered.length} motos</span>
      </div>

      <div className="inventory-grid">
        {filtered.length === 0 ? (
          <div className="card" style={{ gridColumn: '1/-1' }}><div className="card-body"><div className="empty-state"><p>No hay motos. Agregá la primera.</p></div></div></div>
        ) : filtered.map(item => (
          <div key={item.id} className="inventory-card">
            <div className="inventory-card-top">
              <div className="inventory-card-badge">
                <span className={`badge badge-${STATUS_BADGE[item.estado]}`}>{STATUS_LABELS[item.estado]}</span>
                {item.visible_web && <span className="badge" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563EB', fontSize: '0.5625rem' }}>🌐 Web</span>}
                {item.destacada && <span className="badge" style={{ background: 'rgba(234,179,8,0.08)', color: '#CA8A04', fontSize: '0.5625rem' }}>⭐</span>}
              </div>
              {item.imagen_url ? (
                <img src={item.imagen_url} alt={`${item.marca} ${item.modelo}`} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }} />
              ) : (
                <div className="inventory-card-icon"><Package size={32} /></div>
              )}
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
              {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => toggleWebVisibility(item)}><Globe size={14} /> {item.visible_web ? 'Ocultar' : 'Mostrar'}</button>}
              {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => openModal(item)}><Edit size={14} /></button>}
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
              {viewItem.imagen_url && <img src={viewItem.imagen_url} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8, marginBottom: 16 }} />}
              <div className="detail-row"><span className="detail-label">Marca</span><span className="detail-value">{viewItem.marca}</span></div>
              <div className="detail-row"><span className="detail-label">Modelo</span><span className="detail-value">{viewItem.modelo}</span></div>
              <div className="detail-row"><span className="detail-label">Año</span><span className="detail-value">{viewItem.anio || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Color</span><span className="detail-value">{viewItem.color || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Cilindrada</span><span className="detail-value">{viewItem.cilindrada ? `${viewItem.cilindrada}cc` : '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Km</span><span className="detail-value">{viewItem.km ? `${Number(viewItem.km).toLocaleString('es-AR')} km` : '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Precio</span><span className="detail-value" style={{ fontWeight: 700, color: '#DC2626' }}>{fmt$(viewItem.precio)}</span></div>
              <div className="detail-row"><span className="detail-label">Estado</span><span className="detail-value"><span className={`badge badge-${STATUS_BADGE[viewItem.estado]}`}>{STATUS_LABELS[viewItem.estado]}</span></span></div>
              <div className="detail-row"><span className="detail-label">Web</span><span className="detail-value">{viewItem.visible_web ? '🌐 Visible' : 'Oculta'}</span></div>
              {viewItem.tagline && <div className="detail-row"><span className="detail-label">Tagline</span><span className="detail-value">{viewItem.tagline}</span></div>}
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
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editingItem ? 'Editar Moto' : 'Nueva Moto'}</h3><button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button></div>
            <form onSubmit={handleSave}>
              <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                {/* Image */}
                <div className="form-group">
                  <label className="form-label">📸 Imagen</label>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {formData.imagen_url && <img src={formData.imagen_url} alt="" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6 }} />}
                    <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                      <Upload size={14} /> {uploading ? 'Subiendo...' : 'Subir Foto'}
                      <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} disabled={uploading} />
                    </label>
                  </div>
                  <input className="form-input" value={formData.imagen_url} onChange={e => setFormData(prev => ({ ...prev, imagen_url: e.target.value }))} placeholder="O pegá URL de imagen" style={{ marginTop: 6, fontSize: '0.75rem' }} />
                </div>

                {/* Basic */}
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Marca *</label><input className="form-input" value={formData.marca} onChange={e => setFormData(p => ({ ...p, marca: e.target.value }))} required placeholder="Honda" /></div>
                  <div className="form-group"><label className="form-label">Modelo *</label><input className="form-input" value={formData.modelo} onChange={e => setFormData(p => ({ ...p, modelo: e.target.value }))} required placeholder="CB 250 Twister" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Año</label><input className="form-input" type="number" value={formData.anio} onChange={e => setFormData(p => ({ ...p, anio: e.target.value }))} /></div>
                  <div className="form-group"><label className="form-label">Color</label><input className="form-input" value={formData.color} onChange={e => setFormData(p => ({ ...p, color: e.target.value }))} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Cilindrada (cc)</label><input className="form-input" value={formData.cilindrada} onChange={e => setFormData(p => ({ ...p, cilindrada: e.target.value }))} placeholder="250" /></div>
                  <div className="form-group"><label className="form-label">Km</label><input className="form-input" type="number" value={formData.km} onChange={e => setFormData(p => ({ ...p, km: e.target.value }))} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Precio</label><input className="form-input" type="number" value={formData.precio} onChange={e => setFormData(p => ({ ...p, precio: e.target.value }))} /></div>
                  <div className="form-group"><label className="form-label">Estado</label><select className="form-input" value={formData.estado} onChange={e => setFormData(p => ({ ...p, estado: e.target.value }))}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                </div>

                {/* Web Catalog Fields */}
                <div style={{ borderTop: '1px solid #E4E4E7', marginTop: 16, paddingTop: 16 }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#18181B', marginBottom: 12 }}>🌐 Datos para Catálogo Web</div>
                  <div className="form-group"><label className="form-label">Tagline (frase corta para la web)</label><input className="form-input" value={formData.tagline} onChange={e => setFormData(p => ({ ...p, tagline: e.target.value }))} placeholder="La reina del ahorro urbano..." /></div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Consumo</label><input className="form-input" value={formData.consumo} onChange={e => setFormData(p => ({ ...p, consumo: e.target.value }))} placeholder="2.1 L / 100km" /></div>
                    <div className="form-group"><label className="form-label">Potencia</label><input className="form-input" value={formData.potencia} onChange={e => setFormData(p => ({ ...p, potencia: e.target.value }))} placeholder="24.5 HP" /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Frenos</label><input className="form-input" value={formData.frenos} onChange={e => setFormData(p => ({ ...p, frenos: e.target.value }))} placeholder="Disco / Tambor" /></div>
                    <div className="form-group"><label className="form-label">Tanque</label><input className="form-input" value={formData.tanque} onChange={e => setFormData(p => ({ ...p, tanque: e.target.value }))} placeholder="12 Litros" /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Arranque</label><input className="form-input" value={formData.arranque} onChange={e => setFormData(p => ({ ...p, arranque: e.target.value }))} placeholder="Eléctrico" /></div>
                    <div className="form-group"><label className="form-label">Categoría Web</label><select className="form-input" value={formData.categoria} onChange={e => setFormData(p => ({ ...p, categoria: e.target.value }))}>{Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={formData.visible_web} onChange={e => setFormData(p => ({ ...p, visible_web: e.target.checked }))} style={{ width: 16, height: 16, accentColor: '#2563EB' }} />
                      🌐 Visible en Web
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={formData.destacada} onChange={e => setFormData(p => ({ ...p, destacada: e.target.checked }))} style={{ width: 16, height: 16, accentColor: '#CA8A04' }} />
                      ⭐ Destacada en Home
                    </label>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: 12 }}><label className="form-label">Notas internas</label><textarea className="form-input" rows="2" value={formData.notas} onChange={e => setFormData(p => ({ ...p, notas: e.target.value }))}></textarea></div>
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
