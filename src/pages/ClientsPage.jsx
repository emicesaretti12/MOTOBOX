import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Plus, Search, X, Edit, Trash2 } from 'lucide-react';
import { getErrorMessage } from '../lib/utils';

export default function ClientsPage() {
  const { isAdmin } = useAuth();
  const { addToast } = useToast();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [formData, setFormData] = useState({
    full_name: '',
    telefono: '',
    email: '',
    dni: '',
    direccion: '',
  });

  useEffect(() => {
    fetchClients();
  }, []);

  async function fetchClients() {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('clientes').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setClients(data || []);
    } catch (e) {
      console.error('Error fetching clients:', e);
      addToast(`Error al cargar los clientes: ${getErrorMessage(e)}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este cliente?')) return;
    try {
      const { error } = await supabase.from('clientes').delete().eq('id', id);
      if (error) throw error;
      addToast('Cliente eliminado', 'success');
      fetchClients();
    } catch (e) {
      addToast(`Error al eliminar el cliente: ${getErrorMessage(e)}`, 'error');
      console.error(e);
    }
  }

  function openModal(client) {
    if (client) {
      setEditingClient(client);
      setFormData({
        full_name: client.full_name || '',
        telefono: client.telefono || '',
        email: client.email || '',
        dni: client.dni || '',
        direccion: client.direccion || '',
      });
    } else {
      setEditingClient(null);
      setFormData({
        full_name: '',
        telefono: '',
        email: '',
        dni: '',
        direccion: '',
      });
    }
    setIsModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (!formData.full_name) {
        addToast('El nombre completo es obligatorio', 'error');
        return;
      }
      const payload = { ...formData };
      if (editingClient) {
        const { error } = await supabase.from('clientes').update(payload).eq('id', editingClient.id);
        if (error) throw error;
        addToast('Cliente actualizado', 'success');
      } else {
        const { error } = await supabase.from('clientes').insert([payload]);
        if (error) throw error;
        addToast('Cliente creado', 'success');
      }
      setIsModalOpen(false);
      fetchClients();
    } catch (e) {
      addToast(`Error al guardar el cliente: ${getErrorMessage(e)}`, 'error');
      console.error(e);
    }
  }

  const filteredClients = useMemo(() => clients.filter(client => {
    if (search &&
      !client.full_name?.toLowerCase().includes(search.toLowerCase()) &&
      !client.telefono?.includes(search) &&
      !client.email?.toLowerCase().includes(search.toLowerCase())
    ) return false;
    return true;
  }), [clients, search]);

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Gestión de Clientes</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>
          <Plus size={16} /> Nuevo Cliente
        </button>
      </div>

      <div className="filters-bar mb-4">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar por nombre, teléfono o email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="card-body-flush">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre Completo</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>DNI</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <div className="empty-state">
                      <p>No se encontraron clientes.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredClients.map(client => (
                  <tr key={client.id}>
                    <td>{client.full_name}</td>
                    <td>{client.telefono || '-'}</td>
                    <td>{client.email || '-'}</td>
                    <td>{client.dni || '-'}</td>
                    <td>
                      <div className="table-actions">
                        <button className="btn-icon" onClick={() => openModal(client)}><Edit size={16} /></button>
                        <button className="btn-icon text-red-500 hover:text-red-700" onClick={() => handleDelete(client.id)}><Trash2 size={16} /></button>
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
              <h3 className="modal-title">{editingClient ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nombre Completo *</label>
                  <input className="form-input" value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input className="form-input" value={formData.telefono} onChange={e => setFormData({ ...formData, telefono: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">DNI</label>
                  <input className="form-input" value={formData.dni} onChange={e => setFormData({ ...formData, dni: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Dirección</label>
                  <textarea className="form-input" value={formData.direccion} onChange={e => setFormData({ ...formData, direccion: e.target.value })}></textarea>
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
