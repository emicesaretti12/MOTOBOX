import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Plus, Search, X, Image, Edit, Trash2 } from 'lucide-react';
import { formatCurrency, getErrorMessage, INVENTORY_STATUS_LABELS, INVENTORY_STATUS_COLORS } from '../lib/utils';

export default function InventoryPage() {
  const { isAdmin } = useAuth();
  const { addToast } = useToast();
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const EMPTY_ITEM = {
    marca: '',
    modelo: '',
    anio: '',
    precio: '',
    estado: 'disponible',
    notas: '',
    imagen_url: '',
  };
  const [formData, setFormData] = useState(EMPTY_ITEM);

  useEffect(() => {
    fetchInventory();
  }, []);

  async function fetchInventory() {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('inventario_motos').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setInventory(data || []);
    } catch (e) {
      console.error('Error fetching inventory:', e);
      addToast(`Error al cargar el inventario: ${getErrorMessage(e)}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este artículo del inventario?')) return;
    try {
      const { error } = await supabase.from('inventario_motos').delete().eq('id', id);
      if (error) throw error;
      addToast('Artículo eliminado', 'success');
      fetchInventory();
    } catch (e) {
      addToast(`Error al eliminar el artículo: ${getErrorMessage(e)}`, 'error');
      console.error(e);
    }
  }

  function openModal(item) {
    if (item) {
      setEditingItem(item);
      setFormData({
        marca: item.marca || '',
        modelo: item.modelo || '',
        anio: item.anio || '',
        precio: item.precio || '',
        estado: item.estado || 'disponible',
        notas: item.notas || '',
        imagen_url: item.imagen_url || '',
      });
    } else {
      setEditingItem(null);
      setFormData(EMPTY_ITEM);
    }
    setIsModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (!formData.marca || !formData.modelo) {
        addToast('Marca y Modelo son obligatorios', 'error');
        return;
      }
      const payload = { ...formData, precio: formData.precio ? Number(formData.precio) : null, anio: formData.anio ? Number(formData.anio) : null };
      if (editingItem) {
        const { error } = await supabase.from('inventario_motos').update(payload).eq('id', editingItem.id);
        if (error) throw error;
        addToast('Artículo de inventario actualizado', 'success');
      } else {
        const { error } = await supabase.from('inventario_motos').insert([payload]);
        if (error) throw error;
        addToast('Artículo de inventario creado', 'success');
      }
      setIsModalOpen(false);
      fetchInventory();
    } catch (e) {
      addToast(`Error al guardar el artículo: ${getErrorMessage(e)}`, 'error');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const filteredInventory = useMemo(() => inventory.filter(item => {
    if (search && !item.marca?.toLowerCase().includes(search.toLowerCase()) && !item.modelo?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [inventory, search]);

  if (loading) return <div className="spinner-overlay"><div className="spinner" /></div>;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Gestión de Inventario</h1>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => openModal()}>
            <Plus size={16} /> Nuevo Artículo
          </button>
        )}
      </div>

      <div className="filters-bar mb-4">
        <div className="search-input-wrap">
          <Search size={16} />
          <input placeholder="Buscar por marca o modelo..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="card-body-flush">
          <table className="data-table">
            <thead>
              <tr>
                <th>Marca</th>
                <th>Modelo</th>
                <th>Año</th>
                <th>Precio</th>
                <th>Estado</th>
                <th>Imagen</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state">
                      <p>No se encontraron artículos en el inventario.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredInventory.map(item => (
                  <tr key={item.id}>
                    <td>{item.marca}</td>
                    <td>{item.modelo}</td>
                    <td>{item.anio || '-'}</td>
                    <td>{formatCurrency(item.precio)}</td>
                    <td><span className={`badge badge-${item.estado}`}>{INVENTORY_STATUS_LABELS[item.estado]}</span></td>
                    <td>
                      {item.imagen_url ? (
                        <img src={item.imagen_url} alt={item.modelo} className="w-10 h-10 object-cover rounded-md" />
                      ) : (
                        <Image size={24} className="text-gray-400" />
                      )}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="btn-icon" onClick={() => openModal(item)}><Edit size={16} /></button>
                        <button className="btn-icon text-red-500 hover:text-red-700" onClick={() => handleDelete(item.id)}><Trash2 size={16} /></button>
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
              <h3 className="modal-title">{editingItem ? 'Editar Artículo' : 'Nuevo Artículo'}</h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Marca</label>
                  <input className="form-input" value={formData.marca} onChange={e => setFormData({ ...formData, marca: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Modelo</label>
                  <input className="form-input" value={formData.modelo} onChange={e => setFormData({ ...formData, modelo: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Año</label>
                  <input className="form-input" type="number" value={formData.anio} onChange={e => setFormData({ ...formData, anio: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Precio</label>
                  <input className="form-input" type="number" value={formData.precio} onChange={e => setFormData({ ...formData, precio: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Estado</label>
                  <select className="form-input" value={formData.estado} onChange={e => setFormData({ ...formData, estado: e.target.value })}>
                    {Object.entries(INVENTORY_STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Notas</label>
                  <textarea className="form-input" value={formData.notas} onChange={e => setFormData({ ...formData, notas: e.target.value })}></textarea>
                </div>
                <div className="form-group">
                  <label className="form-label">URL de Imagen</label>
                  <input className="form-input" value={formData.imagen_url} onChange={e => setFormData({ ...formData, imagen_url: e.target.value })} />
                </div>
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
  );
}
