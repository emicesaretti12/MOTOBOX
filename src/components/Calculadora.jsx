import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Calculator, Copy, MessageCircle, Settings2, Plus, Trash2, Download, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { leerPrecio } from '../lib/venta'
import {
  CLAVE_CONFIG, CONFIG_INICIAL, normalizarConfig, cotizar, textoPresupuesto, planesCargados, motoParaLead, pesos, totalExtras,
} from '../lib/calculadora'
import './Calculadora.css'

const telefonoWa = (t) => {
  const d = String(t ?? '').replace(/\D/g, '')
  if (d.length < 8) return ''
  return d.startsWith('54') ? d : `54${d}`
}

export function useConfigCalculadora() {
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)
  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.from('crm_config').select('valor').eq('clave', CLAVE_CONFIG).maybeSingle()
    if (e) { setError('No se pudo cargar la configuración.'); setConfig(normalizarConfig(CONFIG_INICIAL)); return }
    setError(null)
    setConfig(normalizarConfig(data?.valor ?? CONFIG_INICIAL))
  }, [])
  useEffect(() => { cargar() }, [cargar])
  return { config, error, cargar, setConfig }
}

// Calculadora de precios y cuotas, como la de las concesionarias. Se usa en la compu y en el celular.
export default function Calculadora({ movil = false }) {
  const { profile, isAdmin } = useAuth()
  const { addToast } = useToast()
  const [params] = useSearchParams()
  const leadId = params.get('lead')
  const { config, error, setConfig } = useConfigCalculadora()
  const [lead, setLead] = useState(null)
  const [moto, setMoto] = useState('')
  const [precio, setPrecio] = useState('')
  const [anticipo, setAnticipo] = useState('')
  const [conExtras, setConExtras] = useState(false)
  const [elegidas, setElegidas] = useState(() => new Set())
  const [editando, setEditando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  // Si viene desde un lead, trae su nombre, teléfono y la moto que pidió.
  useEffect(() => {
    if (!leadId) return
    supabase.from('leads').select('id, nombre, telefono, modelo_interes').eq('id', leadId).maybeSingle()
      .then(({ data }) => { if (data) setLead(data) })
  }, [leadId])
  useEffect(() => {
    if (!config || !lead || moto) return
    const m = motoParaLead(config, lead.modelo_interes)
    if (m) elegirMoto(m.modelo)
  }, [config, lead]) // eslint-disable-line react-hooks/exhaustive-deps

  function elegirMoto(nombre) {
    setMoto(nombre)
    const m = config?.motos.find((x) => x.modelo === nombre)
    setPrecio(m?.precio ? m.precio.toLocaleString('es-AR') : '')
    setElegidas(new Set())
  }

  const cot = useMemo(() => (config ? cotizar(config, {
    precio: leerPrecio(precio), anticipo: leerPrecio(anticipo) ?? 0, conExtras,
  }) : null), [config, precio, anticipo, conExtras])

  const nombreMoto = moto || 'Moto 0 km'
  const texto = useMemo(() => textoPresupuesto({
    cot, modelo: nombreMoto, cliente: lead?.nombre, vendedor: profile?.full_name, validezDias: config?.validez_dias, elegidas,
  }), [cot, nombreMoto, lead, profile, config, elegidas])

  const alternar = (k) => setElegidas((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })

  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 1800) } catch { addToast('No se pudo copiar', 'error') }
  }
  const linkWa = `https://wa.me/${telefonoWa(lead?.telefono)}?text=${encodeURIComponent(texto)}`

  if (!config) return <div className="calc-cargando">Cargando calculadora…</div>
  if (editando) {
    return (
      <EditorConfig
        inicial={config}
        movil={movil}
        onCancelar={() => setEditando(false)}
        onGuardada={(c) => { setConfig(c); setEditando(false); addToast('Precios y planes guardados', 'success') }}
      />
    )
  }

  const hayPlanes = planesCargados(config)
  const extras = totalExtras(config)

  return (
    <div className={`calc ${movil ? 'calc-movil' : ''}`}>
      {error && <div className="calc-aviso rojo">{error}</div>}
      {!hayPlanes && (
        <div className="calc-aviso">
          {isAdmin
            ? <>Todavía no cargaste los recargos de las tarjetas ni del crédito. Por ahora solo calcula el contado. <button className="calc-link" onClick={() => setEditando(true)}>Cargar planes</button></>
            : 'Todavía no están cargados los recargos de las tarjetas ni del crédito. Por ahora solo calcula el contado: pedile al administrador que los cargue.'}
        </div>
      )}

      <div className="calc-grid">
        <section className="calc-panel calc-datos">
          {lead && (
            <div className="calc-lead">Cotizando para <strong>{lead.nombre || 'el cliente'}</strong>{lead.modelo_interes ? ` · pidió ${lead.modelo_interes}` : ''}</div>
          )}
          <label className="calc-campo">
            <span>Moto</span>
            <select value={moto} onChange={(e) => elegirMoto(e.target.value)}>
              <option value="">{config.motos.length ? 'Elegí una moto…' : 'Otra (precio a mano)'}</option>
              {config.motos.map((m) => <option key={m.modelo} value={m.modelo}>{m.modelo}{m.precio ? ` — ${pesos(m.precio)}` : ''}</option>)}
            </select>
          </label>
          <label className="calc-campo">
            <span>Precio de lista (contado)</span>
            <input inputMode="numeric" placeholder="Ej: 1.650.000" value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </label>
          <label className="calc-campo">
            <span>Entrega / anticipo</span>
            <input inputMode="numeric" placeholder="0" value={anticipo} onChange={(e) => setAnticipo(e.target.value)} />
          </label>
          {extras > 0 && (
            <label className="calc-check">
              <input type="checkbox" checked={conExtras} onChange={(e) => setConExtras(e.target.checked)} />
              Sumar patentamiento, formulario y flete ({pesos(extras)})
            </label>
          )}
          {cot && (
            <div className="calc-resumen">
              <div><span>Precio</span><strong>{pesos(cot.base)}</strong></div>
              {cot.anticipo > 0 && <div><span>Entrega</span><strong>− {pesos(cot.anticipo)}</strong></div>}
              <div className="total"><span>A financiar</span><strong>{pesos(cot.aFinanciar)}</strong></div>
            </div>
          )}
          {isAdmin && (
            <button className="calc-boton secundario" onClick={() => setEditando(true)}><Settings2 size={16} /> Precios y planes</button>
          )}
        </section>

        <section className="calc-panel calc-resultados">
          {!cot ? (
            <div className="calc-vacio"><Calculator size={40} strokeWidth={1.5} /><p>Elegí una moto o poné un precio para ver todas las formas de pago.</p></div>
          ) : (
            <>
              <p className="calc-ayuda">Tocá las opciones que querés mandarle. Si no tocás ninguna, va todo.</p>
              <div className="calc-bloque">
                <h3>💵 Contado{cot.contado.descuento_pct ? ` (${cot.contado.descuento_pct}% off)` : ''}</h3>
                <Opcion k="contado" elegidas={elegidas} onToggle={alternar} izq="Un pago" der={pesos(cot.contado.precio)} />
              </div>
              {cot.tarjetas.map((t) => (
                <div className="calc-bloque" key={t.id}>
                  <h3>💳 {t.nombre}</h3>
                  {t.opciones.map((o) => (
                    <Opcion key={o.cuotas} k={`${t.id}-${o.cuotas}`} elegidas={elegidas} onToggle={alternar}
                      izq={`${o.cuotas} cuotas`} der={pesos(o.cuota)} sub={`Total ${pesos(o.total)}${o.recargo_pct ? ` · +${o.recargo_pct}%` : ' · sin interés'}`} />
                  ))}
                </div>
              ))}
              {(cot.credito.opciones.length > 0 || cot.credito.falta_anticipo > 0) && (
                <div className="calc-bloque">
                  <h3>🪪 {cot.credito.nombre}</h3>
                  {cot.credito.falta_anticipo > 0 ? (
                    <p className="calc-nota">Necesita entregar al menos {pesos(cot.credito.anticipo_min)} (le faltan {pesos(cot.credito.falta_anticipo)}).</p>
                  ) : cot.credito.opciones.map((o) => (
                    <Opcion key={o.cuotas} k={`credito-${o.cuotas}`} elegidas={elegidas} onToggle={alternar}
                      izq={`${o.cuotas} cuotas`} der={pesos(o.cuota)} sub={`Total ${pesos(o.total)}`} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {cot && (
        <section className="calc-panel calc-presupuesto">
          <h3>Presupuesto para mandar</h3>
          <pre>{texto}</pre>
          <div className="calc-acciones">
            <button className="calc-boton secundario" onClick={copiar}>{copiado ? <Check size={16} /> : <Copy size={16} />} {copiado ? 'Copiado' : 'Copiar'}</button>
            <a className="calc-boton wa" href={linkWa} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> {movil ? 'WhatsApp' : telefonoWa(lead?.telefono) ? `Mandar a ${String(lead.nombre || '').split(' ')[0] || 'el cliente'}` : 'Mandar por WhatsApp'}</a>
          </div>
        </section>
      )}
    </div>
  )
}

function Opcion({ k, elegidas, onToggle, izq, der, sub }) {
  const activa = elegidas.has(k)
  return (
    <button type="button" className={`calc-opcion ${activa ? 'activa' : ''}`} onClick={() => onToggle(k)} aria-pressed={activa}>
      <span className="calc-opcion-izq">
        <span className="calc-tilde">{activa && <Check size={13} strokeWidth={3} />}</span>
        <span>{izq}{sub && <small>{sub}</small>}</span>
      </span>
      <strong>{der}</strong>
    </button>
  )
}

// ---------- Configuración (solo admin) ----------
const aTexto = (n) => (n == null ? '' : String(n))
const aNumero = (t) => { const v = parseFloat(String(t).replace(',', '.')); return Number.isFinite(v) ? v : null }

function EditorConfig({ inicial, onCancelar, onGuardada, movil }) {
  const { profile } = useAuth()
  const { addToast } = useToast()
  const [c, setC] = useState(() => structuredClone(inicial))
  const [guardando, setGuardando] = useState(false)
  const cambiar = (fn) => setC((prev) => { const n = structuredClone(prev); fn(n); return n })

  async function importarInventario() {
    const { data, error } = await supabase.from('inventario_motos').select('marca, modelo, precio').order('marca')
    if (error) { addToast('No se pudo leer el inventario', 'error'); return }
    cambiar((n) => {
      for (const r of data ?? []) {
        const modelo = `${r.marca ?? ''} ${r.modelo ?? ''}`.replace(/\s+/g, ' ').trim()
        if (!modelo || n.motos.some((m) => m.modelo.toLowerCase() === modelo.toLowerCase())) continue
        n.motos.push({ modelo, precio: Number(r.precio) || null })
      }
    })
  }

  async function guardar() {
    setGuardando(true)
    const valor = normalizarConfig({ ...c, actualizado_at: new Date().toISOString(), actualizado_por: profile?.full_name ?? null })
    const { error } = await supabase.from('crm_config')
      .upsert({ clave: CLAVE_CONFIG, valor, descripcion: 'Calculadora: precios de las motos y recargos de cada plan de pago' }, { onConflict: 'clave' })
    setGuardando(false)
    if (error) { addToast('No se pudo guardar. ¿Sos administrador?', 'error'); return }
    onGuardada(valor)
  }

  const filaOpcion = (lista, i, o) => (
    <div className="calc-fila" key={i}>
      <input className="corto" inputMode="numeric" value={aTexto(o.cuotas)} onChange={(e) => cambiar((n) => { lista(n)[i].cuotas = Math.round(aNumero(e.target.value) ?? 0) })} />
      <span>cuotas · recargo</span>
      <input className="corto" inputMode="decimal" placeholder="—" value={aTexto(o.recargo_pct)} onChange={(e) => cambiar((n) => { lista(n)[i].recargo_pct = aNumero(e.target.value) })} />
      <span>%</span>
      <button className="calc-icono" aria-label="Quitar" onClick={() => cambiar((n) => { lista(n).splice(i, 1) })}><Trash2 size={15} /></button>
    </div>
  )

  return (
    <div className={`calc calc-editor ${movil ? 'calc-movil' : ''}`}>
      <div className="calc-aviso">El recargo es el % total que se suma al monto a financiar (0 = sin interés). Si lo dejás vacío, esa opción no aparece.</div>

      <section className="calc-panel">
        <div className="calc-panel-cab">
          <h3>Motos y precios de contado</h3>
          <button className="calc-boton secundario chico" onClick={importarInventario}><Download size={14} /> Traer del inventario</button>
        </div>
        {c.motos.map((m, i) => (
          <div className="calc-fila" key={i}>
            <input value={m.modelo} placeholder="Modelo" onChange={(e) => cambiar((n) => { n.motos[i].modelo = e.target.value })} />
            <input className="medio" inputMode="numeric" placeholder="Precio" value={m.precio ? m.precio.toLocaleString('es-AR') : ''}
              onChange={(e) => cambiar((n) => { n.motos[i].precio = leerPrecio(e.target.value) })} />
            <button className="calc-icono" aria-label="Quitar" onClick={() => cambiar((n) => { n.motos.splice(i, 1) })}><Trash2 size={15} /></button>
          </div>
        ))}
        <button className="calc-link" onClick={() => cambiar((n) => { n.motos.push({ modelo: '', precio: null }) })}><Plus size={14} /> Agregar moto</button>
      </section>

      <section className="calc-panel">
        <h3>Contado</h3>
        <div className="calc-fila">
          <span>Descuento</span>
          <input className="corto" inputMode="decimal" value={aTexto(c.contado.descuento_pct)} onChange={(e) => cambiar((n) => { n.contado.descuento_pct = aNumero(e.target.value) ?? 0 })} />
          <span>%</span>
        </div>
      </section>

      {c.tarjetas.map((t, ti) => (
        <section className="calc-panel" key={t.id}>
          <div className="calc-panel-cab">
            <input className="calc-titulo-input" value={t.nombre} onChange={(e) => cambiar((n) => { n.tarjetas[ti].nombre = e.target.value })} />
            <button className="calc-icono" aria-label="Quitar tarjeta" onClick={() => cambiar((n) => { n.tarjetas.splice(ti, 1) })}><Trash2 size={15} /></button>
          </div>
          {t.opciones.map((o, i) => filaOpcion((n) => n.tarjetas[ti].opciones, i, o))}
          <button className="calc-link" onClick={() => cambiar((n) => { n.tarjetas[ti].opciones.push({ cuotas: 1, recargo_pct: null }) })}><Plus size={14} /> Agregar cuotas</button>
        </section>
      ))}
      <button className="calc-link" onClick={() => cambiar((n) => { n.tarjetas.push({ id: `tarjeta-${Date.now()}`, nombre: 'Otra tarjeta', opciones: [{ cuotas: 3, recargo_pct: null }] }) })}><Plus size={14} /> Agregar tarjeta</button>

      <section className="calc-panel">
        <div className="calc-panel-cab">
          <input className="calc-titulo-input" value={c.credito.nombre} onChange={(e) => cambiar((n) => { n.credito.nombre = e.target.value })} />
        </div>
        <div className="calc-fila">
          <span>Anticipo mínimo</span>
          <input className="corto" inputMode="decimal" value={aTexto(c.credito.anticipo_min_pct)} onChange={(e) => cambiar((n) => { n.credito.anticipo_min_pct = aNumero(e.target.value) ?? 0 })} />
          <span>% · gastos de otorgamiento</span>
          <input className="corto" inputMode="decimal" value={aTexto(c.credito.gastos_pct)} onChange={(e) => cambiar((n) => { n.credito.gastos_pct = aNumero(e.target.value) ?? 0 })} />
          <span>%</span>
        </div>
        {c.credito.opciones.map((o, i) => filaOpcion((n) => n.credito.opciones, i, o))}
        <button className="calc-link" onClick={() => cambiar((n) => { n.credito.opciones.push({ cuotas: 12, recargo_pct: null }) })}><Plus size={14} /> Agregar cuotas</button>
      </section>

      <section className="calc-panel">
        <h3>Gastos que se pueden sumar</h3>
        {[['patentamiento', 'Patentamiento'], ['formulario', 'Formulario'], ['flete', 'Flete / alistamiento']].map(([k, t]) => (
          <div className="calc-fila" key={k}>
            <span className="ancho">{t}</span>
            <input className="medio" inputMode="numeric" placeholder="0" value={c.extras[k] ? Number(c.extras[k]).toLocaleString('es-AR') : ''}
              onChange={(e) => cambiar((n) => { n.extras[k] = leerPrecio(e.target.value) ?? 0 })} />
          </div>
        ))}
        <div className="calc-fila">
          <span className="ancho">Validez del presupuesto</span>
          <input className="corto" inputMode="numeric" value={aTexto(c.validez_dias)} onChange={(e) => cambiar((n) => { n.validez_dias = Math.max(1, Math.round(aNumero(e.target.value) ?? 1)) })} />
          <span>días</span>
        </div>
      </section>

      <div className="calc-acciones fijas">
        <button className="calc-boton secundario" onClick={onCancelar} disabled={guardando}>Cancelar</button>
        <button className="calc-boton" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </div>
  )
}
