import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Plus, Search, X, Edit, Trash2, DollarSign as DollarIcon } from 'lucide-react';
import { formatCurrency, formatDateTime, getErrorMessage, LEAD_STATUS_LABELS } from '../lib/utils';

export default function SalesPage() {
  const { isAdmin } = useAuth();
  const { addToast } = useToast();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState(null);
  const [leads, setLeads] = useState([]);
  const [clients, setClients] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const EMPTY_SALE = {
    lead_id: '',
    cliente_id: '',
    moto_id: '',
    vendedor_id: '',
    precio_venta: '',
    fecha_venta: new Date().toISOString().slice(0, 16),
    notas: '',
  };
  const [formData, setFormData] = useState(EMPTY_SALE);

  useEffect(() => {
    fetchSales();
    fetchRelatedData();
  }, []);

  async function fetchSales() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('ventas')
        .select('*, lead:leads(nombre, telefono), cliente:clientes(full_name, telefono), moto:inventario_motos(marca, modelo), vendedor:profiles(full_name)')
        .order('fecha_venta', { ascending: false });
      if (error) throw error;
      setSales(data || []);
    } catch (e) {
      console.error('Error fetching sales:', e);
      addToast(`Error al cargar las ventas: ${getErrorMessage(e)}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function fetchRelatedData() {
    try {
      const { data: leadsData, error: leadsError } = await supabase.from('leads').select('id, nombre, telefono, email');
      if (leadsError) throw leadsError;
      setLeads(leadsData || []);

      const { data: clientsData, error: clientsError } = await supabase.from('clientes').select('id, full_name, telefono, email');
      if (clientsError) throw clientsError;
      setClients(clientsData || []);

      const { data: inventoryData, error: inventoryError } = await supabase.from('inventario_motos').select('id, marca, modelo, precio').eq('estado', 'disponible');
      if (inventoryError) throw inventoryError;
      setInventory(inventoryData || []);

      if (isAdmin) {
        const { data: vendorsData, error: vendorsError } = await supabase.from('profiles').select('id, full_name').order('full_name');
        if (vendorsError) throw vendorsError;
        setVendedores(vendorsData || []);
      }
    } catch (e) {
      console.error('Error fetching related data:', e);
      addToast(`Error al cargar datos relacionados: ${getErrorMessage(e)}`, 'error');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta venta?')) return;
    try {
      const { error } = await supabase.from('ventas').delete().eq('id', id);
      if (error) throw error;
      addToast('Venta eliminada', 'success');
      fetchSales();
    } catch (e) {
      addToast(`Error al eliminar la venta: ${getErrorMessage(e)}`, 'error');
      console.error(e);
    }
  }

  function openModal(sale) {
    if (sale) {
      setEditingSale(sale);
      setFormData({
        lead_id: sale.lead_id || '',
        cliente_id: sale.cliente_id || '',
        moto_id: sale.moto_id || '',
        vendedor_id: sale.vendedor_id || '',
        precio_venta: sale.precio_venta || '',
        fecha_venta: sale.fecha_venta ? sale.fecha_venta.slice(0, 16) : new Date().toISOString().slice(0, 16),
        notas: sale.notas || '',
      });
    } else {
      setEditingSale(null);
      setFormData({ ...EMPTY_SALE, vendedor_id: isAdmin ? '' : supabase.auth.user()?.id || '' });
    }
    setIsModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (!formData.cliente_id || !formData.precio_venta || !formData.vendedor_id) {
        addToast('Cliente, Precio de Venta y Vendedor son obligatorios', 'error');
        return;
      }
      const payload = { ...formData, precio_venta: Number(formData.precio_venta) };
      if (editingSale) {
        const { error } = await supabase.from('ventas').update(payload).eq('id', editingSale.id);
        if (error) throw error;
        addToast('Venta actualizada', 'success');
      } else {
        const { error } = await supabase.from('ventas').insert([payload]);
        if (error) throw error;
        addToast('Venta creada', 'success');
      }
      setIsModalOpen(false);
      fetchSales();
    } catch (e) {
      addToast(`Error al guardar la venta: ${getErrorMessage(e)}`, 'error');
      console.error(e);
    }
  }

  const filteredSales = useMemo(() => sales.filter(sale => {
    if (search &&
      !sale.lead?.nombre?.toLowerCase().includes(search.toLowerCase()) &&
      !sale.cliente?.full_name?.toLowerCase().includes(search.toLowerCase()) &&
      !sale.moto?.modelo?.toLowerCase().includes(search.toLowerCase())
    ) return false;
    return true;
  }), [sales, search]);

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Gestión de Ventas</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>
          <Plus size={16} /> Nueva Venta
        </button>
      </div>

      <div className="filters-bar mb-4">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar por lead, cliente o moto..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="card-body-flush">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Cliente</th>
                <th>Moto</th>
                <th>Vendedor</th>
                <th>Precio Venta</th>
                <th>Fecha Venta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state">
                      <p>No se encontraron ventas.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSales.map(sale => (
                  <tr key={sale.id}>
                    <td>{sale.lead?.nombre || 'N/A'}</td>
                    <td>{sale.cliente?.full_name || 'N/A'}</td>
                    <td>{sale.moto ? `${sale.moto.marca} ${sale.moto.modelo}` : 'N/A'}</td>
                    <td>{sale.vendedor?.full_name || 'N/A'}</td>
                    <td>{formatCurrency(sale.precio_venta)}</td>
                    <td>{formatDateTime(sale.fecha_venta)}</td>
                    <td>
                      <div className="table-actions">
                        <button className="btn-icon" onClick={() => openModal(sale)}><Edit size={16} /></button>
                        <button className="btn-icon text-red-500 hover:text-red-700" onClick={() => handleDelete(sale.id)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editingSale ? 'Editar Venta' : 'Nueva Venta'}</h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Lead Asociado</label>
                  <select className="form-input" value={formData.lead_id} onChange={e => setFormData({ ...formData, lead_id: e.target.value })}>
                    <option value="">Seleccionar Lead (Opcional)</option>
                    {leads.map(lead => (
                      <option key={lead.id} value={lead.id}>{lead.nombre} ({lead.telefono})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Cliente *</label>
                  <select className="form-input" value={formData.cliente_id} onChange={e => setFormData({ ...formData, cliente_id: e.target.value })} required>
                    <option value="">Seleccionar Cliente</option>
                    {clients.map(client => (
                      <option key={client.id} value={client.id}>{client.full_name} ({client.telefono})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Moto Vendida</label>
                  <select className="form-input" value={formData.moto_id} onChange={e => setFormData({ ...formData, moto_id: e.target.value })}>
                    <option value="">Seleccionar Moto (Opcional)</option>
                    {inventory.map(moto => (
                      <option key={moto.id} value={moto.id}>{moto.marca} {moto.modelo} ({formatCurrency(moto.precio)})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Vendedor *</label>
                  <select className="form-input" value={formData.vendedor_id} onChange={e => setFormData({ ...formData, vendedor_id: e.target.value })} required>
                    <option value="">Seleccionar Vendedor</option>
                    {vendedores.map(v => (
                      <option key={v.id} value={v.id}>{v.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Precio de Venta *</label>
                  <input className="form-input" type="number" value={formData.precio_venta} onChange={e => setFormData({ ...formData, precio_venta: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha de Venta</label>
                  <input className="form-input" type="datetime-local" value={formData.fecha_venta} onChange={e => setFormData({ ...formData, fecha_venta: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Notas</label>
                  <textarea className="form-input" value={formData.notas} onChange={e => setFormData({ ...formData, notas: e.target.value })}></textarea>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
