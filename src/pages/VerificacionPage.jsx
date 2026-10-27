import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useCrmConfig } from '../hooks/useCrmConfig'
import { getWhatsAppLink } from '../lib/utils'
import {
  etiquetaRelacion, segundosDesde, formatEspera, parseMonto, formatMonto, mensajeMotivo,
  motivoDeErrorRpc, datosDeErrorFuncion, mensajeResultado, AVISO_LABELS, ESTADO_DNI_LABELS, ORIGEN_LABELS,
  BCRA_LABELS, detalleBcra,
} from '../lib/verificacion'
import { Copy, Check, X, RefreshCw, MessageCircle, Clock, ShieldCheck, BellOff } from 'lucide-react'

const REFRESCO_MS = 15000
const CONSULTA_CELULAR = '(max-width: 768px)'

function useEsCelular() {
  const [esCelular, setEsCelular] = useState(() => window.matchMedia(CONSULTA_CELULAR).matches)
  useEffect(() => {
    const mq = window.matchMedia(CONSULTA_CELULAR)
    const cambiar = () => setEsCelular(mq.matches)
    mq.addEventListener('change', cambiar)
    return () => mq.removeEventListener('change', cambiar)
  }, [])
  return esCelular
}

export default function VerificacionPage() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { addToast } = useToast()
  const config = useCrmConfig()
  const esCelular = useEsCelular()
  const [cola, setCola] = useState([])
  const [avisos, setAvisos] = useState([])
  const [resueltos, setResueltos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [errorCola, setErrorCola] = useState(null)
  const [ahora, setAhora] = useState(Date.now())
  const [abierto, setAbierto] = useState(null) // { leadId, accion: 'aprobado' | 'rechazado' }
  const [monto, setMonto] = useState('')
  const [montoError, setMontoError] = useState(null)
  const [ocupado, setOcupado] = useState(null)

  const cargar = useCallback(async () => {
    const [c, a, r] = await Promise.all([
      supabase.rpc('dni_cola_listar'),
      supabase.rpc('dni_avisos_pendientes'),
      supabase.rpc('dni_resueltos_hoy'),
    ])
    if (c.error) {
      setErrorCola(motivoDeErrorRpc(c.error) || 'ERROR')
    } else {
      setErrorCola(null)
      // El resultado del Banco Central vive en el lead: se suma a cada fila de la cola.
      const items = c.data || []
      const ids = items.map(i => i.lead_id)
      const { data: bcra } = ids.length
        ? await supabase.from('leads').select('id, bcra_resultado, bcra_situacion').in('id', ids)
        : { data: [] }
      const porId = Object.fromEntries((bcra || []).map(b => [b.id, b]))
      setCola(items.map(i => ({ ...i, ...(porId[i.lead_id] ? { bcra_resultado: porId[i.lead_id].bcra_resultado, bcra_situacion: porId[i.lead_id].bcra_situacion } : {}) })))
      setAvisos(a.error ? [] : a.data || [])
      // Si la función todavía no existe en la base, la sección simplemente no se muestra.
      setResueltos(r.error ? [] : r.data || [])
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
    const intervalo = setInterval(cargar, REFRESCO_MS)
    window.addEventListener('focus', cargar)
    return () => {
      clearInterval(intervalo)
      window.removeEventListener('focus', cargar)
    }
  }, [cargar])

  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(reloj)
  }, [])

  async function abrir(item, accion) {
    setMonto('')
    setMontoError(null)
    // Si tenía otra consulta abierta, la libera para que la pueda tomar otro operador.
    if (abierto && abierto.leadId !== item.lead_id) {
      await supabase.rpc('dni_soltar', { p_lead_id: abierto.leadId })
      setAbierto(null)
    }
    const { data, error } = await supabase.rpc('dni_tomar', { p_lead_id: item.lead_id, p_intento: item.intento })
    if (error || !data?.ok) {
      addToast(mensajeMotivo(error ? { motivo: motivoDeErrorRpc(error) } : data), 'error')
      cargar()
      return
    }
    setAbierto({ leadId: item.lead_id, accion })
  }

  async function cancelar(item) {
    setAbierto(null)
    await supabase.rpc('dni_soltar', { p_lead_id: item.lead_id })
    cargar()
  }

  async function confirmar(item) {
    const accion = abierto.accion
    let valor = null
    if (accion === 'aprobado') {
      const m = parseMonto(monto)
      if (!m.ok) { setMontoError(m.error); return }
      valor = m.valor
    }
    setOcupado(item.lead_id)
    try {
      const { data, error } = await supabase.functions.invoke('dni-resolver', {
        body: { accion: 'resolver', lead_id: item.lead_id, intento: item.intento, resultado: accion, monto: valor },
      })
      if (error) {
        addToast(mensajeMotivo(await datosDeErrorFuncion(error)), 'error')
      } else {
        const m = mensajeResultado(data.resultado, data.aviso)
        addToast(m.texto, m.tipo)
      }
    } finally {
      setOcupado(null)
      setAbierto(null)
      cargar()
    }
  }

  async function reintentar(aviso) {
    setOcupado(aviso.resolucion_id)
    try {
      const { data, error } = await supabase.functions.invoke('dni-resolver', {
        body: { accion: 'reintentar_aviso', resolucion_id: aviso.resolucion_id },
      })
      if (error) {
        addToast(mensajeMotivo(await datosDeErrorFuncion(error)), 'error')
      } else {
        const m = mensajeResultado(data.resultado, data.aviso)
        addToast(m.texto, m.tipo)
      }
    } finally {
      setOcupado(null)
      cargar()
    }
  }

  async function marcarAvisado(aviso) {
    if (!window.confirm(`¿Ya le avisaste a ${aviso.nombre} que su DNI fue ${aviso.resultado}?`)) return
    const { error } = await supabase.rpc('dni_marcar_avisado_manual', { p_resolucion_id: aviso.resolucion_id })
    if (error) addToast(mensajeMotivo({ motivo: motivoDeErrorRpc(error) }), 'error')
    else addToast('Marcado como avisado', 'success')
    cargar()
  }

  async function copiar(dni) {
    try {
      await navigator.clipboard.writeText(dni)
      addToast('DNI copiado', 'success')
    } catch {
      addToast('No se pudo copiar: seleccionalo a mano', 'error')
    }
  }

  if (!config || cargando) return <div className="spinner-overlay"><div className="spinner" /></div>

  if (errorCola) {
    const textos = {
      COLA_DESACTIVADA: 'La verificación de DNI desde el CRM está desactivada.',
      SIN_PERMISO: 'No tenés permiso para verificar DNIs. Pedíselo a un administrador.',
    }
    return (
      <div className="card">
        <div className="card-body">
          <div className="empty-state">
            <p>{textos[errorCola] || 'No se pudo cargar la cola. Probá de nuevo en unos segundos.'}</p>
            {!textos[errorCola] && <button className="btn btn-secondary btn-sm" onClick={cargar}><RefreshCw size={14} /> Reintentar</button>}
          </div>
        </div>
      </div>
    )
  }

  const alertaSeg = config.alertaEsperaMinutos * 60
  const demorados = cola.filter(i => segundosDesde(i.esperando_desde, ahora) >= alertaSeg).length

  function renderBcra(item) {
    if (!item.bcra_resultado) return <span className="aviso-detalle">-</span>
    return <span className={`badge badge-bcra-${item.bcra_resultado}`} title={detalleBcra(item)}>{BCRA_LABELS[item.bcra_resultado]}{item.bcra_situacion ? ` (sit. ${item.bcra_situacion})` : ''}</span>
  }

  function renderAcciones(item) {
    if (item.tomado_por_nombre && !item.tomado_por_mi) {
      return <span className="cola-revision">En revisión por {item.tomado_por_nombre}</span>
    }
    return (
      <div className="cola-acciones">
        <button className="btn btn-sm btn-aprobar" disabled={!!ocupado} onClick={() => abrir(item, 'aprobado')}><Check size={14} /> Aprobado</button>
        <button className="btn btn-sm btn-rechazar" disabled={!!ocupado} onClick={() => abrir(item, 'rechazado')}><X size={14} /> Rechazado</button>
      </div>
    )
  }

  function renderPanel(item) {
    const guardando = ocupado === item.lead_id
    if (abierto.accion === 'aprobado') {
      return (
        <div className="cola-panel-form">
          <strong>Aprobar DNI de {item.nombre}</strong>
          <input
            className="form-input"
            inputMode="numeric"
            placeholder="Monto aprobado (opcional)"
            value={monto}
            autoFocus
            onChange={e => { setMonto(e.target.value); setMontoError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') confirmar(item) }}
          />
          <button className="btn btn-sm btn-aprobar" disabled={guardando} onClick={() => confirmar(item)}>
            {guardando ? 'Guardando...' : 'Confirmar aprobado'}
          </button>
          <button className="btn btn-sm btn-ghost" disabled={guardando} onClick={() => cancelar(item)}>Cancelar</button>
          {montoError && <span className="cola-error">{montoError}</span>}
        </div>
      )
    }
    return (
      <div className="cola-panel-form">
        <strong>¿Confirmás que el DNI de {item.nombre} fue rechazado?</strong>
        <button className="btn btn-sm btn-rechazar" disabled={guardando} onClick={() => confirmar(item)}>
          {guardando ? 'Guardando...' : 'Sí, rechazado'}
        </button>
        <button className="btn btn-sm btn-ghost" disabled={guardando} onClick={() => cancelar(item)}>Cancelar</button>
      </div>
    )
  }

  return (
    <div>
      <div className="cola-resumen">
        <span className="cola-chip"><ShieldCheck size={14} /> {cola.length} {cola.length === 1 ? 'DNI pendiente' : 'DNIs pendientes'}</span>
        {demorados > 0 && (
          <span className="cola-chip alerta"><Clock size={14} /> {demorados} esperan más de {config.alertaEsperaMinutos} min</span>
        )}
        {!config.avisoSendpulseActivo && (
          <span className="cola-chip aviso"><BellOff size={14} /> Aviso automático apagado: avisale al cliente por WhatsApp</span>
        )}
        <span className="results-count">Se actualiza sola cada 15 s</span>
        <button className="btn btn-secondary btn-sm" onClick={cargar}><RefreshCw size={14} /> Actualizar</button>
      </div>

      {cola.length === 0 ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body"><div className="empty-state"><p>No hay DNIs para verificar 🎉</p></div></div>
        </div>
      ) : esCelular ? (
        <div className="cola-tarjetas">
          {cola.map(item => {
            const espera = segundosDesde(item.esperando_desde, ahora)
            const alerta = espera >= alertaSeg
            return (
              <div key={item.lead_id} className={`card cola-tarjeta ${alerta ? 'cola-alerta' : ''}`}>
                <div className="cola-tarjeta-fila">
                  <span className="table-cell-primary">{item.nombre}</span>
                  <span className={`cola-espera ${alerta ? 'alerta' : ''}`}><Clock size={13} /> {formatEspera(espera)}</span>
                </div>
                <div className="cola-tarjeta-fila">
                  <span className="cola-dni">
                    {item.dni}
                    <button className="btn-icon" title="Copiar DNI" onClick={() => copiar(item.dni)}><Copy size={14} /></button>
                  </span>
                  <span><span className="badge badge-empleado">{etiquetaRelacion(item.relacion)}</span> #{item.intento}</span>
                </div>
                <div className="cola-tarjeta-fila">{renderBcra(item)}</div>
                {item.telefono && <div className="aviso-detalle">{item.telefono}</div>}
                <div className="cola-tarjeta-acciones">
                  {abierto?.leadId === item.lead_id ? renderPanel(item) : renderAcciones(item)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body-flush cola-tabla-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Espera</th><th>Nombre</th><th>Teléfono</th><th>DNI</th><th>Banco Central</th><th>Relación</th><th>Intento</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cola.map(item => {
                  const espera = segundosDesde(item.esperando_desde, ahora)
                  const alerta = espera >= alertaSeg
                  const esteAbierto = abierto?.leadId === item.lead_id
                  return [
                    <tr key={item.lead_id} className={alerta ? 'cola-alerta' : ''}>
                      <td><span className={`cola-espera ${alerta ? 'alerta' : ''}`}><Clock size={13} /> {formatEspera(espera)}</span></td>
                      <td className="table-cell-primary">{item.nombre}</td>
                      <td>{item.telefono || '-'}</td>
                      <td>
                        <span className="cola-dni">
                          {item.dni}
                          <button className="btn-icon" title="Copiar DNI" onClick={() => copiar(item.dni)}><Copy size={14} /></button>
                        </span>
                      </td>
                      <td>{renderBcra(item)}</td>
                      <td><span className="badge badge-empleado">{etiquetaRelacion(item.relacion)}</span></td>
                      <td>#{item.intento}</td>
                      <td>{!esteAbierto && renderAcciones(item)}</td>
                    </tr>,
                    esteAbierto && (
                      <tr key={`${item.lead_id}-panel`} className="cola-panel">
                        <td colSpan={8}>{renderPanel(item)}</td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {avisos.length > 0 && (
        <div className="card">
          <div className="card-header"><h3>Sin avisar al cliente ({avisos.length})</h3></div>
          <div className="card-body avisos-lista">
            {avisos.map(a => {
              const wa = getWhatsAppLink(a.telefono)
              const reintentable = a.tiene_contacto && config.avisoSendpulseActivo && a.aviso_estado !== 'sin_contacto'
              return (
                <div key={a.resolucion_id} className={`aviso-item ${a.aviso_estado === 'fallido' ? 'fallido' : 'manual'}`}>
                  <div>
                    <div className="table-cell-primary">
                      {isAdmin ? <a href={`/leads/${a.lead_id}`} onClick={e => { e.preventDefault(); navigate(`/leads/${a.lead_id}`) }}>{a.nombre}</a> : a.nombre}
                      {' '}<span className={`badge badge-dni-${a.resultado}`}>{ESTADO_DNI_LABELS[a.resultado]}</span>
                      {a.monto_aprobado != null && <span className="aviso-monto"> {formatMonto(a.monto_aprobado)}</span>}
                    </div>
                    <div className="aviso-detalle">
                      {AVISO_LABELS[a.aviso_estado] || a.aviso_estado}
                      {a.aviso_error ? ` — ${a.aviso_error}` : ''}
                      {' · '}hace {formatEspera(segundosDesde(a.resuelto_at, ahora))}{a.operador_nombre ? ` por ${a.operador_nombre}` : ''}
                    </div>
                  </div>
                  <div className="cola-acciones">
                    {wa && <a className="btn btn-sm btn-secondary" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
                    {reintentable && (
                      <button className="btn btn-sm btn-primary" disabled={ocupado === a.resolucion_id} onClick={() => reintentar(a)}>
                        <RefreshCw size={14} /> {ocupado === a.resolucion_id ? 'Enviando...' : 'Reintentar aviso'}
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => marcarAvisado(a)}><Check size={14} /> Ya le avisé</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {resueltos.length > 0 && (
        <div className="card">
          <div className="card-header"><h3>Resueltos hoy ({resueltos.length})</h3></div>
          <div className="card-body avisos-lista">
            {resueltos.map(r => (
              <div key={r.resolucion_id} className="aviso-item">
                <div>
                  <div className="table-cell-primary">
                    {isAdmin ? <a href={`/leads/${r.lead_id}`} onClick={e => { e.preventDefault(); navigate(`/leads/${r.lead_id}`) }}>{r.nombre}</a> : r.nombre}
                    {' '}<span className={`badge badge-dni-${r.resultado}`}>{ESTADO_DNI_LABELS[r.resultado]}</span>
                    {r.monto_aprobado != null && <span className="aviso-monto"> {formatMonto(r.monto_aprobado)}</span>}
                  </div>
                  <div className="aviso-detalle">
                    {ORIGEN_LABELS[r.origen] || r.origen || 'Sin canal'} · intento #{r.intento}
                    {' · '}{AVISO_LABELS[r.aviso_estado] || r.aviso_estado}
                    {' · '}hace {formatEspera(segundosDesde(r.resuelto_at, ahora))}{r.operador_nombre ? ` por ${r.operador_nombre}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
