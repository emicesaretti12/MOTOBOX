// Supabase Edge Function: sendpulse-whatsapp-webhook (v3)
// Recibe eventos del bot de WhatsApp de SendPulse (flujo de verificación de DNI).
// No reemplaza a sendpulse-lead-webhook (Instagram).
// Autenticación: header x-webhook-secret contra SENDPULSE_WEBHOOK_SECRET. verify_jwt = false.
//
// accion = "dni_recibido"  -> crea o actualiza el lead (origen whatsapp) con el DNI y estado_dni = pendiente
// accion = "resultado"     -> guarda el resultado de la verificación (aprobado | rechazado), sin pisar al CRM
//
// La v2 (la que está hoy en producción) quedó en el commit "Etapa 0" para volver atrás.
// Requiere la migración 008 (funciones dni_webhook_recibido / dni_webhook_resultado).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleRequest } from './handler.ts'

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

Deno.serve((req) =>
  handleRequest(req, {
    secreto: Deno.env.get('SENDPULSE_WEBHOOK_SECRET') ?? '',
    rpc: async (funcion, args) => await db.rpc(funcion, args),
  })
)
