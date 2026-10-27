-- ============================================
-- MOTOBOX — Precalificación automática de DNI con el BCRA
--
-- Cuando el bot recibe un DNI, el webhook consulta la Central de Deudores del BCRA (API pública).
--   * APTO (sin deudas o situación 1-2): el DNI entra a la cola de verificación como siempre.
--   * NO APTO (situación 3+, cheques sin pagar o proceso judicial): NO entra a la cola; el bot le pide
--     el DNI de un familiar, hasta precalif_intentos_max intentos.
--   * Si el BCRA no responde: entra a la cola como siempre (nunca se pierde un lead).
--
-- Solo agrega columnas y claves de configuración. No modifica ni borra datos.
-- Arranca APAGADO: precalif_bcra_activa = false.
--
-- Cómo aplicarlo: Supabase > SQL Editor > pegar todo este archivo > Run.
-- Se puede correr más de una vez sin romper nada. Para deshacer: 015_precalificacion_bcra.down.sql
-- ============================================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bcra_resultado TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bcra_situacion SMALLINT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bcra_consultado_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_bcra_resultado_check') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_bcra_resultado_check
      CHECK (bcra_resultado IS NULL OR bcra_resultado = ANY (ARRAY['apto', 'no_apto', 'sin_verificar']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_bcra_situacion_check') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_bcra_situacion_check
      CHECK (bcra_situacion IS NULL OR bcra_situacion BETWEEN 1 AND 6);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS leads_bcra_resultado_idx
  ON public.leads (bcra_resultado) WHERE bcra_resultado IS NOT NULL;

INSERT INTO public.crm_config (clave, valor, descripcion) VALUES
  ('precalif_bcra_activa', 'false', 'Consulta cada DNI en la Central de Deudores del BCRA antes de mandarlo a la cola'),
  ('precalif_situacion_maxima', '2', 'Peor situación BCRA aceptada (1 normal, 2 riesgo bajo). Mayor = no apto'),
  ('precalif_intentos_max', '3', 'Cantidad de DNIs (titular + familiares) que el bot pide antes de cerrar')
ON CONFLICT (clave) DO NOTHING;
