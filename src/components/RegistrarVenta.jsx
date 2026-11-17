import { useEffect, useMemo, useState } from 'react'
import { X, BadgeCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { METODOS_PAGO, modeloSugerido, precioSugerido, metodoDesdeFormaPago, leerPrecio, formatoPesos } from '../lib/venta'

const hoyLocal = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// Modal para cerrar un lead como venta: moto, precio, forma de pago y fecha. Llama a registrar_venta()
// (migración 028), que guarda la venta, crea el cliente y cierra el lead en un solo paso.
export default function RegistrarVenta({ lead, onClose, onGuardada }) {
  const { addToast } = useToast()
  const [motos, setMotos] = useState([])
  const [modelo, setModelo] = useState(() => modeloSugerido(lead.modelo_interes))
  const [metodo, setMetodo] = useState(() => metodoDesdeFormaPago(lead.forma_pago))
  const [precio, setPrecio] = useState(() => {
    const p = precioSugerido(modeloSugerido(lead.modelo_interes), metodoDesdeFormaPago(lead.forma_pago))
    return p ? p.toLocaleString('es-AR') : ''
  })
  const [fecha, setFecha] = useState(hoyLocal)
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    supabase.from('inventario_motos').select('id, marca, modelo').order('marca').then(({ data }) => setMotos(data ?? []))
  }, [])

  const opciones = useMemo(() => motos.map((m) => ({ id: m.id, nombre: `${m.marca} ${m.modelo}`.replace(/\s+/g, ' ').trim() })), [motos])
  const monto = leerPrecio(precio)

  async function guardar(e) {
    e.preventDefault()
    if (!monto) { addToast('Poné el precio de la venta', 'error'); return }
    setGuardando(true)
    const moto = opciones.find((o) => o.nombre.toLowerCase() === modelo.trim().toLowerCase())
    const [a, m, d] = fecha.split('-').map(Number)
    const { error } = await supabase.rpc('registrar_venta', {
      p_lead_id: lead.id,
      p_precio: monto,
      p_metodo_pago: metodo,
      p_moto_id: moto?.id ?? null,
      p_modelo: modelo.trim() || null,
      p_fecha: new Date(a, m - 1, d, 12).toISOString(),
      p_notas: notas.trim() || null,
    })
    setGuardando(false)
    if (error) { addToast(error.message || 'No se pudo registrar la venta', 'error'); return }
    addToast('¡Venta registrada! 🎉', 'success')
    onGuardada?.()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h3>Registrar venta · {lead.nombre || 'Lead'}</h3><button className="modal-close" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={guardar}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Moto</label>
              <input className="form-input" list="venta-motos" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Ej: Keller Crono Full" />
              <datalist id="venta-motos">{opciones.map((o) => <option key={o.id} value={o.nombre} />)}</datalist>
            </div>
            <div className="form-group">
              <label className="form-label">Forma de pago</label>
              <select className="form-input" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                {Object.entries(METODOS_PAGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Precio final</label>
              <input className="form-input" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej: 1.600.000" autoFocus />
              <div className="form-hint">{monto ? formatoPesos(monto) : 'Lo que pagó en total (con el recargo si fue con tarjeta).'}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Fecha</label>
              <input className="form-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Notas (opcional)</label>
              <input className="form-input" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: 12 cuotas Naranja, entrega el sábado" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando || !monto}><BadgeCheck size={16} /> {guardando ? 'Guardando…' : 'Registrar venta'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
