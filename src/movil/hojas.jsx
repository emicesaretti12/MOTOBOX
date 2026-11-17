import { useEffect, useMemo, useState } from 'react'
import { Check, PhoneOff, CalendarPlus, Clock, XCircle, BadgeCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { resultadoContacto, MOTIVOS_PERDIDO } from '../lib/hoy'
import { METODOS_PAGO, modeloSugerido, precioSugerido, metodoDesdeFormaPago, leerPrecio, formatoPesos } from '../lib/venta'
import { Hoja, Campo } from './ui'

const aLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const mananaALas10 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return aLocalInput(d) }

// "¿Cómo te fue?": guarda el resultado del contacto y el CRM decide cuándo vuelve a aparecer el lead.
export function HojaResultado({ lead, abierta, onCerrar, onGuardado }) {
  const { profile } = useAuth()
  const { addToast } = useToast()
  const [modo, setModo] = useState(null)
  const [fecha, setFecha] = useState(mananaALas10)
  const [motivo, setMotivo] = useState(MOTIVOS_PERDIDO[0])
  const [guardando, setGuardando] = useState(false)
  useEffect(() => { if (abierta) { setModo(null); setFecha(mananaALas10()) } }, [abierta])
  if (!lead) return null

  async function guardar(tipo, datos) {
    let cambios
    try { cambios = resultadoContacto(lead, tipo, datos, new Date(), profile?.full_name) } catch (e) { addToast(e.message, 'error'); return }
    if (!lead.vendedor_asignado) cambios.vendedor_asignado = profile.id
    setGuardando(true)
    const { error } = await supabase.from('leads').update(cambios).eq('id', lead.id)
    setGuardando(false)
    if (error) { addToast('No se pudo guardar. Probá de nuevo.', 'error'); return }
    addToast({ escribi: 'Anotado. Te lo recuerdo mañana.', no_contesta: 'Anotado. Vuelve en 2 días.', visita: 'Visita agendada.', posponer: 'Te lo recuerdo ese día.', perdido: 'Marcado como perdido.' }[tipo], 'success')
    onGuardado?.(cambios)
    onCerrar()
  }

  const opciones = [
    { tipo: 'escribi', texto: 'Le escribí', Icono: Check, color: '#34c759' },
    { tipo: 'no_contesta', texto: 'No contesta', Icono: PhoneOff, color: '#8e8e93' },
    { tipo: 'visita', texto: 'Agendó visita', Icono: CalendarPlus, color: '#007aff', pide: true },
    { tipo: 'posponer', texto: 'Más adelante', Icono: Clock, color: '#ff9500', pide: true },
    { tipo: 'perdido', texto: 'Perdido', Icono: XCircle, color: '#ff3b30', pide: true },
  ]

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="¿Cómo te fue?">
      <div className="mv-opciones">
        {opciones.map(({ tipo, texto, Icono, color, pide }) => (
          <button key={tipo} disabled={guardando} className={`mv-opcion ${modo === tipo ? 'activa' : ''}`} onClick={() => (pide ? setModo(modo === tipo ? null : tipo) : guardar(tipo))}>
            <span className="mv-opcion-icono" style={{ background: color }}><Icono size={18} color="#fff" /></span>
            {texto}
          </button>
        ))}
      </div>
      {(modo === 'visita' || modo === 'posponer') && (
        <div className="mv-form">
          <Campo etiqueta={modo === 'visita' ? 'Día y hora de la visita' : 'Escribirle de nuevo el'}>
            <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <button className="mv-boton" disabled={guardando || !fecha} onClick={() => guardar(modo, { fecha: new Date(fecha).toISOString() })}>Guardar</button>
        </div>
      )}
      {modo === 'perdido' && (
        <div className="mv-form">
          <Campo etiqueta="Motivo">
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>{MOTIVOS_PERDIDO.map((m) => <option key={m}>{m}</option>)}</select>
          </Campo>
          <button className="mv-boton rojo" disabled={guardando} onClick={() => guardar('perdido', { motivo })}>Marcar como perdido</button>
        </div>
      )}
    </Hoja>
  )
}

const hoyLocal = () => aLocalInput(new Date()).slice(0, 10)

// Registrar la venta (registrar_venta, migración 028): guarda la venta, crea el cliente y cierra el lead.
export function HojaVenta({ lead, abierta, onCerrar, onGuardada }) {
  const { addToast } = useToast()
  const [motos, setMotos] = useState([])
  const [modelo, setModelo] = useState('')
  const [metodo, setMetodo] = useState('contado')
  const [precio, setPrecio] = useState('')
  const [fecha, setFecha] = useState(hoyLocal)
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierta || !lead) return
    const m = modeloSugerido(lead.modelo_interes)
    const met = metodoDesdeFormaPago(lead.forma_pago)
    const p = precioSugerido(m, met)
    setModelo(m); setMetodo(met); setPrecio(p ? p.toLocaleString('es-AR') : ''); setFecha(hoyLocal()); setNotas('')
    supabase.from('inventario_motos').select('id, marca, modelo').order('marca').then(({ data }) => setMotos(data ?? []))
  }, [abierta, lead])

  const opciones = useMemo(() => motos.map((m) => ({ id: m.id, nombre: `${m.marca} ${m.modelo}`.replace(/\s+/g, ' ').trim() })), [motos])
  const monto = leerPrecio(precio)
  if (!lead) return null

  async function guardar() {
    if (!monto) { addToast('Poné el precio de la venta', 'error'); return }
    setGuardando(true)
    const moto = opciones.find((o) => o.nombre.toLowerCase() === modelo.trim().toLowerCase())
    const [a, mes, d] = fecha.split('-').map(Number)
    const { error } = await supabase.rpc('registrar_venta', {
      p_lead_id: lead.id, p_precio: monto, p_metodo_pago: metodo, p_moto_id: moto?.id ?? null,
      p_modelo: modelo.trim() || null, p_fecha: new Date(a, mes - 1, d, 12).toISOString(), p_notas: notas.trim() || null,
    })
    setGuardando(false)
    if (error) { addToast(error.message || 'No se pudo registrar la venta', 'error'); return }
    addToast('¡Venta registrada! 🎉', 'success')
    onGuardada?.()
    onCerrar()
  }

  return (
    <Hoja
      abierta={abierta}
      onCerrar={onCerrar}
      titulo="Registrar venta"
      alto
      pie={<button className="mv-boton verde" disabled={guardando || !monto} onClick={guardar}><BadgeCheck size={18} /> {guardando ? 'Guardando…' : `Registrar venta${monto ? ` · ${formatoPesos(monto)}` : ''}`}</button>}
    >
      <div className="mv-form">
        <Campo etiqueta="Moto">
          <input list="mv-motos" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Ej: Keller Crono Full" />
          <datalist id="mv-motos">{opciones.map((o) => <option key={o.id} value={o.nombre} />)}</datalist>
        </Campo>
        <Campo etiqueta="Forma de pago">
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)}>{Object.entries(METODOS_PAGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Campo>
        <Campo etiqueta="Precio final">
          <input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej: 1.600.000" />
        </Campo>
        <Campo etiqueta="Fecha">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
        <Campo etiqueta="Notas">
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: 12 cuotas Naranja" />
        </Campo>
      </div>
    </Hoja>
  )
}
