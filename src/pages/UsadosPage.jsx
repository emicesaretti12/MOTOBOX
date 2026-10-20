import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, Edit, Trash2, Globe, Star, Upload, Gauge, Image as ImageIcon, BadgeCheck, ExternalLink } from 'lucide-react'
import { uploadOptimizedImage } from '../lib/imageOptimizer'

// Usados exclusivos: tabla propia (usados_exclusivos), separada del inventario 0km.
// La web los muestra en usados.html. Solo un admin carga y edita; los vendedores los ven.
const WEB_URL = 'https://motobox-web.vercel.app/usados.html'
const ESTADOS = {
  disponible: { label: 'Disponible', badge: 'nuevo' },
  reservado: { label: 'Reservado', badge: 'en_negociacion' },
  vendido: { label: 'Vendido', badge: 'venta_cerrada' },
}
const EMPTY = {
  marca: '', modelo: '', anio: '', km: '', precio: '', cilindrada: '', color: '', duenos: '',
  frase: '', descripcion: '', papeles_al_dia: true, service_al_dia: false, acepta_permuta: false,
  financiacion: false, imagen_url: '', imagenes: [], estado: 'disponible', visible_web: true,
  destacada: false, notas: '',
}
const fmt$ = (v) => (v || v === 0) && v !== '' ? '$' + Number(v).toLocaleString('es-AR') : '-'
const fmtKm = (v) => (v || v === 0) && v !== '' ? Number(v).toLocaleString('es-AR') + ' km' : '-'

