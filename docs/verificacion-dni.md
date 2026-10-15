# Verificación de DNI desde el CRM — Etapa 1

El operador ve la cola de DNIs que mandaron los clientes por WhatsApp, los consulta en la app de la financiera y marca **Aprobado** (con monto opcional) o **Rechazado**. El CRM guarda el resultado y le pide a SendPulse que el bot le avise al cliente.

```
Cliente (WhatsApp) ─► bot SendPulse ─► sendpulse-whatsapp-webhook ─► lead con estado_dni = pendiente
                                                                           │
                       CRM /verificacion ◄──────────────────────────────────┘
                              │ Aprobado / Rechazado
                              ▼
                        dni-resolver ── 1) guarda el resultado (con el operador)
                              │         2) ejecuta el flujo "DNI aprobado" / "DNI rechazado"
                              ▼
                      bot SendPulse ─► le escribe al cliente ─► llama al webhook con el resultado
                                                                 (v3: "ya registrado", no duplica)
```

## Qué se agrega

| Pieza | Archivo | Qué hace |
|---|---|---|
| Migración 008 | `supabase/migrations/008_cola_verificacion_dni.sql` | Solo aditiva. `profiles.verifica_dni`, tablas `crm_config`, `dni_resoluciones`, `dni_tomas` y funciones SQL. Todo apagado. |
| Edge function nueva | `supabase/functions/dni-resolver/` | Resuelve con la sesión del operador y avisa por SendPulse con reintentos. |
| Webhook WhatsApp v3 | `supabase/functions/sendpulse-whatsapp-webhook/` | Mismo contrato que v2; idempotente; DNI enmascarado en notas. **Requiere OK aparte.** |
| Pantalla nueva | `src/pages/VerificacionPage.jsx` | `/verificacion`, para admin y usuarios con `verifica_dni`. |
| Cambios mínimos | `src/App.jsx`, `src/components/Layout.jsx`, `src/index.css` | Ruta, link del menú (solo visible con la cola prendida) y estilos. |
| Script | `supabase/scripts/habilitar_verificadores.sql` | Habilita a Vendedor 1 y 2 (simulación primero). |
| Reversa | `supabase/rollback/008_cola_verificacion_dni_reversa.sql` | Destructiva. Solo con OK. |

**No cambia:** la función de Instagram (`sendpulse-lead-webhook`), las reglas de acceso actuales (admin ve todo, cada vendedor sus leads), las pantallas existentes ni ningún dato existente.

## Interruptores (`crm_config`)

| Clave | Por defecto | Efecto |
|---|---|---|
| `cola_dni_activa` | `false` | Muestra la pantalla y permite resolver desde el CRM. |
| `aviso_sendpulse_activo` | `false` | Al resolver, ejecuta el flujo en SendPulse. Apagado: el resultado se guarda y queda "avisar a mano". |
| `alerta_espera_minutos` | `15` | Desde cuántos minutos una consulta se resalta en rojo. |
| `toma_expira_minutos` | `5` | Cuánto dura la reserva "en revisión por X". |

```sql
-- Prender / apagar (instantáneo, sin redesplegar)
UPDATE public.crm_config SET valor = 'true',  updated_at = now() WHERE clave = 'cola_dni_activa';
UPDATE public.crm_config SET valor = 'false', updated_at = now() WHERE clave = 'aviso_sendpulse_activo';
UPDATE public.crm_config SET valor = '20',    updated_at = now() WHERE clave = 'alerta_espera_minutos';
```

## Variables de entorno nuevas (Supabase > Edge Functions > Secrets)

| Variable | Valor | Para qué |
|---|---|---|
| `SENDPULSE_API_URL` | `https://api.sendpulse.com` | URL base de la API de SendPulse. |
| `SENDPULSE_CLIENT_ID` | (SendPulse > Configuración > API) | Pedir el token OAuth. **Cargalo vos en Supabase, no lo pegues en el chat.** |
| `SENDPULSE_CLIENT_SECRET` | (SendPulse > Configuración > API) | Ídem. |
| `SENDPULSE_FLOW_APROBADO_ID` | `6ad102ff405e6a7b3c02e05e` | Flujo "DNI aprobado". |
| `SENDPULSE_FLOW_RECHAZADO_ID` | `6ad1037fc9dc7687a909da19` | Flujo "DNI rechazado". |
| `CRM_ALLOWED_ORIGINS` | opcional, ej. `https://tu-crm.vercel.app` | Si se carga, solo ese dominio puede llamar a `dni-resolver` desde el navegador. |

