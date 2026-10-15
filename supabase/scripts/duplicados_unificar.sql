-- ============================================
-- Unificación de leads con el mismo teléfono (últimos 10 dígitos).
-- Requiere la migración 010. NO BORRA NI MODIFICA LEADS: solo anota en leads_duplicados
-- qué lead es copia de cuál. Correr el PASO 1, revisar y recién con OK correr el PASO 2.
-- Regla del principal: estado más avanzado (venta > negociación > contactado > nuevo > perdido),
-- después el que tiene interacciones, después el que tiene vendedor, después el más antiguo.
-- ============================================

-- PASO 1a — RESUMEN (solo lectura)
SELECT count(DISTINCT clave_telefono)                                      AS grupos,
       count(*)                                                            AS leads_en_grupos,
       count(*) FILTER (WHERE NOT es_principal AND NOT revisar_a_mano)     AS se_marcarian_como_duplicado,
       count(DISTINCT clave_telefono) FILTER (WHERE revisar_a_mano)        AS grupos_para_revisar_a_mano
  FROM public.leads_duplicados_propuesta();

-- PASO 1b — DETALLE (solo lectura): un renglón por lead, el principal primero en cada grupo.
SELECT '***' || right(p.clave_telefono, 4) AS telefono,
       CASE WHEN p.es_principal THEN 'PRINCIPAL' ELSE 'duplicado' END AS rol,
       l.nombre, p.estado, l.origen, v.full_name AS vendedor, p.interacciones, p.creado_at::date AS alta,
       p.revisar_a_mano, p.lead_id, p.principal_id
  FROM public.leads_duplicados_propuesta() p
  JOIN public.leads l ON l.id = p.lead_id
  LEFT JOIN public.profiles v ON v.id = p.vendedor_id
 ORDER BY p.revisar_a_mano DESC, p.clave_telefono, p.es_principal DESC, p.creado_at;

-- PASO 2 — APLICAR (solo con OK). Marca los duplicados de los grupos que NO necesitan revisión.
-- Los grupos con revisar_a_mano = true quedan sin marcar para decidirlos uno por uno.
-- BEGIN;
-- INSERT INTO public.leads_duplicados (lead_id, principal_id, clave_telefono)
-- SELECT lead_id, principal_id, clave_telefono
--   FROM public.leads_duplicados_propuesta()
--  WHERE NOT es_principal AND NOT revisar_a_mano
-- ON CONFLICT (lead_id) DO NOTHING;
-- COMMIT;

-- PARA DESHACER (solo afecta la tabla de marcas, nunca los leads)
-- DELETE FROM public.leads_duplicados WHERE marcado_at >= '<fecha y hora del PASO 2>';
