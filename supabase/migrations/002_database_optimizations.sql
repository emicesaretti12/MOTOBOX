-- ============================================
-- MOTOBOX CRM — Optimizaciones de Base de Datos v1.0
-- ============================================

-- Habilitar extensión pg_trgm para búsquedas de texto parciales eficientes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- TRIGGERS DE AUDITORÍA AUTOMÁTICA PARA LEADS
-- ============================================

-- Función para registrar cambios en la tabla 'leads' automáticamente
CREATE OR REPLACE FUNCTION public.audit_leads_changes()
RETURNS TRIGGER AS $$
DECLARE
  old_value TEXT;
  new_value TEXT;
  field_name TEXT;
  current_user_id UUID;
BEGIN
  -- Obtener el ID del usuario autenticado de Supabase (si existe)
  SELECT auth.uid() INTO current_user_id;

  IF TG_OP = 'UPDATE' THEN
    -- Iterar sobre las columnas para detectar cambios
    IF OLD.nombre IS DISTINCT FROM NEW.nombre THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Nombre', OLD.nombre::TEXT, NEW.nombre::TEXT);
    END IF;
    IF OLD.telefono IS DISTINCT FROM NEW.telefono THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Teléfono', OLD.telefono::TEXT, NEW.telefono::TEXT);
    END IF;
    IF OLD.email IS DISTINCT FROM NEW.email THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Email', OLD.email::TEXT, NEW.email::TEXT);
    END IF;
    IF OLD.modelo_interes IS DISTINCT FROM NEW.modelo_interes THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Modelo de Interés', OLD.modelo_interes::TEXT, NEW.modelo_interes::TEXT);
    END IF;
    IF OLD.origen IS DISTINCT FROM NEW.origen THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Origen', OLD.origen::TEXT, NEW.origen::TEXT);
    END IF;
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Estado', OLD.estado::TEXT, NEW.estado::TEXT);
    END IF;
    IF OLD.vendedor_asignado IS DISTINCT FROM NEW.vendedor_asignado THEN
      -- Para vendedor, guardar nombres en lugar de IDs para mayor legibilidad
      SELECT full_name INTO old_value FROM public.profiles WHERE id = OLD.vendedor_asignado;
      SELECT full_name INTO new_value FROM public.profiles WHERE id = NEW.vendedor_asignado;
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Vendedor Asignado', COALESCE(old_value, OLD.vendedor_asignado::TEXT), COALESCE(new_value, NEW.vendedor_asignado::TEXT));
    END IF;
    IF OLD.notas IS DISTINCT FROM NEW.notas THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Notas', OLD.notas::TEXT, NEW.notas::TEXT);
    END IF;
    IF OLD.presupuesto_estimado IS DISTINCT FROM NEW.presupuesto_estimado THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Presupuesto Estimado', OLD.presupuesto_estimado::TEXT, NEW.presupuesto_estimado::TEXT);
    END IF;
    IF OLD.fecha_agenda IS DISTINCT FROM NEW.fecha_agenda THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Fecha de Agenda', OLD.fecha_agenda::TEXT, NEW.fecha_agenda::TEXT);
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_nuevo)
    VALUES (NEW.id, current_user_id, 'Creación de Lead', 'Lead Creado');
  END IF;

  RETURN NEW;
END;
$$
LANGUAGE plpgsql SECURITY DEFINER;

-- Eliminar trigger existente si ya fue creado (para idempotencia)
DROP TRIGGER IF EXISTS trg_audit_leads_changes ON public.leads;

-- Crear trigger AFTER INSERT OR UPDATE en la tabla 'leads'
CREATE TRIGGER trg_audit_leads_changes
AFTER INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.audit_leads_changes();

-- ============================================
-- CORRECCIÓN DE POLÍTICAS RLS PARA HISTORIAL_CAMBIOS
-- ============================================

-- Eliminar políticas RLS existentes para historial_cambios (para idempotencia)
DROP POLICY IF EXISTS historial_admin_all ON historial_cambios;
DROP POLICY IF EXISTS historial_vendor_select ON historial_cambios;
DROP POLICY IF EXISTS historial_vendor_insert ON historial_cambios;

-- Permitir a los administradores ver y modificar todo el historial
CREATE POLICY "historial_admin_all" ON historial_cambios
FOR ALL USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Permitir a los vendedores ver el historial de sus leads asignados
CREATE POLICY "historial_vendor_select" ON historial_cambios
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM leads
    WHERE leads.id = historial_cambios.lead_id
    AND public.is_owner_or_admin(leads.vendedor_asignado)
  )
);

-- Permitir a los vendedores insertar historial solo si es de sus leads asignados
CREATE POLICY "historial_vendor_insert" ON historial_cambios
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM leads
    WHERE leads.id = historial_cambios.lead_id
    AND public.is_owner_or_admin(leads.vendedor_asignado)
  )
  AND usuario_id = auth.uid()
);

-- ============================================
-- ÍNDICES DE RENDIMIENTO PARA BÚSQUEDA (pg_trgm)
-- ============================================

-- Crear índices GIN para búsqueda de texto parcial en nombre y teléfono
CREATE INDEX IF NOT EXISTS trgm_idx_leads_nombre ON leads USING GIN (nombre public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_idx_leads_telefono ON leads USING GIN (telefono public.gin_trgm_ops);

-- ============================================
-- VALIDACIONES A NIVEL DE TABLA (CHECK CONSTRAINTS)
-- ============================================

-- Asegurar que el teléfono tenga al menos 7 dígitos (ignorando no-dígitos)
ALTER TABLE leads
ADD CONSTRAINT chk_leads_telefono_format
CHECK (telefono IS NULL OR LENGTH(REGEXP_REPLACE(telefono, '\D', '', 'g')) >= 7);

-- Asegurar que el presupuesto estimado sea un número positivo
ALTER TABLE leads
ADD CONSTRAINT chk_leads_presupuesto_positivo
CHECK (presupuesto_estimado IS NULL OR presupuesto_estimado >= 0);

-- ============================================
-- DONE
-- ============================================
