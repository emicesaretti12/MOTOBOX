import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import {
  Ticket, Search, X, MessageCircle, CheckCircle2, XCircle, FileText, Upload,
  RefreshCw, ShieldCheck, Clock, Gift, BookOpen, ExternalLink,
} from 'lucide-react'

// Sorteo activo (debe coincidir con SORTEO_CONFIG.id de la web)
const SORTEO_ID = '01'
const MANUAL_BUCKET = 'sorteo-manual'
const MANUAL_PATH = 'manual.pdf'
const COMPROBANTES_BUCKET = 'sorteo-comprobantes'

const ESTADOS = {
  gratis: { label: 'Gratis', cls: 'badge-sorteo-gratis' },
  pendiente: { label: 'Pago pendiente', cls: 'badge-sorteo-pendiente' },
  comprobante: { label: 'Comprobante a revisar', cls: 'badge-sorteo-comprobante' },
  verificado: { label: 'Pago verificado', cls: 'badge-sorteo-verificado' },
  rechazado: { label: 'Pago rechazado', cls: 'badge-sorteo-rechazado' },
}

const pad = (n) => String(n).padStart(5, '0')
const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR')
const fecha = (iso) => iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
function edad(nac) {
  if (!nac) return '-'
  const d = new Date(nac + 'T12:00:00'), now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a
}
// Los teléfonos se guardan con 10 dígitos (área + número): para WhatsApp va 549 adelante.
const waNumber = (tel) => { const d = String(tel || '').replace(/\D/g, ''); return d.startsWith('54') ? d : '549' + d }

function mensajeWhatsApp(p, manualUrl) {
  const nombre = (p.nombre_completo || '').split(' ')[0]
  if (p.compra_manual && p.estado_pago === 'verificado') {
    return `Hola ${nombre}! Confirmamos tu pago del Manual de Cuidado y Mantenimiento. ` +
      `Tu número para el Sorteo N.º ${p.sorteo_id} de MOTOBOX es el ${pad(p.numero)}. ` +
      (manualUrl ? `Acá tenés tu manual en PDF: ${manualUrl} ` : '') +
      `Te avisamos por acá la fecha del sorteo. ¡Mucha suerte!`
  }
  return `Hola ${nombre}! Tu inscripción al Sorteo N.º ${p.sorteo_id} de MOTOBOX quedó confirmada. ` +
    `Tu número es el ${pad(p.numero)}. Te avisamos por acá la fecha del sorteo. ¡Mucha suerte!`
}

