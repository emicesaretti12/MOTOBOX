// Supabase Edge Function: sendpulse-whatsapp-webhook (v8 = v7 + agente de cierre, tarjeta y red de seguridad)
// Recibe eventos de los bots de SendPulse (WhatsApp e Instagram) para el flujo de calificación.
// Función separada: NO reemplaza a sendpulse-lead-webhook (Instagram viejo).
// Autenticación: header x-webhook-secret contra SENDPULSE_WEBHOOK_SECRET.
//
// accion:
//   lead_calificado | dni_recibido | financia | contado -> crea/actualiza lead (forma de pago, DNI, anticipo, modelo, usada)
//   resultado                                         -> guarda aprobado | rechazado sin pisar al CRM (resultado.ts)
//   derivar | asesor                                  -> el cliente pidió hablar con una persona (prioridad alta)
//   baja                                              -> el cliente dijo que no le interesa
//   visita                                            -> el agente de IA agendó una visita (resumen en "visita")
//   ia_derivar                                        -> el agente de IA terminó: sin interés = baja, si no = derivar
//   sin_cierre                                        -> el cliente dejó la calificación a medias (queda en el CRM)
//
// v6: con crm_config.precalif_bcra_activa = true, cada DNI se consulta en la Central de Deudores del BCRA
// (precalificacion.ts). La respuesta trae campos planos para que el bot de SendPulse decida qué decir:
//   precalificacion: apto | no_apto | sin_verificar
//   pedir_otro_dni:  si | no          (no_apto y quedan intentos -> pedir el DNI de un familiar)
//   intentos_restantes, mensaje_bot
//
// v7: cada evento del bot guarda leads.bot_ultimo_evento_at = ahora. Es el reloj de seguimiento-auto
// (la ventana de 24 h de Meta se cuenta desde el último mensaje del cliente). "baja" no lo actualiza.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { registrarResultado } from './resultado.ts'
import { precalificar, notaPrecalificacion, type Precalificacion } from './precalificacion.ts'
import { interpretarVisita, esSinInteres } from './agenda.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-webhook-secret, content-type',
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function esValorInvalido(t: string) {
  const x = t.trim().toLowerCase()
  return x === '' || x === '-' || x.startsWith('{{') || x === 'null' || x === 'undefined' || x === 'no' || x === 'ninguna' || x === 'n/a'
}

function pick(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = body[k]
    if (typeof v === 'string' || typeof v === 'number') {
      const t = String(v).trim()
      if (!esValorInvalido(t)) return t
    }
  }
  return undefined
}

const soloDigitos = (s: string) => s.replace(/\D/g, '')
const claveTelefono = (s: string) => soloDigitos(s).slice(-10)

function ahoraAR() {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
}

type FormaPago = 'cuotas' | 'anticipo_cuotas' | 'contado' | 'tarjeta'

function normalizarFormaPago(t?: string): FormaPago | undefined {
  if (!t) return undefined
  const x = t.toLowerCase()
  if (x.includes('tarjeta') || x.includes('naranja') || x.includes('visa') || x.includes('master') || x.includes('cordobesa')) {
    return 'tarjeta'
  }
  if (x.includes('anticipo') || x.includes('parte') || x.includes('entrega') || x.includes('mitad')) return 'anticipo_cuotas'
  if (x.includes('contado') || x.includes('efectivo') || x.includes('cash') || x.includes('total')) return 'contado'
  if (x.includes('cuota') || x.includes('financ') || x.includes('credito') || x.includes('crédito') || x.includes('dni')) return 'cuotas'
  return undefined
}

function normalizarOrigen(t?: string): 'whatsapp' | 'instagram' | 'facebook' {
  const x = (t ?? '').toLowerCase()
  if (x.includes('insta')) return 'instagram'
  if (x.includes('face') || x.includes('messenger')) return 'facebook'
  return 'whatsapp'
}

const etiquetaForma: Record<string, string> = {
  cuotas: 'cuotas con DNI',
  anticipo_cuotas: 'anticipo + cuotas',
  contado: 'CONTADO',
  tarjeta: 'TARJETA DE CRÉDITO',
}

