// Desactivada a pedido del usuario: la integración con ManyChat ya no se usa.
// Se reemplaza por un stub inerte en vez de eliminarse porque el MCP de Supabase
// no expone una acción de borrado de Edge Functions; borrala manualmente desde
// el dashboard (Edge Functions > clever-processor > Delete) cuando puedas.

Deno.serve(async (_req) => {
  return new Response(
    JSON.stringify({ error: 'Esta funcion fue desactivada. Usar sendpulse-lead-webhook.' }),
    { status: 410, headers: { 'Content-Type': 'application/json' } }
  )
})
