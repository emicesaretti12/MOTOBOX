import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import {
  loadIntegrationConfig, saveIntegrationConfig, clearConfigCache, testDestination,
  getDeliveryLog, clearDeliveryLog, CRM_EVENT_LABELS, DEFAULT_CONFIG,
} from '../lib/integrations'
import {
  downloadCSV, downloadJSON, downloadVCards, downloadICS, copyAsSheet,
  buildWebFormSnippet, stamp,
} from '../lib/exporters'
import {
  Plug, Webhook, Send, MessageSquare, MessageCircle, Calendar, Download, Code,
  Save, Plus, Trash2, Zap, CheckCircle, AlertTriangle, Copy, FileSpreadsheet,
  Contact, FileJson, RefreshCw, Database, HardDrive, Hash,
} from 'lucide-react'

const EVENTOS = Object.keys(CRM_EVENT_LABELS)

const PROVEEDORES = [
  { valor: 'zapier', nombre: 'Zapier', ayuda: 'Creá un Zap con disparador "Webhooks by Zapier → Catch Hook" y pegá acá la URL.' },
  { valor: 'make', nombre: 'Make (Integromat)', ayuda: 'Agregá un módulo "Webhooks → Custom webhook" y copiá la dirección que te da.' },
  { valor: 'n8n', nombre: 'n8n', ayuda: 'Usá un nodo "Webhook" en modo POST y pegá la Production URL.' },
  { valor: 'sheets', nombre: 'Google Sheets (vía Zapier/Make)', ayuda: 'Conectá el webhook a una acción "Add row" de Google Sheets.' },
  { valor: 'custom', nombre: 'Otro servicio (HTTP POST)', ayuda: 'Cualquier endpoint que acepte un POST con cuerpo JSON.' },
]

const SECCIONES = [
  { id: 'webhooks', nombre: 'Webhooks', icon: Webhook },
  { id: 'mensajeria', nombre: 'Mensajería', icon: Send },
  { id: 'whatsapp', nombre: 'WhatsApp', icon: MessageCircle },
  { id: 'calendario', nombre: 'Calendario', icon: Calendar },
  { id: 'datos', nombre: 'Exportar datos', icon: Download },
  { id: 'web', nombre: 'Captación web', icon: Code },
  { id: 'registro', nombre: 'Registro de envíos', icon: Hash },
]

function nuevoId() {
  return 'wh_' + Math.random().toString(36).slice(2, 10)
}

