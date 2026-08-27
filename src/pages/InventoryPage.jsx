import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, Edit, Trash2, Package, Eye, Upload, Globe, Star, CheckCircle, AlertCircle, Sparkles, Image as ImageIcon } from 'lucide-react'
import { uploadOptimizedImage } from '../lib/imageOptimizer'

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
  const [filterWeb, setFilterWeb] = useState('all') // all | web | destacadas | offline
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [viewItem, setViewItem] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStats, setUploadStats] = useState(null)
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
    } catch (e) {
      console.error(e)
      setInventory([])
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => inventory.filter(i => {
    if (search && !`${i.marca} ${i.modelo} ${i.color || ''}`.toLowerCase().includes(search.toLowerCase())) return false
    if (filterEstado && i.estado !== filterEstado) return false
    if (filterWeb === 'web' && !i.visible_web) return false
    if (filterWeb === 'destacadas' && (!i.visible_web || !i.destacada)) return false
    if (filterWeb === 'offline' && i.visible_web) return false
    return true
  }), [inventory, search, filterEstado, filterWeb])

  const stats = useMemo(() => ({
    total: inventory.length,
    disponibles: inventory.filter(i => i.estado === 'disponible').length,
    enWeb: inventory.filter(i => i.visible_web).length,
    destacadas: inventory.filter(i => i.visible_web && i.destacada).length,
    valorStock: inventory.filter(i => i.estado === 'disponible').reduce((s, i) => s + (Number(i.precio) || 0), 0)
  }), [inventory])

  function openModal(item, prefillWeb = true) {
    setUploadStats(null)
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
        tagline: '', categoria: 'economica', destacada: false, visible_web: prefillWeb
      })
    }
    setIsModalOpen(true)
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadStats(null)
    try {
      // Automatic client-side canvas WebP compression (Cloudinary / Supabase)
      const res = await uploadOptimizedImage(file, supabase, 'motos')
      setFormData(prev => ({ ...prev, imagen_url: res.url }))
      setUploadStats({ provider: res.provider })
      addToast(`⚡ Foto optimizada y subida correctamente (${res.provider === 'cloudinary' ? 'Cloudinary' : 'WebP ultra-liviana'})`, 'success')
    } catch (e) {
      console.error(e)
      addToast(`Error al subir imagen: ${e.message}`, 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!formData.marca.trim() || !formData.modelo.trim()) {
      addToast('Marca y modelo son obligatorios', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        marca: formData.marca.trim(),
        modelo: formData.modelo.trim(),
        estado: formData.estado || 'disponible',
        visible_web: Boolean(formData.visible_web),
        destacada: Boolean(formData.destacada)
      }
      if (formData.anio) payload.anio = parseInt(formData.anio, 10)
      if (formData.precio) payload.precio = parseFloat(formData.precio)
      if (formData.color?.trim()) payload.color = formData.color.trim()
      if (formData.cilindrada?.trim()) payload.cilindrada = formData.cilindrada.trim()
      if (formData.km) payload.km = parseInt(formData.km, 10)
      if (formData.notas?.trim()) payload.notas = formData.notas.trim()
      
      // Web catalog attributes
      payload.imagen_url = formData.imagen_url || null
      payload.consumo = formData.consumo?.trim() || null
      payload.potencia = formData.potencia?.trim() || null
      payload.frenos = formData.frenos?.trim() || null
      payload.tanque = formData.tanque?.trim() || null
      payload.arranque = formData.arranque?.trim() || null
      payload.tagline = formData.tagline?.trim() || null
      payload.categoria = formData.categoria || 'economica'

      let error
      if (editingItem) {
        ({ error } = await supabase.from('inventario_motos').update(payload).eq('id', editingItem.id))
      } else {
        ({ error } = await supabase.from('inventario_motos').insert(payload))
      }
      if (error) throw error
      addToast(editingItem ? 'Moto actualizada en inventario y web' : 'Moto agregada con éxito', 'success')
      setIsModalOpen(false)
      fetchInventory()
    } catch (e) {
      console.error(e)
      addToast(`Error al guardar: ${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!isAdmin) return
    if (!window.confirm('¿Eliminar esta moto del inventario y de la web?')) return
    try {
      const { error } = await supabase.from('inventario_motos').delete().eq('id', id)
      if (error) throw error
      addToast('Moto eliminada', 'success')
      fetchInventory()
    } catch (e) {
      addToast('Error al eliminar', 'error')
    }
  }

  async function toggleWebVisibility(item) {
    if (!isAdmin) return
    try {
      const nextState = !item.visible_web
      const { error } = await supabase.from('inventario_motos').update({ visible_web: nextState }).eq('id', item.id)
      if (error) throw error
      addToast(nextState ? '🌐 Moto publicada en la web pública' : '🔒 Moto ocultada de la web', 'success')
      fetchInventory()
    } catch (e) {
      addToast('Error al cambiar visibilidad', 'error')
    }
  }

  async function toggleDestacada(item) {
    if (!isAdmin) return
    try {
      const nextState = !item.destacada
      const { error } = await supabase.from('inventario_motos').update({ destacada: nextState, visible_web: true }).eq('id', item.id)
      if (error) throw error
      addToast(nextState ? '⭐ Marcada como destacada en el Home' : 'Destacada removida', 'success')
      fetchInventory()
    } catch (e) {
      addToast('Error al cambiar destacada', 'error')
    }
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* Stats Overview */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><Package size={20} /></div></div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Total Inventario</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><Package size={20} /></div></div>
          <div className="stat-card-value">{stats.disponibles}</div>
          <div className="stat-card-label">Disponibles</div>
        </div>
        <div className="stat-card" style={{ border: '2px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.02)' }}>
          <div className="stat-card-header"><div className="stat-card-icon purple"><Globe size={20} /></div></div>
          <div className="stat-card-value" style={{ color: '#2563EB' }}>{stats.enWeb}</div>
          <div className="stat-card-label">🌐 En Catálogo Web</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon yellow"><Star size={20} /></div></div>
          <div className="stat-card-value">{stats.destacadas}</div>
          <div className="stat-card-label">⭐ Destacadas en Home</div>
        </div>
      </div>

      {/* Filters Bar & Quick Action */}
      <div className="filters-bar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar marca, modelo o color..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <select className="filter-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {/* Quick Filter: Web vs Internal */}
        <select className="filter-select" value={filterWeb} onChange={e => setFilterWeb(e.target.value)} style={{ fontWeight: 600 }}>
          <option value="all">Todas (Web + Internas)</option>
          <option value="web">🌐 Solo Publicadas en Web</option>
          <option value="destacadas">⭐ Solo Destacadas en Home</option>
          <option value="offline">🔒 Solo Internas (Ocultas)</option>
        </select>

        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={() => openModal(null, true)} style={{ background: '#DC2626', borderColor: '#DC2626' }}>
            <Plus size={15} /> Publicar Moto en la Web
          </button>
        )}

        <span className="results-count" style={{ marginLeft: 'auto' }}>{filtered.length} motos</span>
      </div>

      {/* Cards Grid */}
      <div className="inventory-grid">
        {filtered.length === 0 ? (
          <div className="card" style={{ gridColumn: '1/-1' }}>
            <div className="card-body">
              <div className="empty-state">
                <Globe size={40} style={{ color: '#2563EB', marginBottom: 12 }} />
                <p style={{ fontWeight: 600, fontSize: '1rem', color: '#18181B' }}>
                  {filterWeb === 'web' ? 'No tenés motos publicadas en la web aún.' : 'No se encontraron motos con esos filtros.'}
                </p>
                <p style={{ color: '#71717A', fontSize: '0.875rem', marginBottom: 16 }}>
                  Podés crear una nueva moto optimizada para el catálogo online con un solo clic.
                </p>
                {isAdmin && (
                  <button className="btn btn-primary btn-sm" onClick={() => openModal(null, true)}>
                    <Plus size={14} /> Publicar Primera Moto en la Web
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : filtered.map(item => (
          <div key={item.id} className="inventory-card" style={{ border: item.visible_web ? '1px solid rgba(37,99,235,0.3)' : '1px solid var(--gray-200)' }}>
            <div className="inventory-card-top">
              <div className="inventory-card-badge" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <span className={`badge badge-${STATUS_BADGE[item.estado]}`}>{STATUS_LABELS[item.estado]}</span>
                {item.visible_web ? (
                  <span className="badge" style={{ background: 'rgba(22,163,74,0.1)', color: '#16A34A', fontSize: '0.625rem', fontWeight: 700 }}>
                    🌐 En Web
                  </span>
                ) : (
                  <span className="badge" style={{ background: 'var(--gray-100)', color: 'var(--gray-500)', fontSize: '0.625rem' }}>
                    🔒 Oculta
                  </span>
                )}
                {item.destacada && item.visible_web && (
                  <span className="badge" style={{ background: '#FEF3C7', color: '#B45309', fontSize: '0.625rem', fontWeight: 700 }}>
                    ⭐ Portada
                  </span>
                )}
              </div>
              {item.imagen_url ? (
                <div style={{ position: 'relative' }}>
                  <img src={item.imagen_url} alt={`${item.marca} ${item.modelo}`} style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }} />
                  <span style={{ position: 'absolute', bottom: -4, right: -4, background: '#10B981', color: '#fff', fontSize: '0.5rem', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>
                    ⚡ Opt
                  </span>
                </div>
              ) : (
                <div className="inventory-card-icon"><Package size={32} /></div>
              )}
            </div>

            <div className="inventory-card-body">
              <div className="inventory-card-title">{item.marca} {item.modelo}</div>
              <div className="inventory-card-specs">
                {item.anio && <span className="inventory-spec">{item.anio}</span>}
                {item.color && <span className="inventory-spec">{item.color}</span>}
                {item.cilindrada && <span className="inventory-spec">{item.cilindrada} cc</span>}
                {item.categoria && <span className="inventory-spec" style={{ background: 'rgba(37,99,235,0.06)', color: '#2563EB' }}>{CAT_LABELS[item.categoria] || item.categoria}</span>}
              </div>
              <div className="inventory-card-price">{fmt$(item.precio)}</div>
            </div>

            {/* Quick action bar */}
            <div className="inventory-card-actions" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewItem(item)} title="Ver Ficha"><Eye size={14} /> Ver</button>
              
              {isAdmin && (
                <>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleWebVisibility(item)}
                    style={{ color: item.visible_web ? '#2563EB' : 'var(--gray-600)' }}
                    title={item.visible_web ? 'Ocultar de la Web' : 'Publicar en la Web'}
                  >
                    <Globe size={14} /> {item.visible_web ? 'Web ON' : 'Publicar'}
                  </button>

                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleDestacada(item)}
                    style={{ color: item.destacada ? '#CA8A04' : 'var(--gray-400)' }}
                    title="Destacar en portada del Home"
                  >
                    <Star size={14} fill={item.destacada ? '#CA8A04' : 'none'} />
                  </button>

                  <button className="btn btn-ghost btn-sm" onClick={() => openModal(item)} title="Editar"><Edit size={14} /></button>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#DC2626' }} onClick={() => handleDelete(item.id)} title="Eliminar"><Trash2 size={14} /></button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* View Detail Modal */}
      {viewItem && (
        <div className="modal-overlay" onClick={() => setViewItem(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{viewItem.marca} {viewItem.modelo}</h3>
              <button className="modal-close" onClick={() => setViewItem(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {viewItem.imagen_url && (
                <div style={{ position: 'relative', marginBottom: 16 }}>
                  <img src={viewItem.imagen_url} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8 }} />
                  <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.6875rem', padding: '2px 8px', borderRadius: 4 }}>
                    ⚡ Imagen Optimizada WebP
                  </span>
                </div>
              )}
              <div className="detail-row"><span className="detail-label">Marca</span><span className="detail-value">{viewItem.marca}</span></div>
              <div className="detail-row"><span className="detail-label">Modelo</span><span className="detail-value">{viewItem.modelo}</span></div>
              <div className="detail-row"><span className="detail-label">Año</span><span className="detail-value">{viewItem.anio || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Color</span><span className="detail-value">{viewItem.color || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Cilindrada</span><span className="detail-value">{viewItem.cilindrada ? `${viewItem.cilindrada} cc` : '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Precio</span><span className="detail-value" style={{ fontWeight: 700, color: '#DC2626' }}>{fmt$(viewItem.precio)}</span></div>
              <div className="detail-row"><span className="detail-label">Estado</span><span className="detail-value"><span className={`badge badge-${STATUS_BADGE[viewItem.estado]}`}>{STATUS_LABELS[viewItem.estado]}</span></span></div>
              
              <div style={{ margin: '14px 0 8px', borderTop: '1px solid var(--gray-200)', paddingTop: 10 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#2563EB', textTransform: 'uppercase' }}>🌐 Datos en la Web Pública:</span>
              </div>
              <div className="detail-row"><span className="detail-label">Visibilidad Web</span><span className="detail-value">{viewItem.visible_web ? '✅ Visible en Catálogo' : '🔒 Oculta'}</span></div>
              <div className="detail-row"><span className="detail-label">Destacada Portada</span><span className="detail-value">{viewItem.destacada ? '⭐ Sí (Home)' : 'No'}</span></div>
              <div className="detail-row"><span className="detail-label">Categoría Web</span><span className="detail-value">{CAT_LABELS[viewItem.categoria] || viewItem.categoria || '-'}</span></div>
              {viewItem.potencia && <div className="detail-row"><span className="detail-label">Potencia</span><span className="detail-value">{viewItem.potencia}</span></div>}
              {viewItem.consumo && <div className="detail-row"><span className="detail-label">Consumo</span><span className="detail-value">{viewItem.consumo}</span></div>}
              {viewItem.frenos && <div className="detail-row"><span className="detail-label">Frenos</span><span className="detail-value">{viewItem.frenos}</span></div>}
              {viewItem.tanque && <div className="detail-row"><span className="detail-label">Tanque</span><span className="detail-value">{viewItem.tanque}</span></div>}
              {viewItem.arranque && <div className="detail-row"><span className="detail-label">Arranque</span><span className="detail-value">{viewItem.arranque}</span></div>}
              {viewItem.tagline && <div className="detail-row"><span className="detail-label">Frase Web</span><span className="detail-value" style={{ fontStyle: 'italic' }}>"{viewItem.tagline}"</span></div>}
            </div>
            <div className="modal-footer">
              {isAdmin && <button className="btn btn-primary" onClick={() => { setViewItem(null); openModal(viewItem) }}>Editar</button>}
              <button className="btn btn-secondary" onClick={() => setViewItem(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal with Ultra-Clear Web Publishing Section */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={20} style={{ color: '#DC2626' }} />
                <h3 style={{ margin: 0 }}>{editingItem ? 'Editar Moto' : 'Publicar Nueva Moto'}</h3>
              </div>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
                
                {/* 1. PHOTO UPLOADER WITH INSTANT OPTIMIZER */}
                <div style={{ background: 'var(--gray-50)', padding: 14, borderRadius: 8, border: '1px solid var(--gray-200)', marginBottom: 16 }}>
                  <label className="form-label" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ImageIcon size={16} /> Foto Principal de la Moto (Auto-Optimizada a WebP)
                  </label>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    {formData.imagen_url ? (
                      <div style={{ position: 'relative' }}>
                        <img src={formData.imagen_url} alt="" style={{ width: 100, height: 75, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--gray-300)' }} />
                        <span style={{ position: 'absolute', bottom: 4, right: 4, background: '#10B981', color: '#fff', fontSize: '0.55rem', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>
                          ⚡ WebP
                        </span>
                      </div>
                    ) : (
                      <div style={{ width: 100, height: 75, background: 'var(--gray-200)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-400)' }}>
                        <ImageIcon size={28} />
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex' }}>
                        <Upload size={14} /> {uploading ? 'Optimizando & Subiendo...' : 'Subir y Optimizar Foto'}
                        <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} disabled={uploading} />
                      </label>
                      <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                        Comprime y optimiza fotos de cámara (5-10MB) automáticamente a ~80KB para que la web cargue súper rápido.
                      </p>
                    </div>
                  </div>
                  <input
                    className="form-input"
                    value={formData.imagen_url}
                    onChange={e => setFormData(prev => ({ ...prev, imagen_url: e.target.value }))}
                    placeholder="O pegá URL directa de Cloudinary / imagen externa"
                    style={{ marginTop: 8, fontSize: '0.75rem' }}
                  />
                </div>

                {/* 2. DATOS GENERALES DE LA MOTO */}
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#18181B', marginBottom: 10 }}>
                  🏍️ Datos del Vehículo
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Marca *</label><input className="form-input" value={formData.marca} onChange={e => setFormData(p => ({ ...p, marca: e.target.value }))} required placeholder="Honda, Bajaj, Keller..." /></div>
                  <div className="form-group"><label className="form-label">Modelo *</label><input className="form-input" value={formData.modelo} onChange={e => setFormData(p => ({ ...p, modelo: e.target.value }))} required placeholder="XR 250 Tornado, Rouser NS 200..." /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Año</label><input className="form-input" type="number" value={formData.anio} onChange={e => setFormData(p => ({ ...p, anio: e.target.value }))} placeholder="2026" /></div>
                  <div className="form-group"><label className="form-label">Color</label><input className="form-input" value={formData.color} onChange={e => setFormData(p => ({ ...p, color: e.target.value }))} placeholder="Rojo, Negro, Azul..." /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Cilindrada (cc)</label><input className="form-input" value={formData.cilindrada} onChange={e => setFormData(p => ({ ...p, cilindrada: e.target.value }))} placeholder="110, 150, 250..." /></div>
                  <div className="form-group"><label className="form-label">Kilometraje</label><input className="form-input" type="number" min="0" value={formData.km} onChange={e => setFormData(p => ({ ...p, km: e.target.value }))} placeholder="0 para 0KM" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Precio de Venta ($)</label><input className="form-input" type="number" min="0" value={formData.precio} onChange={e => setFormData(p => ({ ...p, precio: e.target.value }))} placeholder="1850000" /></div>
                  <div className="form-group"><label className="form-label">Estado Stock</label><select className="form-input" value={formData.estado} onChange={e => setFormData(p => ({ ...p, estado: e.target.value }))}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                </div>

                {/* 3. PUBLICACIÓN EN LA WEB PÚBLICA */}
                <div style={{ border: '2px solid rgba(37,99,235,0.2)', background: 'rgba(37,99,235,0.02)', padding: 16, borderRadius: 8, marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#2563EB', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Globe size={18} /> Publicación en Catálogo Web Oficial
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 24, padding: '10px 14px', background: '#fff', borderRadius: 6, border: '1px solid var(--gray-200)', marginBottom: 14 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', color: formData.visible_web ? '#16A34A' : 'var(--gray-600)' }}>
                      <input type="checkbox" checked={formData.visible_web} onChange={e => setFormData(p => ({ ...p, visible_web: e.target.checked }))} style={{ width: 18, height: 18, accentColor: '#16A34A' }} />
                      🌐 Mostrar en la Web Pública
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', color: formData.destacada ? '#CA8A04' : 'var(--gray-600)' }}>
                      <input type="checkbox" checked={formData.destacada} onChange={e => setFormData(p => ({ ...p, destacada: e.target.checked }))} style={{ width: 18, height: 18, accentColor: '#CA8A04' }} />
                      ⭐ Destacar en Portada (Home)
                    </label>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Frase Promocional / Tagline</label>
                    <input className="form-input" value={formData.tagline} onChange={e => setFormData(p => ({ ...p, tagline: e.target.value }))} placeholder="Ej: La reina del ahorro urbano, agilidad y mínimo costo operativo." />
                  </div>

                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Categoría Web</label><select className="form-input" value={formData.categoria} onChange={e => setFormData(p => ({ ...p, categoria: e.target.value }))}>{Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                    <div className="form-group"><label className="form-label">Potencia</label><input className="form-input" value={formData.potencia} onChange={e => setFormData(p => ({ ...p, potencia: e.target.value }))} placeholder="24.5 HP (Triple bujía)" /></div>
                  </div>

                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Consumo Estimado</label><input className="form-input" value={formData.consumo} onChange={e => setFormData(p => ({ ...p, consumo: e.target.value }))} placeholder="2.1 L / 100km" /></div>
                    <div className="form-group"><label className="form-label">Sistema de Frenos</label><input className="form-input" value={formData.frenos} onChange={e => setFormData(p => ({ ...p, frenos: e.target.value }))} placeholder="Disco delantero / Tambor" /></div>
                  </div>

                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Capacidad Tanque</label><input className="form-input" value={formData.tanque} onChange={e => setFormData(p => ({ ...p, tanque: e.target.value }))} placeholder="12 Litros" /></div>
                    <div className="form-group"><label className="form-label">Tipo de Arranque</label><input className="form-input" value={formData.arranque} onChange={e => setFormData(p => ({ ...p, arranque: e.target.value }))} placeholder="Eléctrico y a pedal" /></div>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: 14 }}>
                  <label className="form-label">Notas Internas (solo CRM)</label>
                  <textarea className="form-input" rows="2" value={formData.notas} onChange={e => setFormData(p => ({ ...p, notas: e.target.value }))} placeholder="Detalles de proveedor, stock físico, etc."></textarea>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving || uploading} style={{ minWidth: 140 }}>
                  {saving ? 'Guardando...' : (editingItem ? 'Guardar Cambios' : 'Publicar Moto')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