export default function SorteoPage() {
  const { profile } = useAuth()
  const { addToast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [missingTable, setMissingTable] = useState(false)
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState('todos')
  const [selected, setSelected] = useState(null)
  const [manual, setManual] = useState({ exists: false, url: '' })
  const [uploadingManual, setUploadingManual] = useState(false)
  const manualInput = useRef(null)

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('sorteo_participantes')
      .select('*')
      .eq('sorteo_id', SORTEO_ID)
      .order('created_at', { ascending: false })
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|Could not find/i.test(error.message)) setMissingTable(true)
      else addToast('No se pudieron cargar los inscriptos: ' + error.message, 'error')
    } else {
      setMissingTable(false)
      setRows(data || [])
    }
    setLoading(false)
  }, [addToast])

  const fetchManual = useCallback(async () => {
    const { data } = await supabase.storage.from(MANUAL_BUCKET).list('', { search: MANUAL_PATH })
    const exists = Array.isArray(data) && data.some(f => f.name === MANUAL_PATH)
    const { data: pub } = supabase.storage.from(MANUAL_BUCKET).getPublicUrl(MANUAL_PATH)
    setManual({ exists, url: exists ? pub.publicUrl : '' })
  }, [])

  useEffect(() => {
    fetchRows()
    fetchManual()
    // Nuevas inscripciones aparecen solas (si la tabla está publicada en Realtime).
    const channel = supabase
      .channel('crm-sorteo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sorteo_participantes' }, () => fetchRows())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchRows, fetchManual])

  const stats = useMemo(() => ({
    total: rows.length,
    gratis: rows.filter(r => !r.compra_manual).length,
    verificados: rows.filter(r => r.estado_pago === 'verificado').length,
    aRevisar: rows.filter(r => r.estado_pago === 'comprobante').length,
    pendientes: rows.filter(r => r.estado_pago === 'pendiente').length,
    recaudado: rows.filter(r => r.estado_pago === 'verificado').reduce((s, r) => s + (Number(r.monto) || 0), 0),
  }), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (estado !== 'todos' && r.estado_pago !== estado) return false
      if (!q) return true
      return [r.nombre_completo, r.dni, r.telefono, r.email, r.localidad, pad(r.numero)]
        .some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [rows, search, estado])

  async function update(id, changes, okMsg) {
    const { data, error } = await supabase.from('sorteo_participantes').update(changes).eq('id', id).select().single()
    if (error) { addToast('No se pudo guardar: ' + error.message, 'error'); return null }
    setRows(prev => prev.map(r => (r.id === id ? data : r)))
    setSelected(s => (s && s.id === id ? data : s))
    if (okMsg) addToast(okMsg)
    return data
  }

  async function uploadManual(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf') { addToast('El manual tiene que ser un PDF', 'error'); return }
    setUploadingManual(true)
    const { error } = await supabase.storage.from(MANUAL_BUCKET).upload(MANUAL_PATH, file, { upsert: true, contentType: 'application/pdf', cacheControl: '60' })
    setUploadingManual(false)
    if (error) { addToast('No se pudo subir el manual: ' + error.message, 'error'); return }
    addToast('Manual actualizado')
    fetchManual()
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  if (missingTable) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="empty-state">
            <Ticket size={32} />
            <p><strong>Falta preparar la base de datos del sorteo.</strong></p>
            <p>En Supabase, abrí el SQL Editor, pegá el archivo <code>supabase/migrations/004_sorteo.sql</code> de este repositorio y tocá Run. Después recargá esta página.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><Ticket size={20} /></div></div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Inscriptos</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><Gift size={20} /></div></div>
          <div className="stat-card-value">{stats.gratis}</div>
          <div className="stat-card-label">Participación gratis</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon yellow"><Clock size={20} /></div></div>
          <div className="stat-card-value">{stats.aRevisar}</div>
          <div className="stat-card-label">Comprobantes a revisar · {stats.pendientes} sin pagar</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><BookOpen size={20} /></div></div>
          <div className="stat-card-value">{stats.verificados}</div>
          <div className="stat-card-label">Manuales pagados · {money(stats.recaudado)}</div>
        </div>
      </div>

      <div className="card sorteo-manual-card">
        <div className="card-body sorteo-manual-row">
          <div className="sorteo-manual-info">
            <FileText size={20} />
            <div>
              <strong>Manual en PDF</strong>
              <span>{manual.exists ? 'Cargado. El link va en el mensaje de WhatsApp a quienes compraron.' : 'Todavía no hay manual cargado. Subilo para poder enviarlo por WhatsApp.'}</span>
            </div>
          </div>
          <div className="sorteo-manual-actions">
            {manual.exists && <a className="btn btn-ghost btn-sm" href={manual.url} target="_blank" rel="noopener"><ExternalLink size={14} /> Ver</a>}
            <input ref={manualInput} type="file" accept="application/pdf" hidden onChange={uploadManual} />
            <button className="btn btn-secondary btn-sm" disabled={uploadingManual} onClick={() => manualInput.current && manualInput.current.click()}>
              <Upload size={14} /> {uploadingManual ? 'Subiendo…' : manual.exists ? 'Reemplazar PDF' : 'Subir PDF'}
            </button>
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar por nombre, DNI, teléfono o número..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="filter-select" value={estado} onChange={e => setEstado(e.target.value)}>
          <option value="todos">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={fetchRows}><RefreshCw size={14} /> Actualizar</button>
        <span className="results-count">{filtered.length} de {rows.length}</span>
      </div>

      <div className="card">
        <div className="card-body-flush table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>N.º</th><th>Nombre</th><th>DNI</th><th>WhatsApp</th><th>Localidad</th><th>Participa</th><th>Estado</th><th>Inscripción</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9}><div className="empty-state"><p>{rows.length ? 'No hay inscriptos con ese filtro' : 'Todavía no hay inscriptos en el sorteo'}</p></div></td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="clickable" onClick={() => setSelected(r)}>
                  <td className="table-cell-primary sorteo-num">{pad(r.numero)}</td>
                  <td className="table-cell-primary">{r.nombre_completo}</td>
                  <td>{r.dni}</td>
                  <td>
                    <span className="sorteo-tel">{r.telefono}{r.telefono_verificado && <ShieldCheck size={14} className="sorteo-ok" aria-label="Verificado" />}</span>
                  </td>
                  <td>{r.localidad}</td>
                  <td>{r.compra_manual ? 'Compra del manual' : 'Gratis'}</td>
                  <td><span className={'badge ' + ESTADOS[r.estado_pago].cls}>{ESTADOS[r.estado_pago].label}</span></td>
                  <td className="table-cell-secondary">{fecha(r.created_at)}</td>
                  <td>
                    <div className="table-actions" onClick={e => e.stopPropagation()}>
                      <a className="btn-icon whatsapp" title="Enviar número por WhatsApp" target="_blank" rel="noopener"
                        href={'https://wa.me/' + waNumber(r.telefono) + '?text=' + encodeURIComponent(mensajeWhatsApp(r, manual.url))}
                        onClick={() => update(r.id, { whatsapp_enviado_at: new Date().toISOString() })}>
                        <MessageCircle size={16} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <ParticipanteModal
          p={selected}
          manualUrl={manual.url}
          profileId={profile?.id}
          onClose={() => setSelected(null)}
          onUpdate={update}
          addToast={addToast}
        />
      )}
    </div>
  )
}

