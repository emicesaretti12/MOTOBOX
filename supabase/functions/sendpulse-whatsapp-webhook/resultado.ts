// v5: registro del resultado de la verificación (accion = "resultado") sin pisar lo que ya guardó el CRM.
// Usa la función SQL dni_webhook_resultado (migración 008), que en una sola transacción:
//   pendiente / sin DNI          -> lo registra (resultado disparado a mano desde Chats de SendPulse)
//   mismo resultado que el CRM   -> no hace nada (no duplica la nota ni borra el monto)
//   rechazado -> aprobado        -> lo toma como corrección y lo registra
//   aprobado -> rechazado        -> no cambia nada y deja una nota para revisar
// Sin dependencias de Deno para poder testearlo con Vitest.

type ErrorBase = { message: string; code?: string } | null

export interface DependenciasResultado {
  rpc: (funcion: string, args: Record<string, unknown>) => Promise<{ data: any; error: ErrorBase }>
  marcarPrioridadAlta: (leadId: string) => Promise<{ error: ErrorBase }>
  log?: Pick<Console, 'error'>
}

const MENSAJES: Record<string, string> = {
  registrado: 'Resultado guardado',
  ya_registrado: 'Resultado ya registrado',
  corregido: 'Resultado corregido (rechazado → aprobado)',
  conflicto: 'El CRM tiene otro resultado: no se cambió nada',
}

export async function registrarResultado(
  deps: DependenciasResultado,
  datos: { contactId?: string; telefono?: string; resultado: string; monto: number | null }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const log = deps.log ?? console
  const { data, error } = await deps.rpc('dni_webhook_resultado', {
    p_contact_id: datos.contactId ?? null,
    p_telefono: datos.telefono ?? null,
    p_resultado: datos.resultado,
    p_monto: datos.monto,
  })
  if (error) {
    log.error('Error guardando resultado', error.code ?? 'sin_codigo')
    return { status: 400, body: { error: 'No se pudo guardar el resultado' } }
  }
  if (!data || data.estado === 'no_encontrado') return { status: 404, body: { error: 'Lead no encontrado' } }

  // Igual que v4: un DNI aprobado deja el lead en prioridad alta.
  if (datos.resultado === 'aprobado' && data.estado !== 'conflicto') {
    const r = await deps.marcarPrioridadAlta(data.lead_id)
    if (r.error) log.error('No se pudo marcar la prioridad', r.error.code ?? 'sin_codigo')
  }

  return {
    status: 200,
    body: { message: MENSAJES[data.estado] ?? 'Resultado procesado', lead_id: data.lead_id, estado_dni: data.estado_dni, estado: data.estado },
  }
}
