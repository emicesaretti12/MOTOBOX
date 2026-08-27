import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { Image, Save, Eye, Upload, ExternalLink } from 'lucide-react'

export default function WebSettingsPage() {
  const { addToast } = useToast()
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewImg, setPreviewImg] = useState(null)

  useEffect(() => {
    fetchConfig()

    const channel = supabase
      .channel('configuracion-web-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'configuracion_web' }, () => {
        fetchConfig()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
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
      // If table doesn't exist or no row, use defaults
      setConfig({
        poster_imagen_url: '',
        poster_badge: 'Oportunidad Exclusiva 0KM',
        poster_titulo: 'Subite a tu moto 0km hoy',
        poster_subtitulo: 'Válido en nuestro Showroom para todas las marcas.',
        poster_boton_texto: 'Aprovechar Promo por WhatsApp',
        poster_whatsapp_msg: 'Hola Motobox! Quiero aprovechar la promoción que vi en la web.',
        poster_activo: true,
      })
    } finally { setLoading(false) }
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { addToast('Solo se permiten imágenes', 'error'); return }
    if (file.size > 5 * 1024 * 1024) { addToast('Máximo 5MB', 'error'); return }

    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const fileName = `poster_${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('motobox-public').upload(`posters/${fileName}`, file, { upsert: true })
      if (upErr) throw upErr

      const { data: urlData } = supabase.storage.from('motobox-public').getPublicUrl(`posters/${fileName}`)
      const url = urlData.publicUrl
      setConfig(prev => ({ ...prev, poster_imagen_url: url }))
      setPreviewImg(url)
      addToast('Imagen subida', 'success')
    } catch (e) {
      console.error(e)
      addToast('Error al subir imagen. Verificá que el bucket "motobox-public" exista en Storage.', 'error')
    } finally { setUploading(false) }
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
      addToast('Configuración guardada', 'success')
    } catch (e) {
      console.error(e)
      addToast('Error al guardar', 'error')
    } finally { setSaving(false) }
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>
  if (!config) return <div className="empty-state"><p>Error cargando configuración</p></div>

  return (
    <div>
      <div className="grid-2">
        {/* Form */}
        <div className="card">
          <div className="card-header"><h3>🖼️ Poster Promocional</h3></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Imagen del Poster</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  <Upload size={14} /> {uploading ? 'Subiendo...' : 'Subir Imagen'}
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} disabled={uploading} />
                </label>
                {config.poster_imagen_url && <span className="form-hint" style={{ margin: 0 }}>✅ Imagen cargada</span>}
              </div>
              {config.poster_imagen_url && (
                <input className="form-input" value={config.poster_imagen_url} onChange={e => { setConfig(prev => ({ ...prev, poster_imagen_url: e.target.value })); setPreviewImg(e.target.value) }} placeholder="O pegá una URL de imagen directamente" style={{ marginTop: 8 }} />
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Badge (etiqueta superior)</label>
              <input className="form-input" value={config.poster_badge} onChange={e => setConfig(prev => ({ ...prev, poster_badge: e.target.value }))} placeholder="Ej: Oportunidad Exclusiva 0KM" />
            </div>

            <div className="form-group">
              <label className="form-label">Título Principal</label>
              <input className="form-input" value={config.poster_titulo} onChange={e => setConfig(prev => ({ ...prev, poster_titulo: e.target.value }))} placeholder="Ej: Subite a tu moto 0km hoy" />
            </div>

            <div className="form-group">
              <label className="form-label">Subtítulo</label>
              <textarea className="form-input" rows="2" value={config.poster_subtitulo} onChange={e => setConfig(prev => ({ ...prev, poster_subtitulo: e.target.value }))} placeholder="Descripción de la promo..." />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Texto del Botón</label>
                <input className="form-input" value={config.poster_boton_texto} onChange={e => setConfig(prev => ({ ...prev, poster_boton_texto: e.target.value }))} />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 24 }}>
                <input type="checkbox" checked={config.poster_activo} onChange={e => setConfig(prev => ({ ...prev, poster_activo: e.target.checked }))} style={{ width: 18, height: 18, accentColor: '#DC2626' }} />
                <label className="form-label" style={{ margin: 0 }}>Poster Activo</label>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Mensaje WhatsApp (al tocar el botón)</label>
              <textarea className="form-input" rows="2" value={config.poster_whatsapp_msg} onChange={e => setConfig(prev => ({ ...prev, poster_whatsapp_msg: e.target.value }))} />
            </div>

            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ width: '100%', marginTop: 8 }}>
              <Save size={16} /> {saving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="card">
          <div className="card-header"><h3><Eye size={16} /> Vista Previa</h3></div>
          <div className="card-body" style={{ padding: 0 }}>
            <div style={{ position: 'relative', background: '#151516', borderRadius: '0 0 8px 8px', overflow: 'hidden', minHeight: 300 }}>
              {previewImg && (
                <img src={previewImg} alt="Poster preview" style={{ width: '100%', height: 300, objectFit: 'cover', opacity: 0.6 }} onError={e => { e.target.style.display = 'none' }} />
              )}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 24, textAlign: 'center' }}>
                {config.poster_badge && (
                  <span style={{ background: 'rgba(220,38,38,0.9)', color: '#fff', padding: '4px 14px', borderRadius: 99, fontSize: '0.6875rem', fontWeight: 700, marginBottom: 12 }}>{config.poster_badge}</span>
                )}
                <h2 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 800, margin: '0 0 8px', lineHeight: 1.2 }}>{config.poster_titulo || 'Título del poster'}</h2>
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.75rem', margin: '0 0 16px', maxWidth: 340 }}>{config.poster_subtitulo}</p>
                <span style={{ background: '#25D366', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 700 }}>{config.poster_boton_texto || 'Botón'}</span>
              </div>
              {!config.poster_activo && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '1rem' }}>⏸ POSTER DESACTIVADO</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