function ParticipanteModal({ p, manualUrl, profileId, onClose, onUpdate, addToast }) {
  const [comprobanteUrl, setComprobanteUrl] = useState('')
  const [notas, setNotas] = useState(p.notas || '')
  const [busy, setBusy] = useState(false)
  const esPdf = /\.pdf$/i.test(p.comprobante_path || '')

  useEffect(() => {
    let alive = true
    setComprobanteUrl('')
    if (p.comprobante_path) {
      // Link temporal (10 minutos): los comprobantes son privados.
      supabase.storage.from(COMPROBANTES_BUCKET).createSignedUrl(p.comprobante_path, 600).then(({ data, error }) => {
        if (!alive) return
        if (error) addToast('No se pudo abrir el comprobante: ' + error.message, 'error')
        else setComprobanteUrl(data.signedUrl)
      })
    }
    return () => { alive = false }
  }, [p.comprobante_path, addToast])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(changes, msg) {
    setBusy(true)
    await onUpdate(p.id, changes, msg)
    setBusy(false)
  }

  const waHref = 'https://wa.me/' + waNumber(p.telefono) + '?text=' + encodeURIComponent(mensajeWhatsApp(p, manualUrl))
  const puedeVerificar = p.compra_manual && ['pendiente', 'comprobante', 'rechazado'].includes(p.estado_pago)
  const faltaManual = p.compra_manual && p.estado_pago === 'verificado' && !manualUrl

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sorteo-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="sorteo-modal-title">
        <div className="modal-header">
          <h3 id="sorteo-modal-title">N.º {pad(p.numero)} · {p.nombre_completo}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="sorteo-status-row">
            <span className={'badge ' + ESTADOS[p.estado_pago].cls}>{ESTADOS[p.estado_pago].label}</span>
            <span className="table-cell-secondary">{p.compra_manual ? 'Compra del manual · ' + money(p.monto) : 'Participación gratis'}</span>
          </div>

          <dl className="sorteo-data">
            <div><dt>DNI</dt><dd>{p.dni}</dd></div>
            <div><dt>Nacimiento</dt><dd>{p.fecha_nacimiento ? new Date(p.fecha_nacimiento + 'T12:00:00').toLocaleDateString('es-AR') : '-'} ({edad(p.fecha_nacimiento)} años)</dd></div>
            <div><dt>WhatsApp</dt><dd>{p.telefono} {p.telefono_verificado ? <span className="sorteo-ok-text">· verificado</span> : <span className="sorteo-warn-text">· sin verificar</span>}</dd></div>
            <div><dt>Código</dt><dd><strong className="sorteo-code">{p.codigo_verificacion}</strong> <span className="table-cell-secondary">(la persona lo manda por WhatsApp)</span></dd></div>
            <div><dt>Correo</dt><dd>{p.email}</dd></div>
            <div><dt>Domicilio</dt><dd>{p.direccion}, {p.localidad}, {p.provincia} ({p.codigo_postal})</dd></div>
            <div><dt>Inscripción</dt><dd>{fecha(p.created_at)}</dd></div>
            {p.verificado_at && <div><dt>Pago verificado</dt><dd>{fecha(p.verificado_at)}</dd></div>}
            {p.whatsapp_enviado_at && <div><dt>WhatsApp enviado</dt><dd>{fecha(p.whatsapp_enviado_at)}</dd></div>}
          </dl>

          {p.compra_manual && (
            <div className="sorteo-comprobante">
              <strong>Comprobante</strong>
              {!p.comprobante_path && <p className="table-cell-secondary">Todavía no lo subió.</p>}
              {p.comprobante_path && !comprobanteUrl && <p className="table-cell-secondary">Cargando…</p>}
              {comprobanteUrl && (esPdf
                ? <a className="btn btn-secondary btn-sm" href={comprobanteUrl} target="_blank" rel="noopener"><FileText size={14} /> Abrir comprobante (PDF)</a>
                : <a href={comprobanteUrl} target="_blank" rel="noopener"><img src={comprobanteUrl} alt="Comprobante de pago" className="sorteo-comprobante-img" /></a>)}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="sorteo-notas">Notas internas</label>
            <textarea id="sorteo-notas" value={notas} onChange={e => setNotas(e.target.value)} onBlur={() => notas !== (p.notas || '') && run({ notas }, 'Notas guardadas')} />
          </div>
          {faltaManual && <p className="sorteo-warn-text">Subí el manual en PDF arriba para que el mensaje incluya el link.</p>}
        </div>
        <div className="modal-footer sorteo-footer">
          {!p.telefono_verificado
            ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run({ telefono_verificado: true }, 'WhatsApp verificado')}><ShieldCheck size={14} /> Marcar WhatsApp verificado</button>
            : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run({ telefono_verificado: false }, 'Verificación quitada')}>Quitar verificación</button>}
          {puedeVerificar && p.estado_pago !== 'rechazado' && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run({ estado_pago: 'rechazado' }, 'Pago marcado como rechazado')}><XCircle size={14} /> Rechazar pago</button>
          )}
          {puedeVerificar && (
            <button className="btn btn-primary btn-sm" disabled={busy}
              onClick={() => run({ estado_pago: 'verificado', verificado_at: new Date().toISOString(), verificado_por: profileId || null }, 'Pago verificado')}>
              <CheckCircle2 size={14} /> Verificar pago
            </button>
          )}
          <a className="btn btn-whatsapp btn-sm" href={waHref} target="_blank" rel="noopener"
            onClick={() => onUpdate(p.id, { whatsapp_enviado_at: new Date().toISOString() })}>
            <MessageCircle size={14} /> {p.compra_manual && p.estado_pago === 'verificado' ? 'Enviar número y manual' : 'Enviar número'}
          </a>
        </div>
      </div>
    </div>
  )
}
