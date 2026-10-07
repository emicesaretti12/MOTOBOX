import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import {
  Ticket, Search, X, MessageCircle, CheckCircle2, XCircle, FileText, Upload,
  RefreshCw, ShieldCheck, Clock, Gift, BookOpen, ExternalLink, KeyRound, Undo2,
} from 'lucide-react'

// Sorteo activo (debe coincidir con SORTEO_CONFIG.id de la web)
const SORTEO_ID = '01'
const MANUAL_BUCKET = 'sorteo-manual'
const MANUAL_PATH = 'manual.pdf'
const COMPROBANTES_BUCKET = 'sorteo-comprobantes'
// Página de la web donde cada participante ve su número y si el pago ya figura como "Pagado".
const MIS_NUMEROS_URL = 'https://motobox-web.vercel.app/mis-numeros.html'
// Igual que SORTEO_CONFIG.manual de la web
const MANUAL_NOMBRE = 'Manual de Cuidado y Mantenimiento'
const MANUAL_PRECIO = 10000

// "comprobante" quedó de cuando el comprobante se subía en la web: ahora lo recibe el vendedor por WhatsApp.
const ESTADOS = {
  gratis: { label: 'Gratis', cls: 'badge-sorteo-gratis' },
  pendiente: { label: 'Esperando pago', cls: 'badge-sorteo-pendiente' },
  comprobante: { label: 'Comprobante a revisar', cls: 'badge-sorteo-comprobante' },
  verificado: { label: 'Pagado', cls: 'badge-sorteo-verificado' },
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

// Mensaje que el vendedor le manda a la persona según cómo va el pago.
function mensajeWhatsApp(p, manualUrl) {
  const nombre = (p.nombre_completo || '').split(' ')[0]
  const precio = money(p.monto || MANUAL_PRECIO)
  if (p.estado_pago === 'verificado') {
    return `Hola ${nombre}! Confirmamos tu pago del ${MANUAL_NOMBRE}. ` +
      `Tu número para el Sorteo N.º ${p.sorteo_id} de MOTOBOX es el ${pad(p.numero)}. ` +
      (manualUrl ? `Acá tenés tu manual en PDF: ${manualUrl} ` : '') +
      `En "Mis números" ya te figura como pagado: ${MIS_NUMEROS_URL} ¡Mucha suerte!`
  }
  if (p.compra_manual && p.estado_pago === 'rechazado') {
    return `Hola ${nombre}! No pudimos verificar el pago del ${MANUAL_NOMBRE} (${precio}). ` +
      `¿Nos reenviás el comprobante de la transferencia por acá? Tu número ${pad(p.numero)} sigue participando del sorteo.`
  }
  if (p.compra_manual) {
    // El vendedor completa el alias al final y espera el comprobante en este mismo chat.
    return `Hola ${nombre}! Recibimos tu inscripción al Sorteo N.º ${p.sorteo_id} de MOTOBOX: tu número es el ${pad(p.numero)}. ` +
      `Para pagar el ${MANUAL_NOMBRE} (${precio}) transferí al alias: `
  }
  return `Hola ${nombre}! Tu inscripción al Sorteo N.º ${p.sorteo_id} de MOTOBOX quedó confirmada. ` +
    `Tu número es el ${pad(p.numero)} y lo podés ver cuando quieras en ${MIS_NUMEROS_URL} ` +
    `Te avisamos por acá la fecha del sorteo. ¡Mucha suerte!`
}

function accionWhatsApp(p) {
  if (p.estado_pago === 'verificado') return 'Enviar número y manual'
  if (p.compra_manual && p.estado_pago === 'rechazado') return 'Pedir el comprobante'
  if (p.compra_manual) return 'Pasar el alias'
  return 'Enviar número'
}

// Clave fácil de dictar: sin 0/O ni 1/l/I.
function claveNueva() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  const r = new Uint32Array(8)
  crypto.getRandomValues(r)
  return Array.from(r, n => abc[n % abc.length]).join('')
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
    esperando: rows.filter(r => ['pendiente', 'comprobante'].includes(r.estado_pago)).length,
    rechazados: rows.filter(r => r.estado_pago === 'rechazado').length,
    recaudado: rows.filter(r => r.estado_pago === 'verificado').reduce((s, r) => s + (Number(r.monto) || 0), 0),
  }), [rows])
  // Sin la columna clave_hash la web no puede mostrar "Mis números" (falta la migración 005).
  const faltaCuentas = rows.length > 0 && !('clave_hash' in rows[0])

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
          <div className="stat-card-value">{stats.esperando}</div>
          <div className="stat-card-label">Esperando pago{stats.rechazados ? ' · ' + stats.rechazados + ' rechazados' : ''}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><BookOpen size={20} /></div></div>
          <div className="stat-card-value">{stats.verificados}</div>
          <div className="stat-card-label">Manuales pagados · {money(stats.recaudado)}</div>
        </div>
      </div>

      {faltaCuentas && (
        <div className="card sorteo-manual-card">
          <div className="card-body sorteo-warn-text">
            Falta activar «Mis números» en la web: en Supabase, abrí el SQL Editor, pegá <code>supabase/migrations/005_sorteo_cuentas.sql</code> y tocá Run.
          </div>
        </div>
      )}

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
                      <a className="btn-icon whatsapp" title={accionWhatsApp(r) + ' por WhatsApp'} target="_blank" rel="noopener"
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
  const [clave, setClave] = useState('')
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

  // El vendedor ya vio el comprobante en WhatsApp: queda "Pagado" y la persona lo ve en "Mis números".
  function marcarPagado() {
    run({
      estado_pago: 'verificado',
      compra_manual: true,
      monto: p.monto || MANUAL_PRECIO,
      verificado_at: new Date().toISOString(),
      verificado_por: profileId || null,
    }, 'Marcado como pagado')
  }

  async function crearClave() {
    const nueva = claveNueva()
    setBusy(true)
    const { error } = await supabase.rpc('sorteo_admin_nueva_clave', { p_id: p.id, p_clave: nueva })
    setBusy(false)
    if (error) {
      const falta = error.code === 'PGRST202' || /Could not find|does not exist/i.test(error.message)
      addToast(falta ? 'Falta aplicar la migración 005_sorteo_cuentas.sql en Supabase' : 'No se pudo crear la clave: ' + error.message, 'error')
      return
    }
    setClave(nueva)
    addToast('Clave nueva creada')
  }

  const nombre = (p.nombre_completo || '').split(' ')[0]
  const waHref = 'https://wa.me/' + waNumber(p.telefono) + '?text=' + encodeURIComponent(mensajeWhatsApp(p, manualUrl))
  const claveHref = 'https://wa.me/' + waNumber(p.telefono) + '?text=' + encodeURIComponent(
    `Hola ${nombre}! Tu clave nueva para ver tus números del sorteo es: ${clave} — Entrá en ${MIS_NUMEROS_URL} con tu DNI y esa clave.`)
  const esperandoPago = p.compra_manual && ['pendiente', 'comprobante', 'rechazado'].includes(p.estado_pago)
  const pagado = p.estado_pago === 'verificado'
  const faltaManual = pagado && !manualUrl

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
            <span className="table-cell-secondary">{p.compra_manual ? 'Compra del manual · ' + money(p.monto || MANUAL_PRECIO) : 'Participación gratis'}</span>
          </div>

          {esperandoPago && (
            <p className="sorteo-pasos">
              1. Pasale el alias por WhatsApp. 2. Revisá el comprobante en el chat (que el monto y la cuenta coincidan y que la transferencia figure acreditada).
              3. Tocá <strong>Marcar como pagado</strong>: en «Mis números» le aparece el pago confirmado y el manual para descargar.
            </p>
          )}

          <dl className="sorteo-data">
            <div><dt>DNI</dt><dd>{p.dni}</dd></div>
            <div><dt>Nacimiento</dt><dd>{p.fecha_nacimiento ? new Date(p.fecha_nacimiento + 'T12:00:00').toLocaleDateString('es-AR') : '-'} ({edad(p.fecha_nacimiento)} años)</dd></div>
            <div><dt>WhatsApp</dt><dd>{p.telefono} {p.telefono_verificado ? <span className="sorteo-ok-text">· verificado</span> : <span className="sorteo-warn-text">· sin verificar</span>}</dd></div>
            <div><dt>Código</dt><dd><strong className="sorteo-code">{p.codigo_verificacion}</strong> <span className="table-cell-secondary">(viene en el mensaje de WhatsApp de la persona)</span></dd></div>
            <div><dt>Correo</dt><dd>{p.email}</dd></div>
            <div><dt>Domicilio</dt><dd>{p.direccion}, {p.localidad}, {p.provincia} ({p.codigo_postal})</dd></div>
            <div><dt>Inscripción</dt><dd>{fecha(p.created_at)}</dd></div>
            {p.verificado_at && pagado && <div><dt>Pagado</dt><dd>{fecha(p.verificado_at)}</dd></div>}
            {p.whatsapp_enviado_at && <div><dt>WhatsApp enviado</dt><dd>{fecha(p.whatsapp_enviado_at)}</dd></div>}
            <div><dt>Mis números</dt><dd>{'clave_hash' in p ? (p.clave_hash ? 'Tiene clave' : 'Sin clave (se inscribió antes)') : '-'}</dd></div>
          </dl>

          {p.comprobante_path && (
            <div className="sorteo-comprobante">
              <strong>Comprobante subido en la web</strong>
              {!comprobanteUrl && <p className="table-cell-secondary">Cargando…</p>}
              {comprobanteUrl && (esPdf
                ? <a className="btn btn-secondary btn-sm" href={comprobanteUrl} target="_blank" rel="noopener"><FileText size={14} /> Abrir comprobante (PDF)</a>
                : <a href={comprobanteUrl} target="_blank" rel="noopener"><img src={comprobanteUrl} alt="Comprobante de pago" className="sorteo-comprobante-img" /></a>)}
            </div>
          )}

          {clave && (
            <div className="sorteo-clave">
              <span>Clave nueva: <strong className="sorteo-code">{clave}</strong></span>
              <a className="btn btn-whatsapp btn-sm" href={claveHref} target="_blank" rel="noopener"><MessageCircle size={14} /> Enviar clave</a>
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
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={crearClave}><KeyRound size={14} /> Clave nueva</button>
          {esperandoPago && p.estado_pago !== 'rechazado' && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run({ estado_pago: 'rechazado' }, 'Pago marcado como rechazado')}><XCircle size={14} /> Rechazar pago</button>
          )}
          {pagado && (
            <button className="btn btn-secondary btn-sm" disabled={busy}
              onClick={() => run({ estado_pago: p.compra_manual ? 'pendiente' : 'gratis', verificado_at: null, verificado_por: null }, 'Pago deshecho')}>
              <Undo2 size={14} /> Deshacer pago
            </button>
          )}
          {!pagado && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={marcarPagado}>
              <CheckCircle2 size={14} /> {p.compra_manual ? 'Marcar como pagado' : 'Compró el manual (pagado)'}
            </button>
          )}
          <a className="btn btn-whatsapp btn-sm" href={waHref} target="_blank" rel="noopener"
            onClick={() => onUpdate(p.id, { whatsapp_enviado_at: new Date().toISOString() })}>
            <MessageCircle size={14} /> {accionWhatsApp(p)}
          </a>
        </div>
      </div>
    </div>
  )
}
