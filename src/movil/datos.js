import { useCallback, useEffect, useState } from 'react'
import { supabase, traerTodos } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useRefrescoAuto } from '../hooks/useRefrescoAuto'

export const CAMPOS_LEAD = 'id, nombre, telefono, email, notas, modelo_interes, forma_pago, anticipo, usada_detalle, monto_aprobado, ' +
  'bcra_resultado, estado_dni, estado, origen, prioridad, puntaje_compra, puntaje_motivo, created_at, updated_at, fecha_agenda, ' +
  'caliente_at, caliente_atendido_at, caliente_motivo, dni_actualizado_at, duplicado_de, proximo_contacto_at, ultimo_contacto_at, contacto_intentos, ' +
  'vendedor_asignado, sendpulse_contact_id, vendedor:profiles!vendedor_asignado(full_name)'

// Leads del usuario (todos si es admin), en vivo: se recargan al cambiar algo, al volver a la app y cada 2 minutos.
export function useLeads({ abiertos = false } = {}) {
  const { profile, isAdmin } = useAuth()
  const [leads, setLeads] = useState(null)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    if (!profile?.id) return
    const { data, error: e } = await traerTodos(() => {
      let q = supabase.from('leads').select(CAMPOS_LEAD).is('duplicado_de', null).order('created_at', { ascending: false }).order('id')
      if (abiertos) q = q.in('estado', ['nuevo', 'contactado', 'en_negociacion'])
      if (!isAdmin) q = q.eq('vendedor_asignado', profile.id)
      return q
    })
    if (e) { setError('No se pudo cargar. Revisá la conexión.'); return }
    setError(null)
    setLeads(data ?? [])
  }, [profile?.id, isAdmin, abiertos])

  useEffect(() => {
    cargar()
    let t
    const canal = supabase.channel(`movil-leads-${abiertos ? 'a' : 't'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => { clearTimeout(t); t = setTimeout(cargar, 800) })
      .subscribe()
    return () => { clearTimeout(t); supabase.removeChannel(canal) }
  }, [cargar, abiertos])
  useRefrescoAuto(() => cargar(), 120000)

  // Cambio optimista (la pantalla se actualiza al instante y después confirma con la base).
  const actualizarLocal = useCallback((id, cambios) => {
    setLeads((prev) => (prev ? prev.map((l) => (l.id === id ? { ...l, ...cambios } : l)) : prev))
  }, [])

  return { leads, error, cargar, actualizarLocal }
}

export function useLead(id) {
  const [lead, setLead] = useState(null)
  const [error, setError] = useState(null)
  const cargar = useCallback(async () => {
    if (!id) return
    const { data, error: e } = await supabase.from('leads').select(CAMPOS_LEAD).eq('id', id).maybeSingle()
    if (e || !data) { setError(e ? 'No se pudo cargar el lead.' : 'No encontramos este lead.'); return }
    setError(null)
    setLead(data)
  }, [id])
  useEffect(() => {
    cargar()
    const canal = supabase.channel(`movil-lead-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads', filter: `id=eq.${id}` }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [id, cargar])
  useRefrescoAuto(() => cargar(), 30000)
  return { lead, error, cargar, setLead }
}

export function abrirWhatsApp(telefono, texto) {
  const d = String(telefono ?? '').replace(/\D/g, '')
  if (d.length < 8) return
  const num = d.startsWith('54') ? d : `54${d}`
  window.open(`https://wa.me/${num}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`, '_blank', 'noopener')
}
