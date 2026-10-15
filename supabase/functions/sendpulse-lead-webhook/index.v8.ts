// PROPUESTA v8 de sendpulse-lead-webhook (Instagram). NO DESPLEGAR sin OK.
// index.ts sigue siendo la v7 que está en producción.
// Para desplegarla (con OK): reemplazar index.ts por este archivo. Requiere la migración 010.
// Cambios respecto de v7: ver handler.ts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleRequest } from './handler.ts'

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

Deno.serve((req) =>
  handleRequest(req, {
    secreto: Deno.env.get('SENDPULSE_WEBHOOK_SECRET') ?? '',
    rpc: async (funcion, args) => await db.rpc(funcion, args),
    insertarLead: async (datos) => await db.from('leads').insert(datos).select('id').single(),
    actualizarLead: async (id, cambios) => await db.from('leads').update(cambios).eq('id', id).select('id').single(),
  })
)
