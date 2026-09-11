import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { Image as ImageIcon, Save, Eye, Upload, ExternalLink, Globe, Star, Plus, CheckCircle, Sparkles, RefreshCw } from 'lucide-react'
import { uploadOptimizedImage } from '../lib/imageOptimizer'

function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '-' }

export default function WebSettingsPage() {
  const { addToast } = useToast()
  const [activeTab, setActiveTab] = useState('poster') // poster | catalogo
  const [config, setConfig] = useState(null)
  const [motosWeb, setMotosWeb] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewImg, setPreviewImg] = useState(null)

  useEffect(() => {
    fetchConfig()
    fetchWebMotos()

    const configChannel = supabase
      .channel('configuracion-web-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'configuracion_web' }, () => {
        fetchConfig()
      })
      .subscribe()

    const motosChannel = supabase
      .channel('web-motos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventario_motos' }, () => {
        fetchWebMotos()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(configChannel)
      supabase.removeChannel(motosChannel)
    }
  }, [])

  async function fetchConfig() {
    try {
      const { data, error } = await supabase.from('configuracion_web').select('*').eq('id', 1).single()
      if (error) throw error
      setConfig(data)
      setPreviewImg(data.poster_imagen_url)
    } catch (e) {
      console.error(e)
      setConfig({
        poster_imagen_url: '',
        poster_badge: 'Oportunidad Exclusiva 0KM',
        poster_titulo: 'Subite a tu moto 0km hoy con Casco y Patente 100% Bonificados',
        poster_subtitulo: 'Válido en nuestro Showroom de Santa Rosa 4227 para todas las marcas oficiales en stock físico.',
        poster_boton_texto: 'Aprovechar Promo por WhatsApp',
        poster_whatsapp_msg: 'Hola Motobox! Quiero aprovechar la promoción de Casco y Patente Bonificados que vi en la web.',
        poster_activo: true,
      })
    } finally {
      setLoading(false)
    }
  }

  async function fetchWebMotos() {
    try {
      const { data } = await supabase.from('inventario_motos').select('*').order('created_at', { ascending: false })
      setMotosWeb(data || [])
    } catch (e) {
      console.error(e)
    }
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      // Auto-compress to WebP & upload
      const res = await uploadOptimizedImage(file, supabase, 'posters')
      setConfig(prev => ({ ...prev, poster_imagen_url: res.url }))
      setPreviewImg(res.url)
      addToast(`⚡ Poster optimizado y subido con éxito (${res.provider === 'cloudinary' ? 'Cloudinary' : 'WebP'})`, 'success')
    } catch (e) {
      console.error(e)
      addToast(`Error al subir imagen: ${e.message}`, 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const { error } = await supabase.from('configuracion_web').upsert({
        id: 1,
        poster_imagen_url: config.poster_imagen_url,
        poster_badge: config.poster_badge,
        poster_titulo: config.poster_titulo,
        poster_subtitulo: config.poster_subtitulo,
        poster_boton_texto: config.poster_boton_texto,
        poster_whatsapp_msg: config.poster_whatsapp_msg,
        poster_activo: config.poster_activo,
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
      addToast('⚡ Configuración del poster guardada y sincronizada en vivo con la web', 'success')
    } catch (e) {
      console.error(e)
      addToast('Error al guardar configuración', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleMotoWeb(moto) {
    try {
      const next = !moto.visible_web
      const { error } = await supabase.from('inventario_motos').update({ visible_web: next }).eq('id', moto.id)
      if (error) throw error
      addToast(next ? `🌐 ${moto.marca} ${moto.modelo} publicada en la web` : `🔒 Ocultada de la web`, 'success')
      fetchWebMotos()
    } catch (e) {
      addToast('Error al actualizar visibilidad', 'error')
    }
  }

  async function toggleMotoDestacada(moto) {
    try {
      const next = !moto.destacada
      const { error } = await supabase.from('inventario_motos').update({ destacada: next, visible_web: true }).eq('id', moto.id)
      if (error) throw error
      addToast(next ? `⭐ ${moto.marca} ${moto.modelo} destacada en Portada` : 'Removida de portada', 'success')
      fetchWebMotos()
    } catch (e) {
      addToast('Error al actualizar', 'error')
    }
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>
  if (!config) return <div className="empty-state"><p>Error cargando configuración</p></div>

  const motosEnWeb = motosWeb.filter(m => m.visible_web)

  return (
    <div>
      {/* Tabs Navigation */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '1px solid var(--gray-200)', paddingBottom: 10 }}>
        <button
          className={`btn ${activeTab === 'poster' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setActiveTab('poster')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <ImageIcon size={15} /> 1. Poster Promocional del Home
        </button>
        <button
          className={`btn ${activeTab === 'catalogo' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setActiveTab('catalogo')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Globe size={15} /> 2. Motos en Catálogo Web ({motosEnWeb.length} activas)
        </button>
      </div>

      {/* TAB 1: POSTER PROMOCIONAL */}
      {activeTab === 'poster' && (
        <div className="grid-2">
          {/* Form */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={18} style={{ color: '#DC2626' }} />
                <h3 style={{ margin: 0 }}>Banner Publicitario del Home</h3>
              </div>
              <span className="badge" style={{ background: config.poster_activo ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)', color: config.poster_activo ? '#16A34A' : '#DC2626' }}>
                {config.poster_activo ? '🟢 Activo en Web' : '🔴 Desactivado'}
              </span>
            </div>

            <div className="card-body">
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 700 }}>Foto del Poster (Auto-Comprimida a WebP)</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                    <Upload size={14} /> {uploading ? 'Optimizando...' : 'Subir Imagen'}
                    <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} disabled={uploading} />
                  </label>
                  {config.poster_imagen_url && (
                    <span className="form-hint" style={{ margin: 0, color: '#16A34A', fontWeight: 600 }}>
                      ⚡ Imagen cargada
                    </span>
                  )}
                </div>
                {config.poster_imagen_url && (
                  <input
                    className="form-input"
                    value={config.poster_imagen_url}
                    onChange={e => { setConfig(prev => ({ ...prev, poster_imagen_url: e.target.value })); setPreviewImg(e.target.value) }}
                    placeholder="URL de la imagen"
                    style={{ marginTop: 8, fontSize: '0.75rem' }}
                  />
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Etiqueta Superior (Badge)</label>
                <input className="form-input" value={config.poster_badge} onChange={e => setConfig(prev => ({ ...prev, poster_badge: e.target.value }))} placeholder="Ej: Oportunidad Exclusiva 0KM" />
              </div>

              <div className="form-group">
                <label className="form-label">Título Principal de la Promo</label>
                <input className="form-input" value={config.poster_titulo} onChange={e => setConfig(prev => ({ ...prev, poster_titulo: e.target.value }))} placeholder="Ej: Subite a tu moto 0km hoy con Casco y Patente 100% Bonificados" />
              </div>

              <div className="form-group">
                <label className="form-label">Subtítulo / Condiciones</label>
                <textarea className="form-input" rows="2" value={config.poster_subtitulo} onChange={e => setConfig(prev => ({ ...prev, poster_subtitulo: e.target.value }))} placeholder="Descripción de la promo..." />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Texto del Botón</label>
                  <input className="form-input" value={config.poster_boton_texto} onChange={e => setConfig(prev => ({ ...prev, poster_boton_texto: e.target.value }))} />
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 24 }}>
                  <input type="checkbox" id="check-poster-activo" checked={config.poster_activo} onChange={e => setConfig(prev => ({ ...prev, poster_activo: e.target.checked }))} style={{ width: 18, height: 18, accentColor: '#DC2626' }} />
                  <label htmlFor="check-poster-activo" className="form-label" style={{ margin: 0, cursor: 'pointer', fontWeight: 600 }}>Mostrar Poster en la Web</label>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Mensaje que envía el cliente por WhatsApp al hacer clic</label>
                <textarea className="form-input" rows="2" value={config.poster_whatsapp_msg} onChange={e => setConfig(prev => ({ ...prev, poster_whatsapp_msg: e.target.value }))} />
              </div>

              <button className="btn btn-primary" onClick={handleSave} disabled={saving || uploading} style={{ width: '100%', marginTop: 8 }}>
                <Save size={16} /> {saving ? 'Guardando...' : 'Guardar y Publicar en la Web'}
              </button>
            </div>
          </div>

          {/* Live Preview */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Eye size={16} />
                <h3 style={{ margin: 0 }}>Vista Previa en Vivo</h3>
              </div>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <div style={{ position: 'relative', background: '#151516', borderRadius: '0 0 8px 8px', overflow: 'hidden', minHeight: 340 }}>
                {previewImg && (
                  <img src={previewImg} alt="Poster preview" style={{ width: '100%', height: 340, objectFit: 'cover', opacity: 0.55 }} onError={e => { e.target.style.display = 'none' }} />
                )}
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 24, textAlign: 'center' }}>
                  {config.poster_badge && (
                    <span style={{ background: 'rgba(220,38,38,0.9)', color: '#fff', padding: '4px 14px', borderRadius: 99, fontSize: '0.6875rem', fontWeight: 700, marginBottom: 12 }}>
                      {config.poster_badge}
                    </span>
                  )}
                  <h2 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 800, margin: '0 0 8px', lineHeight: 1.25 }}>
                    {config.poster_titulo || 'Título del poster'}
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.75rem', margin: '0 0 16px', maxWidth: 360, lineHeight: 1.4 }}>
                    {config.poster_subtitulo}
                  </p>
                  <span style={{ background: '#25D366', color: '#fff', padding: '9px 22px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {config.poster_boton_texto || 'Consultar por WhatsApp'}
                  </span>
                </div>
                {!config.poster_activo && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: '1rem', background: '#DC2626', padding: '6px 16px', borderRadius: 6 }}>
                      ⏸ BANNER OCULTO EN LA WEB
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GESTOR DE MOTOS EN CATÁLOGO WEB */}
      {activeTab === 'catalogo' && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0 }}>Motos Sincronizadas con la Web Pública</h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                Activá o desactivá motos con un solo clic. Los cambios se reflejan al instante en <strong>catalogo.html</strong> e <strong>index.html</strong>.
              </p>
            </div>
            <a href="/inventario" className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Ir a Gestión de Inventario
            </a>
          </div>

          <div className="card-body-flush">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Foto</th>
                  <th>Moto</th>
                  <th>Cilindrada</th>
                  <th>Precio</th>
                  <th>Categoría Web</th>
                  <th>Estado en Web</th>
                  <th>Portada (Home)</th>
                  <th>Acción Rápida</th>
                </tr>
              </thead>
              <tbody>
                {motosWeb.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state">
                        <p>No tenés motos registradas en el inventario.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  motosWeb.map(m => (
                    <tr key={m.id}>
                      <td style={{ width: 60 }}>
                        {m.imagen_url ? (
                          <img src={m.imagen_url} alt="" style={{ width: 44, height: 34, objectFit: 'cover', borderRadius: 4 }} />
                        ) : (
                          <div style={{ width: 44, height: 34, background: 'var(--gray-100)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-400)' }}>
                            <ImageIcon size={16} />
                          </div>
                        )}
                      </td>
                      <td className="table-cell-primary">
                        {m.marca} {m.modelo}
                        {m.anio && <span style={{ color: 'var(--gray-500)', fontSize: '0.75rem', marginLeft: 4 }}>({m.anio})</span>}
                      </td>
                      <td>{m.cilindrada ? `${m.cilindrada} cc` : '-'}</td>
                      <td className="table-cell-primary">{fmt$(m.precio)}</td>
                      <td>
                        <span className="badge" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563EB' }}>
                          {m.categoria || 'economica'}
                        </span>
                      </td>
                      <td>
                        <span className="badge" style={{ background: m.visible_web ? 'rgba(22,163,74,0.1)' : 'var(--gray-100)', color: m.visible_web ? '#16A34A' : 'var(--gray-500)', fontWeight: 700 }}>
                          {m.visible_web ? '🌐 Visible' : '🔒 Oculta'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleMotoDestacada(m)}
                          style={{ color: m.destacada ? '#CA8A04' : 'var(--gray-400)', padding: '2px 8px' }}
                          title="Destacar en portada del Home"
                        >
                          <Star size={15} fill={m.destacada ? '#CA8A04' : 'none'} />
                          {m.destacada ? ' Destacada' : ' Normal'}
                        </button>
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => toggleMotoWeb(m)}
                          style={{ fontSize: '0.75rem' }}
                        >
                          {m.visible_web ? 'Ocultar de Web' : 'Publicar en Web'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