Sin cambios: `SENDPULSE_WEBHOOK_SECRET`. `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las pone Supabase.

Endpoints usados: `POST {SENDPULSE_API_URL}/oauth/access_token` y `POST {SENDPULSE_API_URL}/whatsapp/flows/run` con `{ contact_id, flow_id }`. Confirmados contra un cliente de terceros; falta validarlos en la documentación oficial (bloqueada desde el entorno de desarrollo) o en el piloto.

## Despliegue (cada paso, con OK)

1. **Backup nuevo** de lo que se toca: `CREATE SCHEMA backup_AAAAMMDD; CREATE TABLE backup_AAAAMMDD.leads AS SELECT * FROM public.leads; CREATE TABLE backup_AAAAMMDD.profiles AS SELECT * FROM public.profiles;` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en cada copia.
2. **Migración 008.** Verificar: `SELECT clave, valor FROM crm_config;` (todo `false`) y `SELECT count(*) FROM leads;` (igual que antes).
3. **Secrets** de la tabla de arriba.
4. **Desplegar `dni-resolver`** (con verificación de JWT, la opción por defecto).
5. **Desplegar el frontend** (Vercel). Con la cola apagada no se ve nada nuevo.
6. **Verificadores:** `supabase/scripts/habilitar_verificadores.sql` (simulación → OK → aplicar).
7. **Webhook v3** (si lo aprobás). Si no: sacar la llamada al webhook de los flujos "DNI aprobado" y "DNI rechazado" **antes** del paso 9.
8. **Prender la cola**: `cola_dni_activa = true`. Se puede resolver; el aviso todavía es manual.
9. **Piloto con aviso**: `aviso_sendpulse_activo = true` y probar el circuito (abajo).

## Prueba del circuito completo

Con un WhatsApp que **no** esté cargado como lead (por ejemplo el tuyo personal):

1. Escribirle al bot y mandar nombre + DNI (el tuyo).
   → En `/verificacion` aparece en menos de 15 s, con relación "Titular", intento #1 y la espera corriendo.
2. Tocar **Rechazado** → confirmar.
   → Aviso verde "El cliente fue avisado por WhatsApp". En el teléfono llega el mensaje del flujo "DNI rechazado" pidiendo otro DNI.
   → En el lead: nota `CRM: DNI rechazado por …` y en el historial "Verificación DNI: rechazado".
3. Mandar otro DNI como familiar.
   → Vuelve a la cola como intento #2, "Familiar".
4. Desde otra sesión (otro operador) abrir el mismo con **Aprobado**: tiene que decir "Lo está revisando …".
5. Tocar **Aprobado**, monto `1.500.000` → confirmar.
   → Llega el mensaje del flujo "DNI aprobado". El lead queda `estado_dni = aprobado`, `monto_aprobado = 1500000`.
6. Verificar que no hubo doble registro:
   ```sql
   SELECT l.estado_dni, l.monto_aprobado, l.dni_intentos,
          (SELECT count(*) FROM dni_resoluciones r WHERE r.lead_id = l.id) AS resoluciones,
          (SELECT string_agg(r.aviso_estado, ', ' ORDER BY r.intento) FROM dni_resoluciones r WHERE r.lead_id = l.id) AS avisos
     FROM leads l WHERE l.telefono LIKE '%<últimos 8 dígitos>';
   -- aprobado | 1500000 | 2 | 2 | enviado, enviado
   ```
7. Probar el fallo: cargar mal `SENDPULSE_FLOW_APROBADO_ID`, aprobar otro DNI de prueba → el resultado se guarda y aparece en "Sin avisar al cliente". Corregir el ID y tocar **Reintentar aviso**.
8. Comprobar que no se rompió nada: `SELECT count(*) FROM leads;` y entrar como Vendedor 1 a Leads y Dashboard.

La asignación automática a vendedores es de la Etapa 3: en esta etapa el lead aprobado queda sin vendedor.

## Volver atrás (de menor a mayor)

1. **Apagar** (instantáneo, sin tocar datos):
   ```sql
   UPDATE public.crm_config SET valor = 'false', updated_at = now()
    WHERE clave IN ('cola_dni_activa', 'aviso_sendpulse_activo');
   ```
   La pantalla desaparece del menú y el CRM deja de llamar a SendPulse. El bot sigue funcionando como hoy.
2. **Webhook:** volver a desplegar la v2 (`git show 46c01de:supabase/functions/sendpulse-whatsapp-webhook/index.ts`).
3. **Frontend:** *Instant Rollback* en Vercel al deploy anterior.
4. **Edge function:** borrar `dni-resolver` desde el panel de Supabase.
5. **Verificadores:** sección "PARA DESHACER" de `habilitar_verificadores.sql`.
6. **Base (destructivo, último recurso, solo con OK):** `supabase/rollback/008_cola_verificacion_dni_reversa.sql`. Exportar antes `dni_resoluciones`.

Ningún paso borra ni modifica leads existentes.

## Tests

```bash
npm install
npm test        # 67 tests: SQL sobre una copia del esquema de producción (PGlite), edge functions y pantalla
```

- `tests/sql/`: cola, permisos, reservas, resolución atómica, webhook idempotente.
- `tests/unit/`: cliente SendPulse (token, reintentos, 401), `dni-resolver`, webhook v3, helpers de la pantalla.
- `tests/integracion/`: circuito completo webhook → cola → resolver → SendPulse simulado → webhook.

Limitación: PGlite tiene una sola conexión, así que "dos operadores a la vez" se prueba en secuencia. La exclusión real la da el bloqueo de fila (`SELECT … FOR UPDATE`) de Postgres.