export default function UsadosPage() {
  const { isAdmin } = useAuth()
  const { addToast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [missingTable, setMissingTable] = useState(false)
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState('')
  const [modal, setModal] = useState(null)   // null | { item, form }
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState('')

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase.from('usados_exclusivos').select('*')
      .order('destacada', { ascending: false }).order('created_at', { ascending: false })
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|Could not find/i.test(error.message)) setMissingTable(true)
      else addToast('No se pudieron cargar los usados: ' + error.message, 'error')
    } else {
      setMissingTable(false)
      setRows(data || [])
    }
    setLoading(false)
  }, [addToast])

  useEffect(() => {
    fetchRows()
    const channel = supabase
      .channel('crm-usados')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usados_exclusivos' }, () => fetchRows())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (estado && r.estado !== estado) return false
      return !q || `${r.marca} ${r.modelo} ${r.color || ''} ${r.anio || ''}`.toLowerCase().includes(q)
    })
  }, [rows, search, estado])

  const stats = useMemo(() => ({
    total: rows.length,
    enWeb: rows.filter((r) => r.visible_web && r.estado !== 'vendido').length,
    reservados: rows.filter((r) => r.estado === 'reservado').length,
    vendidos: rows.filter((r) => r.estado === 'vendido').length,
  }), [rows])

  function openModal(item) {
    const imgs = item ? (item.imagenes?.length ? item.imagenes : (item.imagen_url ? [item.imagen_url] : [])) : []
    const form = item
      ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, item[k] == null ? EMPTY[k] : (typeof EMPTY[k] === 'string' ? String(item[k]) : item[k])]))
      : { ...EMPTY }
    form.imagenes = imgs
    form.imagen_url = item?.imagen_url || imgs[0] || ''
    setModal({ item, form })
  }
  const setField = (k, v) => setModal((m) => ({ ...m, form: { ...m.form, [k]: v } }))

  async function uploadPhotos(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const urls = []
    try {
      for (let i = 0; i < files.length; i++) {
        setUploading(`Optimizando foto ${i + 1} de ${files.length}…`)
        const res = await uploadOptimizedImage(files[i], supabase, 'usados')
        if (res?.url) urls.push(res.url)
      }
      setModal((m) => {
        const imagenes = [...m.form.imagenes, ...urls]
        return { ...m, form: { ...m.form, imagenes, imagen_url: m.form.imagen_url || imagenes[0] || '' } }
      })
      addToast(`${urls.length} foto${urls.length > 1 ? 's' : ''} agregada${urls.length > 1 ? 's' : ''}`)
    } catch (err) {
      addToast('No se pudieron subir las fotos: ' + err.message, 'error')
    } finally {
      setUploading('')
    }
  }
  function setCover(url) {
    setModal((m) => ({ ...m, form: { ...m.form, imagen_url: url, imagenes: [url, ...m.form.imagenes.filter((u) => u !== url)] } }))
  }
  function removePhoto(idx) {
    setModal((m) => {
      const imagenes = m.form.imagenes.filter((_, i) => i !== idx)
      const imagen_url = imagenes.includes(m.form.imagen_url) ? m.form.imagen_url : (imagenes[0] || '')
      return { ...m, form: { ...m.form, imagenes, imagen_url } }
    })
  }

  async function save(e) {
    e.preventDefault()
    const f = modal.form
    if (!f.marca.trim() || !f.modelo.trim()) { addToast('Marca y modelo son obligatorios', 'error'); return }
    if (!f.imagenes.length && f.visible_web) { addToast('Subí al menos una foto para publicarlo en la web', 'error'); return }
    const num = (v) => (v === '' || v == null ? null : Number(v))
    const txt = (v) => (v && String(v).trim()) || null
    const payload = {
      marca: f.marca.trim(), modelo: f.modelo.trim(),
      anio: num(f.anio), km: num(f.km), precio: num(f.precio), duenos: num(f.duenos),
      cilindrada: txt(f.cilindrada), color: txt(f.color), frase: txt(f.frase), descripcion: txt(f.descripcion), notas: txt(f.notas),
      papeles_al_dia: !!f.papeles_al_dia, service_al_dia: !!f.service_al_dia, acepta_permuta: !!f.acepta_permuta, financiacion: !!f.financiacion,
      imagenes: f.imagenes, imagen_url: f.imagenes.length ? (f.imagen_url || f.imagenes[0]) : null,
      estado: f.estado, visible_web: !!f.visible_web, destacada: !!f.destacada,
    }
    setSaving(true)
    const { error } = modal.item
      ? await supabase.from('usados_exclusivos').update(payload).eq('id', modal.item.id)
      : await supabase.from('usados_exclusivos').insert(payload)
    setSaving(false)
    if (error) {
      const msg = /check constraint/i.test(error.message) ? 'Revisá los datos: año, kilómetros, precio o dueños tienen un valor fuera de rango.' : error.message
      addToast('No se pudo guardar: ' + msg, 'error')
      return
    }
    addToast(modal.item ? 'Usado actualizado' : (payload.visible_web ? 'Usado publicado en la web' : 'Usado guardado (oculto en la web)'))
    setModal(null)
    fetchRows()
  }

  async function quickUpdate(item, changes, msg) {
    const { error } = await supabase.from('usados_exclusivos').update(changes).eq('id', item.id)
    if (error) { addToast('No se pudo guardar: ' + error.message, 'error'); return }
    addToast(msg)
    fetchRows()
  }

  async function remove(item) {
    if (!window.confirm(`¿Eliminar ${item.marca} ${item.modelo}? También deja de verse en la web.`)) return
    const { error } = await supabase.from('usados_exclusivos').delete().eq('id', item.id)
    if (error) { addToast('No se pudo eliminar: ' + error.message, 'error'); return }
    addToast('Usado eliminado')
    fetchRows()
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  if (missingTable) {
    return (
      <div className="card"><div className="card-body"><div className="empty-state">
        <Gauge size={32} />
        <p><strong>Falta preparar la base de datos de usados.</strong></p>
        <p>En Supabase, abrí el SQL Editor, pegá el archivo <code>supabase/migrations/014_usados_exclusivos.sql</code> de este repositorio y tocá Run. Después recargá esta página.</p>
      </div></div></div>
    )
  }

  const f = modal?.form

  return (
    <div>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon blue"><Gauge size={20} /></div></div>
          <div className="stat-card-value">{stats.total}</div><div className="stat-card-label">Usados cargados</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon green"><Globe size={20} /></div></div>
          <div className="stat-card-value">{stats.enWeb}</div><div className="stat-card-label">Publicados en la web</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon yellow"><Star size={20} /></div></div>
          <div className="stat-card-value">{stats.reservados}</div><div className="stat-card-label">Reservados</div></div>
        <div className="stat-card"><div className="stat-card-header"><div className="stat-card-icon red"><BadgeCheck size={20} /></div></div>
          <div className="stat-card-value">{stats.vendidos}</div><div className="stat-card-label">Vendidos</div></div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar por marca, modelo, color o año..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="filter-select" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <a className="btn btn-ghost btn-sm" href={WEB_URL} target="_blank" rel="noopener"><ExternalLink size={14} /> Ver en la web</a>
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => openModal(null)}><Plus size={16} /> Cargar usado</button>}
      </div>

      <div className="inventory-grid">
        {filtered.length === 0 ? (
          <div className="card" style={{ gridColumn: '1/-1' }}><div className="card-body"><div className="empty-state">
            <Gauge size={40} />
            <p><strong>{rows.length ? 'No hay usados con ese filtro' : 'Todavía no cargaste usados exclusivos'}</strong></p>
            {isAdmin && !rows.length && <button className="btn btn-primary btn-sm" onClick={() => openModal(null)}><Plus size={14} /> Cargar el primero</button>}
          </div></div></div>
        ) : filtered.map((r) => {
          const cover = r.imagen_url || r.imagenes?.[0]
          return (
            <div key={r.id} className="inventory-card usado-card">
              <div className="usado-card-media" onClick={() => isAdmin && openModal(r)}>
                {cover ? <img src={cover} alt={`${r.marca} ${r.modelo}`} loading="lazy" /> : <div className="usado-card-ph"><ImageIcon size={28} /></div>}
                <div className="usado-card-badges">
                  <span className={`badge badge-${ESTADOS[r.estado]?.badge}`}>{ESTADOS[r.estado]?.label}</span>
                  {r.visible_web && r.estado !== 'vendido'
                    ? <span className="badge usado-badge-web">En la web</span>
                    : <span className="badge usado-badge-off">Oculto</span>}
                  {r.destacada && <span className="badge usado-badge-star">Destacado</span>}
                </div>
                {r.imagenes?.length > 1 && <span className="usado-card-count">{r.imagenes.length} fotos</span>}
              </div>
              <div className="inventory-card-body">
                <div className="inventory-card-title">{r.marca} {r.modelo}</div>
                <div className="inventory-card-specs">
                  {r.anio && <span className="inventory-spec">{r.anio}</span>}
                  {(r.km || r.km === 0) && <span className="inventory-spec">{fmtKm(r.km)}</span>}
                  {r.cilindrada && <span className="inventory-spec">{r.cilindrada} cc</span>}
                  {r.duenos && <span className="inventory-spec">{r.duenos} dueño{r.duenos > 1 ? 's' : ''}</span>}
                </div>
                <div className="inventory-card-price usado-price">{fmt$(r.precio)}</div>
              </div>
              {isAdmin && (
                <div className="inventory-card-actions">
                  <button className="btn btn-ghost btn-sm" title={r.visible_web ? 'Ocultar de la web' : 'Publicar en la web'}
                    onClick={() => quickUpdate(r, { visible_web: !r.visible_web }, r.visible_web ? 'Oculto en la web' : 'Publicado en la web')}>
                    <Globe size={14} /> {r.visible_web ? 'Ocultar' : 'Publicar'}
                  </button>
                  <button className="btn btn-ghost btn-sm" title="Destacar primero en la web"
                    onClick={() => quickUpdate(r, { destacada: !r.destacada }, r.destacada ? 'Ya no está destacado' : 'Destacado: aparece primero')}>
                    <Star size={14} fill={r.destacada ? 'currentColor' : 'none'} />
                  </button>
                  <select className="filter-select usado-estado-select" value={r.estado} title="Estado"
                    onChange={(e) => quickUpdate(r, { estado: e.target.value }, 'Estado: ' + ESTADOS[e.target.value].label)}>
                    {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <button className="btn btn-ghost btn-sm" title="Editar" onClick={() => openModal(r)}><Edit size={14} /></button>
                  <button className="btn btn-ghost btn-sm usado-delete" title="Eliminar" onClick={() => remove(r)}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="usado-modal-title">
            <div className="modal-header">
              <h3 id="usado-modal-title">{modal.item ? `Editar ${modal.item.marca} ${modal.item.modelo}` : 'Cargar usado exclusivo'}</h3>
              <button className="modal-close" onClick={() => setModal(null)} aria-label="Cerrar"><X size={18} /></button>
            </div>
            <form onSubmit={save}>
              <div className="modal-body usado-form">
                <div className="multi-photo-uploader">
                  <label className="form-label"><ImageIcon size={16} /> Fotos ({f.imagenes.length}) — la primera es la portada</label>
                  {uploading && <p className="usado-uploading"><span className="spinner-sm" /> {uploading}</p>}
                  <div className="multi-photo-grid">
                    {f.imagenes.map((url, idx) => {
                      const isCover = f.imagen_url === url || (!f.imagen_url && idx === 0)
                      return (
                        <div key={url + idx} className={`photo-thumb-card ${isCover ? 'is-cover' : ''}`}>
                          {isCover && <span className="photo-thumb-cover-badge">Portada</span>}
                          <img src={url} alt="" />
                          <div className="photo-thumb-actions">
                            {!isCover && <button type="button" className="btn-thumb-action star" title="Usar como portada" onClick={() => setCover(url)}><Star size={14} /></button>}
                            <button type="button" className="btn-thumb-action danger" title="Quitar foto" onClick={() => removePhoto(idx)}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      )
                    })}
                    <label className="add-photo-dropzone">
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={uploadPhotos} disabled={!!uploading} hidden />
                      <Upload size={20} /><span>{uploading ? 'Subiendo…' : '+ Subir fotos'}</span>
                    </label>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group"><label className="form-label">Marca *</label><input className="form-input" required maxLength={60} value={f.marca} onChange={(e) => setField('marca', e.target.value)} placeholder="Honda, Yamaha, Bajaj…" /></div>
                  <div className="form-group"><label className="form-label">Modelo *</label><input className="form-input" required maxLength={80} value={f.modelo} onChange={(e) => setField('modelo', e.target.value)} placeholder="CB 190R, FZ 2.0…" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Año</label><input className="form-input" type="number" min="1970" max="2100" value={f.anio} onChange={(e) => setField('anio', e.target.value)} placeholder="2022" /></div>
                  <div className="form-group"><label className="form-label">Kilómetros</label><input className="form-input" type="number" min="0" max="999999" value={f.km} onChange={(e) => setField('km', e.target.value)} placeholder="8500" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Precio ($)</label><input className="form-input" type="number" min="0" value={f.precio} onChange={(e) => setField('precio', e.target.value)} placeholder="3900000" /></div>
                  <div className="form-group"><label className="form-label">Dueños anteriores</label><input className="form-input" type="number" min="1" max="9" value={f.duenos} onChange={(e) => setField('duenos', e.target.value)} placeholder="1" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Cilindrada (cc)</label><input className="form-input" maxLength={20} value={f.cilindrada} onChange={(e) => setField('cilindrada', e.target.value)} placeholder="190" /></div>
                  <div className="form-group"><label className="form-label">Color</label><input className="form-input" maxLength={40} value={f.color} onChange={(e) => setField('color', e.target.value)} placeholder="Negro mate" /></div>
                </div>
                <div className="form-group"><label className="form-label">Frase corta (se ve en la tarjeta)</label><input className="form-input" maxLength={140} value={f.frase} onChange={(e) => setField('frase', e.target.value)} placeholder="Única dueña, siempre en garage." /></div>
                <div className="form-group"><label className="form-label">Descripción</label><textarea className="form-input" rows="3" maxLength={1500} value={f.descripcion} onChange={(e) => setField('descripcion', e.target.value)} placeholder="Estado general, cubiertas, extras, último service…" /></div>

                <div className="usado-checks">
                  {[['papeles_al_dia', 'Papeles al día'], ['service_al_dia', 'Service al día'], ['acepta_permuta', 'Acepta permuta'], ['financiacion', 'Con financiación']].map(([k, label]) => (
                    <label key={k} className="usado-check"><input type="checkbox" checked={!!f[k]} onChange={(e) => setField(k, e.target.checked)} /> {label}</label>
                  ))}
                </div>

                <div className="usado-publish">
                  <div className="form-group"><label className="form-label">Estado</label>
                    <select className="form-input" value={f.estado} onChange={(e) => setField('estado', e.target.value)}>
                      {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <label className="usado-check"><input type="checkbox" checked={!!f.visible_web} onChange={(e) => setField('visible_web', e.target.checked)} /> Mostrar en la web</label>
                  <label className="usado-check"><input type="checkbox" checked={!!f.destacada} onChange={(e) => setField('destacada', e.target.checked)} /> Destacar (aparece primero)</label>
                  <p className="usado-hint">Los vendidos no se muestran en la web. Los reservados sí, con la etiqueta «Reservado».</p>
                </div>

                <div className="form-group"><label className="form-label">Notas internas (no se ven en la web)</label><textarea className="form-input" rows="2" value={f.notas} onChange={(e) => setField('notas', e.target.value)} placeholder="Precio de toma, a quién se le compró, detalles a reparar…" /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !!uploading}>{saving ? 'Guardando…' : (modal.item ? 'Guardar cambios' : 'Guardar usado')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
