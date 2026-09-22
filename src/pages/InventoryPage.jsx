import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, Edit, Trash2, Package, Eye, Upload, Globe, Star, CheckCircle, AlertCircle, Sparkles, Image as ImageIcon, Layers, ChevronLeft, ChevronRight } from 'lucide-react'
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
  const [viewSlideIdx, setViewSlideIdx] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')

  const [formData, setFormData] = useState({
    marca: '', modelo: '', anio: '', precio: '', estado: 'disponible',
    color: '', cilindrada: '', km: '', notas: '', imagen_url: '',
    imagenes: [], // Array of photo URLs for web gallery
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
    setUploadProgress('')
    if (item) {
      setEditingItem(item)
      // Extract photos array
      let imgs = []
      if (Array.isArray(item.imagenes) && item.imagenes.length) {
        imgs = item.imagenes
      } else if (item.imagen_url) {
        imgs = [item.imagen_url]
      }

      setFormData({
        marca: item.marca || '', modelo: item.modelo || '',
        anio: item.anio ? String(item.anio) : '', precio: item.precio ? String(item.precio) : '',
        estado: item.estado || 'disponible', color: item.color || '',
        cilindrada: item.cilindrada || '', km: item.km ? String(item.km) : '',
        notas: item.notas || '', imagen_url: item.imagen_url || (imgs[0] || ''),
        imagenes: imgs,
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
        imagenes: [],
        consumo: '', potencia: '', frenos: '', tanque: '', arranque: '',
        tagline: '', categoria: 'economica', destacada: false, visible_web: prefillWeb
      })
    }
    setIsModalOpen(true)
  }

  // Multi-image upload handler
  async function handleMultipleImageUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    setUploading(true)
    const uploadedUrls = []

    try {
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(`Optimizando foto ${i + 1} de ${files.length}...`)
        const res = await uploadOptimizedImage(files[i], supabase, 'motos')
        if (res?.url) {
          uploadedUrls.push(res.url)
        }
      }

      setFormData(prev => {
        const nextImgs = [...prev.imagenes, ...uploadedUrls]
        return {
          ...prev,
          imagenes: nextImgs,
          imagen_url: prev.imagen_url || nextImgs[0] || ''
        }
      })

      addToast(`⚡ ${uploadedUrls.length} foto${uploadedUrls.length > 1 ? 's' : ''} optimizada${uploadedUrls.length > 1 ? 's' : ''} y agregada${uploadedUrls.length > 1 ? 's' : ''} a la galería`, 'success')
    } catch (e) {
      console.error(e)
      addToast(`Error al procesar imágenes: ${e.message}`, 'error')
    } finally {
      setUploading(false)
      setUploadProgress('')
    }
  }

  function handleSetCoverPhoto(url) {
    setFormData(prev => {
      // Reorder array so cover is first
      const otherImgs = prev.imagenes.filter(u => u !== url)
      return {
        ...prev,
        imagen_url: url,
        imagenes: [url, ...otherImgs]
      }
    })
    addToast('Foto establecida como portada principal', 'success')
  }

  function handleRemovePhoto(indexToRemove) {
    setFormData(prev => {
      const nextImgs = prev.imagenes.filter((_, idx) => idx !== indexToRemove)
      const nextCover = nextImgs.length ? (nextImgs.includes(prev.imagen_url) ? prev.imagen_url : nextImgs[0]) : ''
      return {
        ...prev,
        imagenes: nextImgs,
        imagen_url: nextCover
      }
    })
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!formData.marca.trim() || !formData.modelo.trim()) {
      addToast('Marca y modelo son obligatorios', 'error')
      return
    }
    setSaving(true)
    try {
      const cover = formData.imagenes.length ? (formData.imagen_url || formData.imagenes[0]) : ''

      const payload = {
        marca: formData.marca.trim(),
        modelo: formData.modelo.trim(),
        estado: formData.estado || 'disponible',
        visible_web: Boolean(formData.visible_web),
        destacada: Boolean(formData.destacada),
        imagen_url: cover || null,
        imagenes: formData.imagenes || []
      }
      if (formData.anio) payload.anio = parseInt(formData.anio, 10)
      if (formData.precio) payload.precio = parseFloat(formData.precio)
      if (formData.color?.trim()) payload.color = formData.color.trim()
      if (formData.cilindrada?.trim()) payload.cilindrada = formData.cilindrada.trim()
      if (formData.km) payload.km = parseInt(formData.km, 10)
      if (formData.notas?.trim()) payload.notas = formData.notas.trim()
      
      // Web catalog attributes
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
      addToast(nextState ? '🌐 Moto publicada en la web' : '🔒 Moto ocultada de la web', 'success')
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

  function openDetailView(item) {
    setViewItem(item)
    setViewSlideIdx(0)
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* Top Stat Overview */}
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
        <div className="stat-card" style={{ border: '2px solid rgba(37,99,235,0.25)', background: 'rgba(37,99,235,0.02)' }}>
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

      {/* Segmented Filter Control & Search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div className="segmented-filters">
          <button className={`segmented-filter-btn ${filterWeb === 'all' ? 'active' : ''}`} onClick={() => setFilterWeb('all')}>
            <Layers size={14} /> Todas ({inventory.length})
          </button>
          <button className={`segmented-filter-btn ${filterWeb === 'web' ? 'active' : ''}`} onClick={() => setFilterWeb('web')}>
            <Globe size={14} style={{ color: '#2563EB' }} /> En Web ({stats.enWeb})
          </button>
          <button className={`segmented-filter-btn ${filterWeb === 'destacadas' ? 'active' : ''}`} onClick={() => setFilterWeb('destacadas')}>
            <Star size={14} style={{ color: '#CA8A04' }} /> Destacadas ({stats.destacadas})
          </button>
          <button className={`segmented-filter-btn ${filterWeb === 'offline' ? 'active' : ''}`} onClick={() => setFilterWeb('offline')}>
            🔒 Solo Internas ({inventory.length - stats.enWeb})
          </button>
        </div>

        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={() => openModal(null, true)} style={{ background: '#DC2626', borderColor: '#DC2626', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={16} /> Publicar Moto en la Web
          </button>
        )}
      </div>

      {/* Search & Status Filters */}
      <div className="filters-bar" style={{ marginBottom: 20 }}>
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar por marca, modelo o color..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <select className="filter-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <span className="results-count" style={{ marginLeft: 'auto' }}>{filtered.length} motos encontradas</span>
      </div>

      {/* Inventory Cards Grid */}
      <div className="inventory-grid">
        {filtered.length === 0 ? (
          <div className="card" style={{ gridColumn: '1/-1' }}>
            <div className="card-body">
              <div className="empty-state" style={{ padding: '36px 16px' }}>
                <Globe size={44} style={{ color: '#2563EB', marginBottom: 12 }} />
                <h4 style={{ margin: '0 0 6px', color: 'var(--gray-900)', fontSize: '1.125rem' }}>
                  {filterWeb === 'web' ? 'No tenés motos publicadas en la web aún' : 'No se encontraron motos con esos filtros'}
                </h4>
                <p style={{ color: '#71717A', fontSize: '0.875rem', marginBottom: 18, maxWidth: 460, margin: '0 auto 18px' }}>
                  Podés crear una nueva publicación con fotos múltiples y ficha técnica en un solo clic.
                </p>
                {isAdmin && (
                  <button className="btn btn-primary btn-sm" onClick={() => openModal(null, true)}>
                    <Plus size={14} /> Publicar Moto en la Web
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : filtered.map(item => {
          const itemImgs = Array.isArray(item.imagenes) && item.imagenes.length ? item.imagenes : (item.imagen_url ? [item.imagen_url] : [])
          const coverImg = item.imagen_url || itemImgs[0]

          return (
            <div key={item.id} className="inventory-card" style={{ border: item.visible_web ? '1px solid rgba(37,99,235,0.35)' : '1px solid var(--gray-200)' }}>
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

                {coverImg ? (
                  <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => openDetailView(item)}>
                    <img src={coverImg} alt={`${item.marca} ${item.modelo}`} style={{ width: 68, height: 68, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--gray-200)' }} />
                    {itemImgs.length > 1 && (
                      <span style={{ position: 'absolute', bottom: -4, right: -4, background: 'rgba(24,24,27,0.85)', color: '#fff', fontSize: '0.55rem', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                        📷 {itemImgs.length}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="inventory-card-icon" style={{ cursor: 'pointer' }} onClick={() => openDetailView(item)}><Package size={32} /></div>
                )}
              </div>

              <div className="inventory-card-body">
                <div className="inventory-card-title" style={{ fontSize: '1.05rem', fontWeight: 800 }}>{item.marca} {item.modelo}</div>
                <div className="inventory-card-specs">
                  {item.anio && <span className="inventory-spec">{item.anio}</span>}
                  {item.color && <span className="inventory-spec">{item.color}</span>}
                  {item.cilindrada && <span className="inventory-spec">{item.cilindrada} cc</span>}
                  {item.categoria && <span className="inventory-spec" style={{ background: 'rgba(37,99,235,0.06)', color: '#2563EB' }}>{CAT_LABELS[item.categoria] || item.categoria}</span>}
                </div>
                <div className="inventory-card-price" style={{ fontSize: '1.2rem', fontWeight: 800, color: '#DC2626' }}>{fmt$(item.precio)}</div>
              </div>

              {/* Action Toolbar */}
              <div className="inventory-card-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => openDetailView(item)} title="Ver Galería y Ficha"><Eye size={14} /> Ver</button>
                
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
          )
        })}
      </div>

      {/* DETAIL MODAL WITH MULTI-PHOTO INTERACTIVE SLIDER */}
      {viewItem && (() => {
        const viewImgs = Array.isArray(viewItem.imagenes) && viewItem.imagenes.length ? viewItem.imagenes : (viewItem.imagen_url ? [viewItem.imagen_url] : [])
        const currentImg = viewImgs[viewSlideIdx] || viewImgs[0]

        return (
          <div className="modal-overlay" onClick={() => setViewItem(null)}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3 style={{ margin: 0 }}>{viewItem.marca} {viewItem.modelo}</h3>
                <button className="modal-close" onClick={() => setViewItem(null)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                {/* Photo Gallery Viewer */}
                {viewImgs.length > 0 && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ position: 'relative', height: 260, background: '#09090b', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img src={currentImg} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      
                      {viewImgs.length > 1 && (
                        <>
                          <button
                            onClick={() => setViewSlideIdx((viewSlideIdx - 1 + viewImgs.length) % viewImgs.length)}
                            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <ChevronLeft size={18} />
                          </button>
                          <button
                            onClick={() => setViewSlideIdx((viewSlideIdx + 1) % viewImgs.length)}
                            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <ChevronRight size={18} />
                          </button>
                          <span style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '0.6875rem', padding: '3px 8px', borderRadius: 4 }}>
                            {viewSlideIdx + 1} / {viewImgs.length}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Thumbs strip */}
                    {viewImgs.length > 1 && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, overflowX: 'auto', paddingBottom: 4 }}>
                        {viewImgs.map((img, idx) => (
                          <img
                            key={idx}
                            src={img}
                            alt=""
                            onClick={() => setViewSlideIdx(idx)}
                            style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: viewSlideIdx === idx ? '2px solid #2563EB' : '1px solid var(--gray-300)', opacity: viewSlideIdx === idx ? 1 : 0.7 }}
                          />
                        ))}
                      </div>
                    )}
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
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#2563EB', textTransform: 'uppercase' }}>🌐 Configuración Web Pública:</span>
                </div>
                <div className="detail-row"><span className="detail-label">Visibilidad Web</span><span className="detail-value">{viewItem.visible_web ? '✅ Publicada en Catálogo' : '🔒 Oculta'}</span></div>
                <div className="detail-row"><span className="detail-label">Portada Home</span><span className="detail-value">{viewItem.destacada ? '⭐ Destacada' : 'Normal'}</span></div>
                <div className="detail-row"><span className="detail-label">Categoría</span><span className="detail-value">{CAT_LABELS[viewItem.categoria] || viewItem.categoria || '-'}</span></div>
                {viewItem.potencia && <div className="detail-row"><span className="detail-label">Potencia</span><span className="detail-value">{viewItem.potencia}</span></div>}
                {viewItem.consumo && <div className="detail-row"><span className="detail-label">Consumo</span><span className="detail-value">{viewItem.consumo}</span></div>}
                {viewItem.frenos && <div className="detail-row"><span className="detail-label">Frenos</span><span className="detail-value">{viewItem.frenos}</span></div>}
                {viewItem.tanque && <div className="detail-row"><span className="detail-label">Tanque</span><span className="detail-value">{viewItem.tanque}</span></div>}
                {viewItem.arranque && <div className="detail-row"><span className="detail-label">Arranque</span><span className="detail-value">{viewItem.arranque}</span></div>}
                {viewItem.tagline && <div className="detail-row"><span className="detail-label">Frase Web</span><span className="detail-value" style={{ fontStyle: 'italic' }}>"{viewItem.tagline}"</span></div>}
              </div>
              <div className="modal-footer">
                {isAdmin && <button className="btn btn-primary" onClick={() => { setViewItem(null); openModal(viewItem) }}>Editar Publicación</button>}
                <button className="btn btn-secondary" onClick={() => setViewItem(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* CREATE / EDIT MODAL WITH MULTI-PHOTO UPLOADER */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={20} style={{ color: '#DC2626' }} />
                <h3 style={{ margin: 0 }}>{editingItem ? 'Editar Publicación' : 'Publicar Nueva Moto'}</h3>
              </div>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                
                {/* 1. MULTI-PHOTO GALLERY UPLOADER */}
                <div className="multi-photo-uploader">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <label className="form-label" style={{ fontWeight: 800, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                      <ImageIcon size={16} /> Galería de Fotos (Podés subir varias fotos a la vez)
                    </label>
                    <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                      {formData.imagenes.length} foto{formData.imagenes.length !== 1 ? 's' : ''} cargada{formData.imagenes.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {uploadProgress && (
                    <div style={{ background: 'rgba(37,99,235,0.08)', color: '#2563EB', padding: '8px 12px', borderRadius: 6, fontSize: '0.8125rem', fontWeight: 600, margin: '10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="spinner-sm" /> {uploadProgress}
                    </div>
                  )}

                  {/* Thumbnails grid */}
                  <div className="multi-photo-grid">
                    {formData.imagenes.map((url, idx) => {
                      const isCover = (formData.imagen_url === url) || (!formData.imagen_url && idx === 0)
                      return (
                        <div key={idx} className={`photo-thumb-card ${isCover ? 'is-cover' : ''}`}>
                          {isCover && <span className="photo-thumb-cover-badge">Portada</span>}
                          <img src={url} alt="" />
                          <div className="photo-thumb-actions">
                            {!isCover && (
                              <button
                                type="button"
                                className="btn-thumb-action star"
                                title="Establecer como foto de portada"
                                onClick={() => handleSetCoverPhoto(url)}
                              >
                                <Star size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-thumb-action danger"
                              title="Eliminar foto"
                              onClick={() => handleRemovePhoto(idx)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      )
                    })}

                    {/* Add More Dropzone */}
                    <label className="add-photo-dropzone">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleMultipleImageUpload}
                        style={{ display: 'none' }}
                        disabled={uploading}
                      />
                      <Upload size={20} />
                      <span>{uploading ? 'Cargando...' : '+ Subir Fotos'}</span>
                    </label>
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: 'var(--gray-500)' }}>
                    💡 <strong>Tip</strong>: Pasá el mouse sobre cualquier foto para marcarla como Portada o eliminarla. Las fotos se optimizan solas a formato WebP.
                  </p>
                </div>

                {/* 2. DATOS GENERALES */}
                <div style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--gray-900)', marginBottom: 10 }}>
                  🏍️ Datos del Vehículo
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Marca *</label><input className="form-input" value={formData.marca} onChange={e => setFormData(p => ({ ...p, marca: e.target.value }))} required placeholder="Honda, Bajaj, Keller, Motomel..." /></div>
                  <div className="form-group"><label className="form-label">Modelo *</label><input className="form-input" value={formData.modelo} onChange={e => setFormData(p => ({ ...p, modelo: e.target.value }))} required placeholder="XR 250 Tornado, Rouser NS 200..." /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Año</label><input className="form-input" type="number" value={formData.anio} onChange={e => setFormData(p => ({ ...p, anio: e.target.value }))} placeholder="2026" /></div>
                  <div className="form-group"><label className="form-label">Color</label><input className="form-input" value={formData.color} onChange={e => setFormData(p => ({ ...p, color: e.target.value }))} placeholder="Rojo, Negro, Blanco..." /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Cilindrada (cc)</label><input className="form-input" value={formData.cilindrada} onChange={e => setFormData(p => ({ ...p, cilindrada: e.target.value }))} placeholder="110, 150, 250..." /></div>
                  <div className="form-group"><label className="form-label">Kilometraje</label><input className="form-input" type="number" min="0" value={formData.km} onChange={e => setFormData(p => ({ ...p, km: e.target.value }))} placeholder="0 para 0KM" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Precio de Venta ($)</label><input className="form-input" type="number" min="0" value={formData.precio} onChange={e => setFormData(p => ({ ...p, precio: e.target.value }))} placeholder="1850000" /></div>
                  <div className="form-group"><label className="form-label">Estado Stock</label><select className="form-input" value={formData.estado} onChange={e => setFormData(p => ({ ...p, estado: e.target.value }))}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                </div>

                {/* 3. PUBLICACIÓN EN CATÁLOGO WEB */}
                <div style={{ border: '2px solid rgba(37,99,235,0.25)', background: 'rgba(37,99,235,0.02)', padding: 16, borderRadius: 8, marginTop: 16 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#2563EB', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <Globe size={18} /> Publicación en Catálogo Web Oficial
                  </div>

                  <div style={{ display: 'flex', gap: 24, padding: '12px 16px', background: 'var(--neu-surface, #fff)', borderRadius: 6, border: '1px solid var(--gray-200)', marginBottom: 14 }}>
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
