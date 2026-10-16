// Supabase Edge Function: dni-resolver
// La llama la pantalla "Verificación DNI" del CRM con la sesión del operador (verify_jwt = true).
// Registra el resultado de la verificación y le avisa al cliente por WhatsApp o Instagram vía SendPulse.
//
// Variables de entorno (Supabase > Edge Functions > Secrets):
//   SENDPULSE_API_URL            URL base de la API (https://api.sendpulse.com)
//   SENDPULSE_CLIENT_ID          credenciales de la API de SendPulse
//   SENDPULSE_CLIENT_SECRET
//   SENDPULSE_FLOW_APROBADO_ID   flujo "DNI aprobado"
//   SENDPULSE_FLOW_RECHAZADO_ID  flujo "DNI rechazado"
//   SENDPULSE_IG_FLOW_APROBADO_ID  (opcional) flujo "DNI aprobado" del bot de Instagram
//   SENDPULSE_IG_FLOW_RECHAZADO_ID (opcional) flujo "DNI rechazado" del bot de Instagram
//   CRM_ALLOWED_ORIGINS          (opcional) dominios del CRM separados por coma, para CORS
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las pone Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleRequest } from './handler.ts'
import { crearClienteSendPulse, type CanalSendPulse } from './sendpulse.ts'

// IDs de los flujos del bot de Instagram (MotoBox Cordoba). No son secretos; se pueden pisar con las variables.
const IG_FLOW_APROBADO = '6ad145d034c78528d7052830'
const IG_FLOW_RECHAZADO = '6ad145f984352f98cc085cee'

const env = (nombre: string) => (Deno.env.get(nombre) ?? '').trim()

const supabaseUrl = env('SUPABASE_URL')
const anonKey = env('SUPABASE_ANON_KEY')
const servicio = createClient(supabaseUrl, env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

const apiUrl = env('SENDPULSE_API_URL')
const clientId = env('SENDPULSE_CLIENT_ID')
const clientSecret = env('SENDPULSE_CLIENT_SECRET')
const sendpulse = apiUrl && clientId && clientSecret
  ? crearClienteSendPulse({ apiUrl, clientId, clientSecret })
  : null

Deno.serve((req) =>
  handleRequest(req, {
    origenesPermitidos: env('CRM_ALLOWED_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean),
    rpcComoUsuario: async (authorization, funcion, args) => {
      const usuario = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      return await usuario.rpc(funcion, args)
    },
    rpcServicio: async (funcion, args) => await servicio.rpc(funcion, args),
    sendpulse,
    flujos: {
      aprobado: env('SENDPULSE_FLOW_APROBADO_ID') || undefined,
      rechazado: env('SENDPULSE_FLOW_RECHAZADO_ID') || undefined,
      instagram: {
        aprobado: env('SENDPULSE_IG_FLOW_APROBADO_ID') || IG_FLOW_APROBADO,
        rechazado: env('SENDPULSE_IG_FLOW_RECHAZADO_ID') || IG_FLOW_RECHAZADO,
      },
    },
    canalDeResolucion: async (resolucionId): Promise<CanalSendPulse> => {
      const { data: r } = await servicio.from('dni_resoluciones').select('lead_id').eq('id', resolucionId).maybeSingle()
      if (!r?.lead_id) return 'whatsapp'
      const { data: l } = await servicio.from('leads').select('origen').eq('id', r.lead_id).maybeSingle()
      return l?.origen === 'instagram' ? 'instagram' : 'whatsapp'
    },
  })
)