export default function IntegrationsPage() {
  const { addToast } = useToast()
  const { profile } = useAuth()
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [origen, setOrigen] = useState('local')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seccion, setSeccion] = useState('webhooks')
  const [probando, setProbando] = useState(null)
  const [log, setLog] = useState([])
  const [leads, setLeads] = useState([])
  const [ventas, setVentas] = useState([])
  const [motos, setMotos] = useState([])

  const cargar = useCallback(async () => {
    try {
      const { config: cfg, origen: src } = await loadIntegrationConfig({ force: true })
      setConfig(cfg)
      setOrigen(src)
    } catch {
      // Si la lectura falla seguimos con los valores por defecto en local.
      setOrigen('local')
    } finally {
      setLog(getDeliveryLog())
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    const refrescarLog = () => setLog(getDeliveryLog())
    window.addEventListener('crm-integration-log', refrescarLog)
    return () => window.removeEventListener('crm-integration-log', refrescarLog)
  }, [cargar])

  // Datos para exportar (sólo lectura)
  useEffect(() => {
    async function fetchDatos() {
      try {
        const [lr, vr, mr] = await Promise.all([
          supabase.from('leads').select('*, vendedor:profiles!vendedor_asignado(full_name)').order('created_at', { ascending: false }),
          supabase.from('ventas').select('*, lead:leads!lead_id(nombre), moto:inventario_motos!moto_id(marca, modelo), vendedor:profiles!vendedor_id(full_name)'),
          supabase.from('inventario_motos').select('*'),
        ])
        setLeads(lr?.data || [])
        setVentas(vr?.data || [])
        setMotos(mr?.data || [])
      } catch {
        /* exportaciones se deshabilitan solas si no hay datos */
      }
    }
    fetchDatos()
  }, [])

  function actualizar(parche) {
    setConfig(prev => ({ ...prev, ...parche }))
  }

  async function guardar() {
    setSaving(true)
    const { origen: destino, error } = await saveIntegrationConfig(config)
    setOrigen(destino)
    clearConfigCache()
    setSaving(false)
    if (destino === 'supabase') {
      addToast('Integraciones guardadas y compartidas con todo el equipo', 'success')
    } else {
      addToast(
        'Guardado en este navegador. Para compartirlo con el equipo aplicá la migración 004 (opcional).',
        'success'
      )
      if (error) console.warn('crm_integraciones no disponible:', error.message)
    }
  }

  /* ---------------- Webhooks ---------------- */

  function agregarWebhook() {
    actualizar({
      webhooks: [
        ...config.webhooks,
        { id: nuevoId(), nombre: 'Nueva conexión', url: '', proveedor: 'zapier', eventos: ['lead.created'], activo: true },
      ],
    })
  }

  function editarWebhook(id, parche) {
    actualizar({ webhooks: config.webhooks.map(w => (w.id === id ? { ...w, ...parche } : w)) })
  }

  function borrarWebhook(id) {
    if (!window.confirm('¿Eliminar esta conexión? No afecta tus leads ni la base de datos.')) return
    actualizar({ webhooks: config.webhooks.filter(w => w.id !== id) })
  }

  function alternarEvento(webhookId, evento) {
    const hook = config.webhooks.find(w => w.id === webhookId)
    if (!hook) return
    const actuales = hook.eventos || []
    editarWebhook(webhookId, {
      eventos: actuales.includes(evento) ? actuales.filter(e => e !== evento) : [...actuales, evento],
    })
  }

  async function probar(tipo, destino, clave) {
    setProbando(clave)
    const resultado = await testDestination(tipo, destino)
    setProbando(null)
    setLog(getDeliveryLog())
    addToast(resultado.detalle, resultado.ok ? 'success' : 'error')
  }

  /* ---------------- Plantillas WhatsApp ---------------- */

  function editarPlantilla(id, parche) {
    actualizar({
      whatsapp: {
        ...config.whatsapp,
        plantillas: config.whatsapp.plantillas.map(p => (p.id === id ? { ...p, ...parche } : p)),
      },
    })
  }

  function agregarPlantilla() {
    actualizar({
      whatsapp: {
        ...config.whatsapp,
        plantillas: [
          ...config.whatsapp.plantillas,
          { id: 'tpl_' + Math.random().toString(36).slice(2, 8), nombre: 'Nueva plantilla', texto: 'Hola {nombre}, ' },
        ],
      },
    })
  }

  function borrarPlantilla(id) {
    actualizar({
      whatsapp: { ...config.whatsapp, plantillas: config.whatsapp.plantillas.filter(p => p.id !== id) },
    })
  }

  /* ---------------- Exportaciones ---------------- */

  const citas = useMemo(
    () =>
      leads
        .filter(l => l.fecha_agenda)
        .map(l => ({ ...l, vendedor: l.vendedor?.full_name })),
    [leads]
  )

  const LEAD_HEADERS = ['Nombre', 'Teléfono', 'Email', 'Modelo', 'Origen', 'Estado', 'Presupuesto', 'Vendedor', 'Cita', 'Creado', 'Notas']
  const leadRows = useMemo(
    () =>
      leads.map(l => [
        l.nombre, l.telefono || '', l.email || '', l.modelo_interes || '', l.origen || '', l.estado || '',
        l.presupuesto_estimado || '', l.vendedor?.full_name || '',
        l.fecha_agenda ? new Date(l.fecha_agenda).toLocaleString('es-AR') : '',
        l.created_at ? new Date(l.created_at).toLocaleString('es-AR') : '',
        l.notas || '',
      ]),
    [leads]
  )

  function exportarLeadsCSV() {
    if (leadRows.length === 0) return addToast('No hay leads para exportar', 'error')
    downloadCSV(LEAD_HEADERS, leadRows, `leads_motobox_${stamp()}.csv`)
    addToast(`${leadRows.length} leads exportados`, 'success')
  }

  async function copiarParaSheets() {
    if (leadRows.length === 0) return addToast('No hay leads para copiar', 'error')
    const ok = await copyAsSheet(LEAD_HEADERS, leadRows)
    addToast(ok ? 'Copiado: pegalo en Google Sheets con Ctrl+V' : 'El navegador bloqueó el portapapeles', ok ? 'success' : 'error')
  }

  function exportarVentasCSV() {
    if (ventas.length === 0) return addToast('No hay ventas registradas', 'error')
    downloadCSV(
      ['Fecha', 'Cliente', 'Moto', 'Vendedor', 'Precio', 'Método de pago', 'Notas'],
      ventas.map(v => [
        v.fecha_venta ? new Date(v.fecha_venta).toLocaleString('es-AR') : '',
        v.lead?.nombre || '', v.moto ? `${v.moto.marca} ${v.moto.modelo}` : '',
        v.vendedor?.full_name || '', v.precio_venta || '', v.metodo_pago || '', v.notas || '',
      ]),
      `ventas_motobox_${stamp()}.csv`
    )
    addToast(`${ventas.length} ventas exportadas`, 'success')
  }

  function exportarInventarioCSV() {
    if (motos.length === 0) return addToast('No hay motos en el inventario', 'error')
    downloadCSV(
      ['Marca', 'Modelo', 'Año', 'Precio', 'Estado', 'Visible en web', 'Destacada', 'Notas'],
      motos.map(m => [
        m.marca, m.modelo, m.anio || '', m.precio || '', m.estado || '',
        m.visible_web ? 'Sí' : 'No', m.destacada ? 'Sí' : 'No', m.notas || '',
      ]),
      `inventario_motobox_${stamp()}.csv`
    )
    addToast(`${motos.length} motos exportadas`, 'success')
  }

  function exportarContactos() {
    const contactos = leads.filter(l => l.telefono || l.email)
    if (contactos.length === 0) return addToast('No hay contactos con teléfono o email', 'error')
    downloadVCards(contactos)
    addToast(`${contactos.length} contactos listos para importar al celular`, 'success')
  }

  function exportarAgenda() {
    if (citas.length === 0) return addToast('No hay citas agendadas', 'error')
    downloadICS(citas, config.calendario.duracionCitaMin || 45)
    addToast(`${citas.length} citas exportadas — abrí el archivo en Google Calendar`, 'success')
  }

  function exportarBackup() {
    downloadJSON(
      { generado: new Date().toISOString(), por: profile?.full_name || '', leads, ventas, motos },
      `backup_motobox_${stamp()}.json`
    )
    addToast('Copia de seguridad descargada (sólo lectura)', 'success')
  }

  const snippet = useMemo(
    () =>
      buildWebFormSnippet({
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        origen: config.captacion?.origenPorDefecto || 'otro',
      }),
    [config.captacion]
  )

  async function copiarSnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      addToast('Código copiado — pegalo en tu web', 'success')
    } catch {
      addToast('No se pudo copiar automáticamente, seleccioná el texto', 'error')
    }
  }

  const conexionesActivas = useMemo(() => {
    let n = config.webhooks.filter(w => w.activo && w.url).length
    if (config.telegram.activo && config.telegram.botToken) n++
    if (config.slack.activo && config.slack.webhookUrl) n++
    if (config.discord.activo && config.discord.webhookUrl) n++
    return n
  }, [config])

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      {/* Resumen */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><Plug size={20} /></div></div>
          <div className="stat-card-value">{conexionesActivas}</div>
          <div className="stat-card-label">Conexiones activas</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon purple"><Zap size={20} /></div></div>
          <div className="stat-card-value">{config.webhooks.length}</div>
          <div className="stat-card-label">Webhooks configurados</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><MessageCircle size={20} /></div></div>
          <div className="stat-card-value">{config.whatsapp.plantillas.length}</div>
          <div className="stat-card-label">Plantillas de WhatsApp</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header">
            <div className={`stat-card-icon ${origen === 'supabase' ? 'green' : 'yellow'}`}>
              {origen === 'supabase' ? <Database size={20} /> : <HardDrive size={20} />}
            </div>
          </div>
          <div className="stat-card-value" style={{ fontSize: '1.1rem' }}>
            {origen === 'supabase' ? 'Compartida' : 'Local'}
          </div>
          <div className="stat-card-label">
            {origen === 'supabase' ? 'Sincronizada con el equipo' : 'Sólo en este navegador'}
          </div>
        </div>
      </div>

      {origen !== 'supabase' && (
        <div className="alert-card alert-info" style={{ marginBottom: 20 }}>
          <div className="alert-header">
            <AlertTriangle size={16} />
            <strong>La configuración se guarda en este navegador</strong>
          </div>
          <p className="text-muted" style={{ fontSize: '0.8125rem', margin: '6px 0 0', lineHeight: 1.5 }}>
            Para que todo el equipo comparta las mismas conexiones, ejecutá la migración opcional
            <code className="inline-code">supabase/migrations/004_integraciones.sql</code> en el editor SQL de Supabase.
            Es una migración aditiva: crea una única tabla nueva y <strong>no toca leads, ventas, inventario ni usuarios</strong>.
          </p>
        </div>
      )}

      {/* Navegación por secciones */}
      <div className="segmented-filters int-tabs">
        {SECCIONES.map(({ id, nombre, icon: Icon }) => (
          <button
            key={id}
            className={`segmented-filter-btn ${seccion === id ? 'active' : ''}`}
            onClick={() => setSeccion(id)}
          >
            <Icon size={14} /> {nombre}
          </button>
        ))}
      </div>

      {/* ---------------- WEBHOOKS ---------------- */}
      {seccion === 'webhooks' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Webhooks salientes</h3>
              <p className="text-muted int-subtitle">
                Cada vez que pasa algo en el CRM avisamos por HTTP POST. Conectá Zapier, Make, n8n o tu propio sistema
                y de ahí llegás a Google Sheets, Gmail, Notion, Trello, ERP, lo que uses.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={agregarWebhook}><Plus size={14} /> Nueva conexión</button>
          </div>
          <div className="card-body">
            {config.webhooks.length === 0 ? (
              <div className="empty-state"><p>Todavía no hay conexiones. Creá la primera para empezar a automatizar.</p></div>
            ) : (
              config.webhooks.map(hook => {
                const proveedor = PROVEEDORES.find(p => p.valor === hook.proveedor)
                return (
                  <div key={hook.id} className="int-block">
                    <div className="int-block-head">
                      <input
                        className="form-input int-title-input"
                        value={hook.nombre}
                        onChange={e => editarWebhook(hook.id, { nombre: e.target.value })}
                        placeholder="Nombre de la conexión"
                      />
                      <label className="int-switch">
                        <input type="checkbox" checked={!!hook.activo} onChange={e => editarWebhook(hook.id, { activo: e.target.checked })} />
                        <span>{hook.activo ? 'Activa' : 'Pausada'}</span>
                      </label>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => probar('webhook', hook, hook.id)}
                        disabled={probando === hook.id || !hook.url}
                      >
                        {probando === hook.id ? <RefreshCw size={14} className="spin" /> : <Zap size={14} />} Probar
                      </button>
                      <button className="btn-icon danger" onClick={() => borrarWebhook(hook.id)} title="Eliminar"><Trash2 size={16} /></button>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Herramienta</label>
                        <select
                          className="form-input"
                          value={hook.proveedor || 'custom'}
                          onChange={e => editarWebhook(hook.id, { proveedor: e.target.value })}
                        >
                          {PROVEEDORES.map(p => <option key={p.valor} value={p.valor}>{p.nombre}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">URL del webhook</label>
                        <input
                          className="form-input"
                          value={hook.url}
                          onChange={e => editarWebhook(hook.id, { url: e.target.value })}
                          placeholder="https://hooks.zapier.com/hooks/catch/..."
                        />
                      </div>
                    </div>
                    {proveedor && <div className="form-hint">{proveedor.ayuda}</div>}

                    <div className="form-group" style={{ marginTop: 12 }}>
                      <label className="form-label">Avisar cuando...</label>
                      <div className="int-chips">
                        {EVENTOS.map(ev => (
                          <button
                            key={ev}
                            type="button"
                            className={`int-chip ${(hook.eventos || []).includes(ev) ? 'active' : ''}`}
                            onClick={() => alternarEvento(hook.id, ev)}
                          >
                            {CRM_EVENT_LABELS[ev]}
                          </button>
                        ))}
                      </div>
                      <div className="form-hint">Sin ninguno seleccionado se envían todos los eventos.</div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* ---------------- MENSAJERÍA ---------------- */}
      {seccion === 'mensajeria' && (
        <div className="grid-2">
          {/* Telegram */}
          <div className="card">
            <div className="card-header"><h3><Send size={16} className="int-head-icon" /> Telegram</h3></div>
            <div className="card-body">
              <p className="text-muted int-subtitle">
                Recibí cada lead nuevo en tu celular al instante. Creá un bot con <strong>@BotFather</strong>,
                copiá el token y obtené tu Chat ID con <strong>@userinfobot</strong>.
              </p>
              <label className="int-switch int-switch-block">
                <input
                  type="checkbox"
                  checked={config.telegram.activo}
                  onChange={e => actualizar({ telegram: { ...config.telegram, activo: e.target.checked } })}
                />
                <span>Activar notificaciones por Telegram</span>
              </label>
              <div className="form-group">
                <label className="form-label">Token del bot</label>
                <input
                  className="form-input" type="password" autoComplete="off"
                  value={config.telegram.botToken}
                  onChange={e => actualizar({ telegram: { ...config.telegram, botToken: e.target.value.trim() } })}
                  placeholder="123456789:AA..."
                />
              </div>
              <div className="form-group">
                <label className="form-label">Chat ID</label>
                <input
                  className="form-input"
                  value={config.telegram.chatId}
                  onChange={e => actualizar({ telegram: { ...config.telegram, chatId: e.target.value.trim() } })}
                  placeholder="-1001234567890"
                />
              </div>
              <EventosSelector
                seleccion={config.telegram.eventos}
                onChange={eventos => actualizar({ telegram: { ...config.telegram, eventos } })}
              />
              <button
                className="btn btn-secondary btn-full"
                onClick={() => probar('telegram', config.telegram, 'telegram')}
                disabled={probando === 'telegram'}
              >
                {probando === 'telegram' ? <RefreshCw size={14} className="spin" /> : <Zap size={14} />} Enviar mensaje de prueba
              </button>
            </div>
          </div>

          {/* Slack + Discord */}
          <div className="card">
            <div className="card-header"><h3><MessageSquare size={16} className="int-head-icon" /> Slack y Discord</h3></div>
            <div className="card-body">
              <p className="text-muted int-subtitle">
                Avisos automáticos en el canal del equipo. Pegá la URL del Incoming Webhook.
              </p>

              <label className="int-switch int-switch-block">
                <input
                  type="checkbox"
                  checked={config.slack.activo}
                  onChange={e => actualizar({ slack: { ...config.slack, activo: e.target.checked } })}
                />
                <span>Activar Slack</span>
              </label>
              <div className="form-group">
                <label className="form-label">Incoming Webhook de Slack</label>
                <input
                  className="form-input"
                  value={config.slack.webhookUrl}
                  onChange={e => actualizar({ slack: { ...config.slack, webhookUrl: e.target.value.trim() } })}
                  placeholder="https://hooks.slack.com/services/..."
                />
              </div>
              <button
                className="btn btn-secondary btn-full"
                onClick={() => probar('slack', config.slack, 'slack')}
                disabled={probando === 'slack'}
                style={{ marginBottom: 20 }}
              >
                {probando === 'slack' ? <RefreshCw size={14} className="spin" /> : <Zap size={14} />} Probar Slack
              </button>

              <div className="int-divider" />

              <label className="int-switch int-switch-block">
                <input
                  type="checkbox"
                  checked={config.discord.activo}
                  onChange={e => actualizar({ discord: { ...config.discord, activo: e.target.checked } })}
                />
                <span>Activar Discord</span>
              </label>
              <div className="form-group">
                <label className="form-label">Webhook de Discord</label>
                <input
                  className="form-input"
                  value={config.discord.webhookUrl}
                  onChange={e => actualizar({ discord: { ...config.discord, webhookUrl: e.target.value.trim() } })}
                  placeholder="https://discord.com/api/webhooks/..."
                />
              </div>
              <button
                className="btn btn-secondary btn-full"
                onClick={() => probar('discord', config.discord, 'discord')}
                disabled={probando === 'discord'}
              >
                {probando === 'discord' ? <RefreshCw size={14} className="spin" /> : <Zap size={14} />} Probar Discord
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- WHATSAPP ---------------- */}
      {seccion === 'whatsapp' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3><MessageCircle size={16} className="int-head-icon" /> WhatsApp</h3>
              <p className="text-muted int-subtitle">
                Estas plantillas aparecen en la ficha de cada lead con un clic. Variables disponibles:
                <code className="inline-code">{'{nombre}'}</code>
                <code className="inline-code">{'{modelo}'}</code>
                <code className="inline-code">{'{vendedor}'}</code>
                <code className="inline-code">{'{presupuesto}'}</code>
                <code className="inline-code">{'{empresa}'}</code>
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={agregarPlantilla}><Plus size={14} /> Nueva plantilla</button>
          </div>
          <div className="card-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Número del negocio (opcional)</label>
                <input
                  className="form-input"
                  value={config.whatsapp.numeroNegocio}
                  onChange={e => actualizar({ whatsapp: { ...config.whatsapp, numeroNegocio: e.target.value } })}
                  placeholder="11 5555-5555"
                />
                <div className="form-hint">Se usa para generar el enlace público de contacto.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Prefijo de país</label>
                <input
                  className="form-input"
                  value={config.whatsapp.prefijoPais}
                  onChange={e => actualizar({ whatsapp: { ...config.whatsapp, prefijoPais: e.target.value.replace(/\D/g, '') || '54' } })}
                  placeholder="54"
                />
              </div>
            </div>

            <div className="int-divider" />

            {config.whatsapp.plantillas.map(p => (
              <div key={p.id} className="int-block">
                <div className="int-block-head">
                  <input
                    className="form-input int-title-input"
                    value={p.nombre}
                    onChange={e => editarPlantilla(p.id, { nombre: e.target.value })}
                    placeholder="Nombre de la plantilla"
                  />
                  <button className="btn-icon danger" onClick={() => borrarPlantilla(p.id)} title="Eliminar"><Trash2 size={16} /></button>
                </div>
                <textarea
                  className="form-input"
                  rows="3"
                  value={p.texto}
                  onChange={e => editarPlantilla(p.id, { texto: e.target.value })}
                  placeholder="Hola {nombre}, ..."
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- CALENDARIO ---------------- */}
      {seccion === 'calendario' && (
        <div className="card">
          <div className="card-header"><h3><Calendar size={16} className="int-head-icon" /> Calendario</h3></div>
          <div className="card-body">
            <p className="text-muted int-subtitle">
              Llevá las citas del CRM a Google Calendar, Outlook, Apple Calendar o el calendario del celular.
              En la Agenda y en cada lead vas a ver el botón "Agregar al calendario".
            </p>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Duración por defecto de una cita (minutos)</label>
                <input
                  className="form-input" type="number" min="10" max="480"
                  value={config.calendario.duracionCitaMin}
                  onChange={e => actualizar({ calendario: { ...config.calendario, duracionCitaMin: Number(e.target.value) || 45 } })}
                />
              </div>
              <div className="form-group int-form-action">
                <button className="btn btn-primary btn-full" onClick={exportarAgenda} disabled={citas.length === 0}>
                  <Calendar size={15} /> Descargar agenda (.ics) · {citas.length} citas
                </button>
              </div>
            </div>
            <div className="form-hint">
              El archivo .ics incluye un recordatorio 30 minutos antes de cada cita.
            </div>
          </div>
        </div>
      )}

      {/* ---------------- EXPORTAR DATOS ---------------- */}
      {seccion === 'datos' && (
        <div className="card">
          <div className="card-header">
            <h3><Download size={16} className="int-head-icon" /> Exportar e integrar datos</h3>
            <p className="text-muted int-subtitle">Todas las descargas son de sólo lectura: no modifican la base.</p>
          </div>
          <div className="card-body">
            <div className="int-export-grid">
              <ExportCard
                icon={FileSpreadsheet} titulo="Leads a Excel / CSV"
                detalle={`${leads.length} leads · separador ";" y acentos correctos`}
                onClick={exportarLeadsCSV} disabled={leads.length === 0}
              />
              <ExportCard
                icon={Copy} titulo="Copiar para Google Sheets"
                detalle="Copia la tabla al portapapeles lista para pegar"
                onClick={copiarParaSheets} disabled={leads.length === 0}
              />
              <ExportCard
                icon={FileSpreadsheet} titulo="Ventas a Excel / CSV"
                detalle={`${ventas.length} ventas registradas`}
                onClick={exportarVentasCSV} disabled={ventas.length === 0}
              />
              <ExportCard
                icon={FileSpreadsheet} titulo="Inventario a Excel / CSV"
                detalle={`${motos.length} motos en stock`}
                onClick={exportarInventarioCSV} disabled={motos.length === 0}
              />
              <ExportCard
                icon={Contact} titulo="Contactos para el celular (.vcf)"
                detalle="Importá todos los teléfonos de una sola vez"
                onClick={exportarContactos} disabled={leads.length === 0}
              />
              <ExportCard
                icon={Calendar} titulo="Agenda para el calendario (.ics)"
                detalle={`${citas.length} citas con recordatorio`}
                onClick={exportarAgenda} disabled={citas.length === 0}
              />
              <ExportCard
                icon={FileJson} titulo="Copia de seguridad (JSON)"
                detalle="Respaldo completo de leads, ventas e inventario"
                onClick={exportarBackup} disabled={leads.length === 0 && ventas.length === 0}
              />
            </div>
          </div>
        </div>
      )}

      {/* ---------------- CAPTACIÓN WEB ---------------- */}
      {seccion === 'web' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3><Code size={16} className="int-head-icon" /> Captación desde la web pública</h3>
              <p className="text-muted int-subtitle">
                Pegá este formulario en tu sitio y los leads entran directo al CRM, ya con origen asignado.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={copiarSnippet}><Copy size={14} /> Copiar código</button>
          </div>
          <div className="card-body">
            <div className="form-group" style={{ maxWidth: 280 }}>
              <label className="form-label">Origen que se asigna a estos leads</label>
              <select
                className="form-input"
                value={config.captacion.origenPorDefecto}
                onChange={e => actualizar({ captacion: { ...config.captacion, origenPorDefecto: e.target.value } })}
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="presencial">Presencial</option>
                <option value="referido">Referido</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <pre className="int-code">{snippet}</pre>
            <div className="form-hint">
              Usa la clave pública (anon) y respeta las políticas RLS que ya tenés configuradas: funciona
              sólo si tu base ya permite que la web cargue leads (como hace hoy tu sitio). Este código no
              cambia nada en la base de datos.
            </div>
          </div>
        </div>
      )}

      {/* ---------------- REGISTRO ---------------- */}
      {seccion === 'registro' && (
        <div className="card">
          <div className="card-header">
            <h3><Hash size={16} className="int-head-icon" /> Últimos envíos</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => { clearDeliveryLog(); setLog([]) }} disabled={log.length === 0}>
              <Trash2 size={14} /> Limpiar
            </button>
          </div>
          <div className="card-body-flush">
            {log.length === 0 ? (
              <div className="empty-state"><p>Sin envíos todavía. Probá una conexión para ver el resultado acá.</p></div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Cuándo</th><th>Destino</th><th>Evento</th><th>Resultado</th></tr></thead>
                <tbody>
                  {log.map((e, i) => (
                    <tr key={i}>
                      <td className="table-cell-secondary">{new Date(e.ts).toLocaleString('es-AR')}</td>
                      <td className="table-cell-primary">{e.destino}</td>
                      <td>{CRM_EVENT_LABELS[e.evento] || e.evento}</td>
                      <td>
                        <span className={`badge ${e.ok ? 'badge-venta_cerrada' : 'badge-perdido'}`}>
                          {e.ok ? <CheckCircle size={11} /> : <AlertTriangle size={11} />} {e.ok ? 'Enviado' : 'Falló'}
                          {e.detalle === 'no-cors' ? ' (sin confirmación)' : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Barra de guardado */}
      <div className="int-savebar">
        <span className="text-muted">
          {origen === 'supabase'
            ? 'Los cambios se comparten con todo el equipo.'
            : 'Los cambios quedan guardados en este navegador.'}
        </span>
        <button className="btn btn-primary" onClick={guardar} disabled={saving}>
          <Save size={16} /> {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  )
}

function EventosSelector({ seleccion = [], onChange }) {
  function alternar(ev) {
    onChange(seleccion.includes(ev) ? seleccion.filter(e => e !== ev) : [...seleccion, ev])
  }
  return (
    <div className="form-group">
      <label className="form-label">Avisar cuando...</label>
      <div className="int-chips">
        {EVENTOS.map(ev => (
          <button
            key={ev}
            type="button"
            className={`int-chip ${seleccion.includes(ev) ? 'active' : ''}`}
            onClick={() => alternar(ev)}
          >
            {CRM_EVENT_LABELS[ev]}
          </button>
        ))}
      </div>
      <div className="form-hint">Sin ninguno seleccionado se envían todos los eventos.</div>
    </div>
  )
}

function ExportCard({ icon: Icon, titulo, detalle, onClick, disabled }) {
  return (
    <button type="button" className="int-export-card" onClick={onClick} disabled={disabled}>
      <span className="int-export-icon"><Icon size={20} /></span>
      <span className="int-export-body">
        <span className="int-export-title">{titulo}</span>
        <span className="int-export-detail">{detalle}</span>
      </span>
    </button>
  )
}
