import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { Plus, Search, X, Edit, Trash2, DollarSign, TrendingUp, Award } from 'lucide-react'

const EMPTY_SALE = { lead_id: '', moto_id: '', vendedor_id: '', precio_venta: '', metodo_pago: 'efectivo', fecha_venta: new Date().toISOString().slice(0, 16), notas: '' }
const PAGO_LABELS = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', financiacion: 'Financiación', mixto: 'Mixto' }

function fmt$(v) { return v ? '$' + Number(v).toLocaleString('es-AR') : '-' }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) : '-' }

export default function SalesPage() {
  const { isAdmin, profile } = useAuth()
  const { addToast } = useToast()
  const [sales, setSales] = useState([])
  const [leads, setLeads] = useState([])
  const [motos, setMotos] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingSale, setEditingSale] = useState(null)
  const [formData, setFormData] = useState(EMPTY_SALE)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    try {
      const promises = [
        supabase.from('ventas').select('*, lead:leads!lead_id(nombre), moto:inventario_motos!moto_id(marca, modelo), vendedor:profiles!vendedor_id(full_name)').order('fecha_venta', { ascending: false }),
        supabase.from('leads').select('id, nombre, estado').eq('estado', 'venta_cerrada'),
        supabase.from('inventario_motos').select('id, marca, modelo, precio'),
      ]
      if (isAdmin) promises.push(supabase.from('profiles').select('id, full_name').order('full_name'))
      const results = await Promise.all(promises)
      setSales(results[0].data || [])
      setLeads(results[1].data || [])
      setMotos(results[2].data || [])
      setVendedores(results[3]?.data || [])
    } catch (e) {
      console.error(e)
      setSales([])
    } finally { setLoading(false) }
  }

  const filtered = useMemo(() => sales.filter(s => {
    if (search && !s.lead?.nombre?.toLowerCase().includes(search.toLowerCase()) && !`${s.moto?.marca} ${s.moto?.modelo}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [sales, search])

  const stats = useMemo(() => ({
    total: sales.length,
    revenue: sales.reduce((s, v) => s + (Number(v.precio_venta) || 0), 0),
    promedio: sales.length > 0 ? sales.reduce((s, v) => s + (Number(v.precio_venta) || 0), 0) / sales.length : 0,
    esteMes: sales.filter(v => { const d = new Date(v.fecha_venta); const now = new Date(); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() }).length
  }), [sales])

  function openModal(sale) {
    if (sale) {
      setEditingSale(sale)
      setFormData({ lead_id: sale.lead_id || '', moto_id: sale.moto_id || '', vendedor_id: sale.vendedor_id || '', precio_venta: sale.precio_venta || '', metodo_pago: sale.metodo_pago || 'efectivo', fecha_venta: sale.fecha_venta ? sale.fecha_venta.slice(0, 16) : '', notas: sale.notas || '' })
    } else {
      setEditingSale(null)
      setFormData({ ...EMPTY_SALE, vendedor_id: isAdmin ? '' : profile?.id || '' })
    }
    setIsModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...formData, precio_venta: formData.precio_venta ? Number(formData.precio_venta) : null, vendedor_id: formData.vendedor_id || null, lead_id: formData.lead_id || null, moto_id: formData.moto_id || null, fecha_venta: formData.fecha_venta || null }
      if (editingSale) {
        const { error } = await supabase.from('ventas').update(payload).eq('id', editingSale.id)
        if (error) throw error
        addToast('Venta actualizada', 'success')
      } else {
        const { error } = await supabase.from('ventas').insert([payload])
        if (error) throw error
        // Marcar moto como vendida
        if (payload.moto_id) await supabase.from('inventario_motos').update({ estado: 'vendida' }).eq('id', payload.moto_id)
        addToast('Venta registrada', 'success')
      }
      setIsModalOpen(false)
      fetchData()
    } catch (e) { addToast('Error al guardar', 'error'); console.error(e) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!isAdmin) return
    if (!window.confirm('¿Eliminar esta venta?')) return
    try {
      const { error } = await supabase.from('ventas').delete().eq('id', id)
      if (error) throw error
      addToast('Venta eliminada', 'success')
      fetchData()
    } catch (e) { addToast('Error', 'error') }
  }

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>

  return (
    <div>
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon green"><Award size={20} /></div></div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Total Ventas</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon blue"><DollarSign size={20} /></div></div>
          <div className="stat-card-value">{fmt$(stats.revenue)}</div>
          <div className="stat-card-label">Revenue Total</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon purple"><TrendingUp size={20} /></div></div>
          <div className="stat-card-value">{fmt$(Math.round(stats.promedio))}</div>
          <div className="stat-card-label">Ticket Promedio</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><div className="stat-card-icon red"><DollarSign size={20} /></div></div>
          <div className="stat-card-value">{stats.esteMes}</div>
          <div className="stat-card-label">Este Mes</div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar cliente o moto..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => openModal()}><Plus size={14} /> Nueva Venta</button>}
        <span className="results-count">{filtered.length} ventas</span>
      </div>

      <div className="card">
        <div className="card-body-flush">
          <table className="data-table">
            <thead>
              <tr><th>Fecha</th><th>Cliente</th><th>Moto</th><th>Vendedor</th><th>Precio</th><th>Pago</th>{isAdmin && <th>Acciones</th>}</tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={isAdmin ? 7 : 6}><div className="empty-state"><p>No hay ventas registradas</p></div></td></tr>
              ) : filtered.map(s => (
                <tr key={s.id}>
                  <td>{fmtDate(s.fecha_venta)}</td>
                  <td className="table-cell-primary">{s.lead?.nombre || '-'}</td>
                  <td>{s.moto ? `${s.moto.marca} ${s.moto.modelo}` : '-'}</td>
                  <td className="table-cell-secondary">{s.vendedor?.full_name || '-'}</td>
                  <td className="table-cell-primary">{fmt$(s.precio_venta)}</td>
                  <td>{PAGO_LABELS[s.metodo_pago] || s.metodo_pago || '-'}</td>
                  {isAdmin && (
                    <td>
                      <div className="table-actions">
                        <button className="btn-icon" title="Editar" onClick={() => openModal(s)}><Edit size={16} /></button>
                        <button className="btn-icon danger" title="Eliminar" onClick={() => handleDelete(s.id)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingSale ? 'Editar Venta' : 'Registrar Venta'}</h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Cliente (Lead)</label>
                    <select className="form-input" value={formData.lead_id} onChange={e => setFormData({ ...formData, lead_id: e.target.value })}>
                      <option value="">Seleccionar...</option>
                      {leads.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Moto</label>
                    <select className="form-input" value={formData.moto_id} onChange={e => setFormData({ ...formData, moto_id: e.target.value })}>
                      <option value="">Seleccionar...</option>
                      {motos.map(m => <option key={m.id} value={m.id}>{m.marca} {m.modelo} - {fmt$(m.precio)}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Precio de Venta *</label>
                    <input className="form-input" type="number" value={formData.precio_venta} onChange={e => setFormData({ ...formData, precio_venta: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Método de Pago</label>
                    <select className="form-input" value={formData.metodo_pago} onChange={e => setFormData({ ...formData, metodo_pago: e.target.value })}>
                      {Object.entries(PAGO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Fecha de Venta</label>
                    <input className="form-input" type="datetime-local" value={formData.fecha_venta} onChange={e => setFormData({ ...formData, fecha_venta: e.target.value })} />
                  </div>
                  {isAdmin && (
                    <div className="form-group">
                      <label className="form-label">Vendedor</label>
                      <select className="form-input" value={formData.vendedor_id} onChange={e => setFormData({ ...formData, vendedor_id: e.target.value })}>
                        <option value="">Seleccionar...</option>
                        {vendedores.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div className="form-group"><label className="form-label">Notas</label><textarea className="form-input" rows="3" value={formData.notas} onChange={e => setFormData({ ...formData, notas: e.target.value })}></textarea></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