const MENSAJES_BOT = {
  apto: '¡Listo! Tu DNI pasó la primera revisión. Un asesor confirma la aprobación y te escribe en breve.',
  no_apto_reintentar: 'Con este DNI no vamos a poder sacar la financiación. Si tenés un familiar (padre, madre, pareja, hermano/a) que pueda ser titular, mandanos su DNI y lo revisamos al instante.',
  no_apto_final: 'No encontramos una opción de financiación con los DNI que nos pasaste. Si tenés tarjeta de crédito, escribí "asesor" y te armamos otra propuesta con tus cuotas.',
  sin_verificar: 'Recibimos tu DNI. Un asesor lo revisa y te escribe en breve.',
}

type ConfigPrecalif = { activa: boolean; situacionMaxima: number; intentosMax: number }

async function leerConfigPrecalif(db: ReturnType<typeof createClient>): Promise<ConfigPrecalif> {
  const apagada = { activa: false, situacionMaxima: 2, intentosMax: 3 }
  const { data, error } = await db.from('crm_config').select('clave, valor')
    .in('clave', ['precalif_bcra_activa', 'precalif_situacion_maxima', 'precalif_intentos_max'])
  if (error || !data) return apagada
  const v = Object.fromEntries(data.map((r: { clave: string; valor: string }) => [r.clave, String(r.valor)]))
  return {
    activa: v.precalif_bcra_activa === 'true',
    situacionMaxima: Number(v.precalif_situacion_maxima) || 2,
    intentosMax: Number(v.precalif_intentos_max) || 3,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    const expected = Deno.env.get('SENDPULSE_WEBHOOK_SECRET')
    if (!expected || req.headers.get('x-webhook-secret') !== expected) {
      return json({ error: 'No autorizado' }, 401)
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body inválido: no es JSON válido' }, 400)
    }

    let accion = (pick(body, ['accion', 'action']) ?? 'lead_calificado').toLowerCase()
    let formaForzada: 'contado' | 'tarjeta' | undefined
    if (accion === 'dni_recibido' || accion === 'financia') accion = 'lead_calificado'
    // "contado" del bot también cubre a quien paga con tarjeta: se distingue por lo que dijo el cliente.
    // Si el agente salió por "contado" pero el cliente dijo cuotas/DNI (o mandó un DNI), manda lo que dijo
    // el cliente: queda como financia y, si falta el DNI, con alerta para pedirlo.
    if (accion === 'contado') {
      accion = 'lead_calificado'
      const dicho = normalizarFormaPago(pick(body, ['forma_pago', 'pago']))
      const mandoDni = /^\d{7,8}$/.test(soloDigitos(pick(body, ['dni', 'lead_dni']) ?? ''))
      formaForzada = dicho === 'tarjeta' ? 'tarjeta'
        : dicho === 'cuotas' || dicho === 'anticipo_cuotas' || mandoDni ? undefined
        : 'contado'
    }
    if (accion === 'asesor') accion = 'derivar'
    // Lo que vuelve a SendPulse cuando el agente de cierre termina: así un mensaje posterior del cliente
    // ("gracias", "ok") no lo manda de nuevo al flujo de rechazo.
    const cierreIA = accion === 'visita' || accion === 'ia_derivar' ? { precalificacion: 'cerrado', estado_dni: 'cerrado' } : {}
    if (accion === 'ia_derivar') accion = esSinInteres(pick(body, ['motivo', 'mensaje', 'notas']) ?? '') ? 'baja' : 'derivar'

    const contactId = pick(body, ['contact_id', 'sendpulse_contact_id'])
    // Instagram a veces manda un teléfono vacío o cortado: con menos de 7 dígitos se descarta (la tabla lo exige).
    const telefonoRaw = pick(body, ['telefono', 'phone', 'whatsapp'])
    const telefono = telefonoRaw && soloDigitos(telefonoRaw).length >= 7 ? telefonoRaw : undefined
    const origen = normalizarOrigen(pick(body, ['origen', 'canal', 'channel']))
    const nombre = pick(body, ['nombre', 'name', 'full_name'])
    const detalleCanal = pick(body, ['detalle_canal', 'campana', 'campaign'])

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    async function buscarLead() {
      const cols = 'id, notas, dni_intentos, telefono, estado'
      if (contactId) {
        const { data } = await db.from('leads').select(cols)
          .eq('sendpulse_contact_id', contactId).order('created_at', { ascending: false }).limit(1)
        if (data && data.length) return data[0]
      }
      if (telefono) {
        const clave = claveTelefono(telefono)
        if (clave.length >= 8) {
          const { data } = await db.from('leads').select(cols)
            .ilike('telefono', `%${clave.slice(-6)}%`).order('created_at', { ascending: false }).limit(50)
          const match = (data ?? []).find((l) => l.telefono && claveTelefono(l.telefono) === clave)
          if (match) return match
        }
      }
      return null
    }

    const agregarNota = (notas: string | null, nota: string) => [notas, `[${ahoraAR()}] ${nota}`].filter(Boolean).join('\n')

    // ---------- resultado de la verificación ----------
    if (accion === 'resultado') {
      const resultado = (pick(body, ['resultado', 'estado_dni']) ?? '').toLowerCase()
      if (!['aprobado', 'rechazado'].includes(resultado)) {
        return json({ error: 'resultado debe ser aprobado o rechazado' }, 400)
      }
      const montoTxt = pick(body, ['monto_aprobado', 'monto'])
      const monto = montoTxt ? Number(soloDigitos(montoTxt)) || null : null
      // v5: si el CRM ya registró este resultado no se duplica ni se borra el monto (ver resultado.ts).
      const r = await registrarResultado({
        rpc: async (funcion, args) => await db.rpc(funcion, args),
        marcarPrioridadAlta: async (id) => await db.from('leads').update({ prioridad: 'alta' }).eq('id', id),
      }, { contactId, telefono, resultado, monto })
      return json(r.body, r.status)
    }

    // ---------- visita agendada por el agente de IA ----------
    if (accion === 'visita') {
      const resumen = pick(body, ['visita', 'resumen', 'motivo', 'mensaje']) ?? ''
      const lead = await buscarLead()
      if (!lead) return json({ error: 'Lead no encontrado' }, 404)
      const fecha = interpretarVisita(resumen)
      const cuando = fecha
        ? fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
        : 'FECHA A CONFIRMAR'
      const { error } = await db.from('leads').update({
        estado: 'en_negociacion',
        prioridad: 'alta',
        ...(fecha ? { fecha_agenda: fecha.toISOString() } : {}),
        bot_ultimo_evento_at: new Date().toISOString(),
        sendpulse_contact_id: contactId ?? undefined,
        notas: agregarNota(lead.notas, `VISITA AGENDADA por el agente IA (${cuando}): ${resumen}`),
      }).eq('id', lead.id)
      if (error) return json({ error: error.message }, 400)
      return json({ message: 'Visita agendada', lead_id: lead.id, fecha_visita: fecha?.toISOString() ?? '', ...cierreIA }, 200)
    }

    // ---------- el cliente dejó la calificación a medias ----------
    // Red de seguridad: el agente de SendPulse venció sin llegar a una salida. Nadie se pierde: el lead
    // queda en el CRM (o se anota en el que ya existe) para que un vendedor lo retome.
    if (accion === 'sin_cierre') {
      const lead = await buscarLead()
      const nota = 'Bot: el cliente dejó la conversación sin terminar la calificación. Escribirle para retomarla.'
      if (lead) {
        if (lead.estado !== 'nuevo' && lead.estado !== 'contactado') return json({ message: 'Lead ya avanzado, no se toca', lead_id: lead.id }, 200)
        const { error } = await db.from('leads').update({ notas: agregarNota(lead.notas, nota) }).eq('id', lead.id)
        if (error) return json({ error: error.message }, 400)
        return json({ message: 'Lead actualizado', lead_id: lead.id }, 200)
      }
      if (!telefono && !contactId) return json({ error: 'Se requiere teléfono o contact_id' }, 400)
      const { data: creado, error } = await db.from('leads').insert({
        nombre: nombre ?? `Sin nombre (${origen})`,
        telefono,
        origen,
        estado: 'nuevo',
        // Sin teléfono (Instagram) es difícil retomarlo: queda en baja para no tapar a los buenos.
        prioridad: telefono ? 'media' : 'baja',
        sendpulse_contact_id: contactId,
        notas: `Nuevo contacto vía ${origen} (bot SendPulse)\n[${ahoraAR()}] ${nota}`,
      }).select('id').single()
      if (error) return json({ error: error.message }, 400)
      return json({ message: 'Lead creado', lead_id: creado.id, is_new: true }, 200)
    }

    // ---------- derivar a una persona / baja ----------
    if (accion === 'derivar' || accion === 'baja') {
      const motivo = pick(body, ['motivo', 'mensaje', 'notas']) ?? ''
      const lead = await buscarLead()
      const nota = accion === 'derivar'
        ? `Bot: el cliente pidió hablar con un asesor${motivo ? ` (${motivo})` : ''}`
        : `Bot: el cliente dijo que no le interesa${motivo ? ` (${motivo})` : ''}`
      if (lead) {
        const { error } = await db.from('leads').update({
          prioridad: accion === 'derivar' ? 'alta' : 'baja',
          ...(accion === 'derivar' ? { bot_ultimo_evento_at: new Date().toISOString() } : {}),
          notas: agregarNota(lead.notas, nota),
          sendpulse_contact_id: contactId ?? undefined,
        }).eq('id', lead.id)
        if (error) return json({ error: error.message }, 400)
        return json({ message: 'Lead actualizado', lead_id: lead.id, ...cierreIA }, 200)
      }
      if (accion === 'baja') return json({ message: 'Sin lead previo, nada que hacer', ...cierreIA }, 200)
      if (!telefono && !contactId) return json({ error: 'Se requiere teléfono o contact_id' }, 400)
      const { data: creado, error } = await db.from('leads').insert({
        nombre: nombre ?? `Sin nombre (${origen})`,
        telefono,
        origen,
        estado: 'nuevo',
        prioridad: 'alta',
        bot_ultimo_evento_at: new Date().toISOString(),
        sendpulse_contact_id: contactId,
        notas: `Nuevo contacto vía ${origen} (bot SendPulse)\n[${ahoraAR()}] ${nota}`,
      }).select('id').single()
      if (error) return json({ error: error.message }, 400)
      return json({ message: 'Lead creado', lead_id: creado.id, is_new: true, ...cierreIA }, 200)
    }

    // ---------- lead calificado ----------
    const dniRaw = pick(body, ['dni', 'lead_dni'])
    const formaPago = formaForzada ?? normalizarFormaPago(pick(body, ['forma_pago', 'pago'])) ?? (dniRaw ? 'cuotas' : undefined)
    const dniDigitos = dniRaw ? soloDigitos(dniRaw) : undefined
    const dniValido = !!dniDigitos && /^\d{7,8}$/.test(dniDigitos)
    const relacion = pick(body, ['relacion', 'dni_titular_relacion']) ?? 'titular'
    const anticipo = pick(body, ['anticipo', 'lead_anticipo'])
    const modelo = pick(body, ['modelo', 'modelo_interes', 'lead_modelo'])
    const usada = pick(body, ['usada', 'usada_detalle', 'lead_usada'])

    if (!telefono && !contactId) return json({ error: 'Se requiere teléfono o contact_id' }, 400)
    const financia = formaPago !== 'contado' && formaPago !== 'tarjeta'
    // Si financia pero el DNI no es válido, NO se pierde el lead: se guarda con alerta para revisión humana.
    const alertaDni = financia && !dniValido

    const lead = await buscarLead()
    const intento = (lead?.dni_intentos ?? 0) + (dniValido ? 1 : 0)

    // ---------- precalificación BCRA (v6) ----------
    let precalif: Precalificacion | null = null
    let cfgPrecalif: ConfigPrecalif = { activa: false, situacionMaxima: 2, intentosMax: 3 }
    if (dniValido && financia) {
      cfgPrecalif = await leerConfigPrecalif(db)
      if (cfgPrecalif.activa) {
        precalif = await precalificar(dniDigitos!, { situacionMaxima: cfgPrecalif.situacionMaxima })
      }
    }
    const noApto = precalif?.resultado === 'no_apto'

    const partes = [
      `Bot ${origen}: forma de pago ${etiquetaForma[formaPago ?? 'cuotas']}`,
      dniValido && !noApto ? `DNI ${dniDigitos} (${relacion}) para verificar` : null,
      dniValido && noApto ? `DNI ${dniDigitos} (${relacion}) descartado por precalificación` : null,
      precalif ? notaPrecalificacion(precalif, intento, relacion) : null,
      noApto && anticipo ? 'OFRECER OTRA OPCIÓN: ofreció anticipo' : null,
      alertaDni ? `ATENCIÓN: DNI no válido o faltante (${dniRaw ?? 'vacío'}), pedirlo de nuevo` : null,
      anticipo ? `anticipo ${anticipo}` : null,
      modelo ? `modelo ${modelo}` : null,
      usada ? `entrega usada: ${usada}` : null,
      detalleCanal ? `vía ${detalleCanal}` : null,
    ].filter(Boolean)
    const nota = partes.join(' — ')

    const campos: Record<string, unknown> = {
      forma_pago: formaPago ?? null,
      // Un no apto que ofrece anticipo no se descarta: sigue en media para ofrecerle otra opción.
      prioridad: formaPago === 'contado' || formaPago === 'tarjeta' || alertaDni || precalif?.resultado === 'apto'
        ? 'alta'
        : noApto && !anticipo ? 'baja' : 'media',
      sendpulse_contact_id: contactId ?? undefined,
      bot_ultimo_evento_at: new Date().toISOString(),
    }
    if (anticipo) campos.anticipo = anticipo
    if (modelo) campos.modelo_interes = modelo
    if (usada) campos.usada_detalle = usada
    // Un DNI no apto NO entra a la cola (no se toca dni / estado_dni): queda solo en la nota.
    if (dniValido && !noApto) {
      campos.dni = dniDigitos
      campos.estado_dni = 'pendiente'
      campos.dni_titular_relacion = relacion
      campos.dni_actualizado_at = new Date().toISOString()
    }
    if (precalif) {
      campos.bcra_resultado = precalif.resultado
      campos.bcra_situacion = precalif.peorSituacion
      campos.bcra_consultado_at = new Date().toISOString()
    }

    // Lo que lee el bot de SendPulse para decidir qué responder.
    const restantes = Math.max(cfgPrecalif.intentosMax - intento, 0)
    const pedirOtro = noApto && restantes > 0
    const paraElBot = {
      precalificacion: precalif?.resultado ?? 'sin_verificar',
      pedir_otro_dni: pedirOtro ? 'si' : 'no',
      intentos_restantes: String(restantes),
      mensaje_bot: !dniValido
        ? ''
        : precalif?.resultado === 'apto'
          ? MENSAJES_BOT.apto
          : noApto
            ? (pedirOtro ? MENSAJES_BOT.no_apto_reintentar : MENSAJES_BOT.no_apto_final)
            : MENSAJES_BOT.sin_verificar,
    }

    if (lead) {
      if (dniValido) campos.dni_intentos = intento
      if (lead.estado === 'perdido') campos.estado = 'nuevo'
      campos.notas = agregarNota(lead.notas, nota + (lead.estado === 'perdido' ? ' — REACTIVADO (estaba perdido)' : ''))
      const { error } = await db.from('leads').update(campos).eq('id', lead.id)
      if (error) {
        console.error('Error actualizando lead', error.code)
        return json({ error: error.message }, 400)
      }
      return json({ message: 'Lead existente actualizado', lead_id: lead.id, is_new: false, alerta_dni: alertaDni, ...paraElBot }, 200)
    }

    const { data: creado, error } = await db.from('leads').insert({
      ...campos,
      nombre: nombre ?? `Sin nombre (${origen})`,
      telefono,
      origen,
      estado: 'nuevo',
      dni_intentos: dniValido ? 1 : 0,
      notas: `Nuevo contacto vía ${origen} (bot SendPulse)\n[${ahoraAR()}] ${nota}`,
    }).select('id').single()
    if (error) {
      console.error('Error creando lead', error.code, error.message)
      return json({ error: error.message }, 400)
    }
    return json({ message: 'Lead creado', lead_id: creado.id, is_new: true, alerta_dni: alertaDni, ...paraElBot }, 200)
  } catch (err) {
    console.error('Error inesperado', err instanceof Error ? err.name : 'desconocido')
    return json({ error: 'Error interno del servidor' }, 500)
  }
})
