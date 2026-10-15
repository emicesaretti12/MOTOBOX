# Verificación de DNI, asignación y métricas — guía de despliegue

Todo esto está en la rama `claude/wonderful-johnson-6kn9m5`. **Nada está aplicado ni desplegado en producción.**
Cada paso de despliegue necesita OK explícito. Todo lo nuevo arranca **apagado**.

```
Cliente (WhatsApp) ─► bot SendPulse ─► sendpulse-whatsapp-webhook ─► lead con estado_dni = pendiente
                                                                           │
                       CRM /verificacion ◄──────────────────────────────────┘
                              │ Aprobado / Rechazado
                              ▼
                        dni-resolver ── 1) guarda el resultado (con el operador)
                              │         2) si aprobó y no tiene vendedor: asigna por turnos (trigger)
                              │         3) ejecuta el flujo "DNI aprobado" / "DNI rechazado"
                              ▼
                      bot SendPulse ─► le escribe al cliente ─► llama al webhook ("ya registrado", no duplica)
```

## Qué se agrega, por etapa

| Etapa | Base de datos | Funciones | Pantallas |
|---|---|---|---|
| 0 | `007` documenta lo que ya está en producción (no cambia nada) | Código actual de producción copiado al repo | — |
| 1 Cola | `008`: `profiles.verifica_dni`, `crm_config`, `dni_resoluciones`, `dni_tomas` y funciones | `dni-resolver` (nueva). `sendpulse-whatsapp-webhook` v3 (**requiere OK**) | `/verificacion` |
| 2 Ficha y listado | — | — | Tarjeta "Verificación de crédito" en la ficha, origen "WhatsApp", filtro y badge de DNI en Leads |
| 3 Asignación | `009`: `profiles.recibe_leads`, `asignaciones_lead` y trigger por turnos | — | Bloque "DNI aprobado — para contactar" arriba en Dashboard y Leads |
| 4 Entrada (propuesta) | `010`: índice por teléfono, emails de relleno, `leads_duplicados`, reingreso de perdidos | Instagram v8 en `index.v8.ts` (**requiere OK**, `index.ts` sigue siendo la v7) | Bloque "Volvieron a escribir" |
| 5 Métricas | `011`: `dni_eventos` (trigger) y `metricas_dni()` | — | `/metricas` (admin) |

**No cambia:** las reglas de acceso actuales (admin ve todo; cada vendedor, solo sus leads), los datos existentes y la función de Instagram en producción.

**Cambios visibles en pantallas existentes:** link "Verificación DNI" (si la cola está prendida), link "Métricas DNI" (admin, si las migraciones están aplicadas), bloques arriba de Dashboard y Leads (solo si hay leads que cumplen), filtro "Todo DNI" y badge en Leads, tarjeta de crédito en la ficha (solo leads con DNI) y origen con etiqueta en la ficha.

## Interruptores (`crm_config`, se cambian con un UPDATE, sin redesplegar)

| Clave | Por defecto | Efecto |
|---|---|---|
| `cola_dni_activa` | `false` | Muestra la cola y permite resolver desde el CRM |
| `aviso_sendpulse_activo` | `false` | Al resolver, ejecuta el flujo en SendPulse |
| `asignacion_automatica_activa` | `false` | Al aprobarse un DNI, asigna por turnos |
| `reingreso_perdidos_activo` | `false` | Un perdido que vuelve a escribir pasa a nuevo (mismo vendedor) |
| `alerta_espera_minutos` | `15` | Desde cuándo se resalta una consulta en la cola |
| `toma_expira_minutos` | `5` | Duración de la reserva "en revisión por X" |
| `emails_relleno` | `["x@gmail.com"]` | Emails que no se usan para buscar duplicados |

```sql
UPDATE public.crm_config SET valor = 'true',  updated_at = now() WHERE clave = 'cola_dni_activa';
UPDATE public.crm_config SET valor = 'false', updated_at = now() WHERE clave = 'asignacion_automatica_activa';
UPDATE public.crm_config SET valor = '20',    updated_at = now() WHERE clave = 'alerta_espera_minutos';
```

## Variables de entorno nuevas (Supabase > Edge Functions > Secrets)

| Variable | Valor | Para qué |
|---|---|---|
| `SENDPULSE_API_URL` | `https://api.sendpulse.com` | URL base de la API |
| `SENDPULSE_CLIENT_ID` | SendPulse > Configuración > API | Token OAuth. **Cargala vos, no la pegues en el chat** |
| `SENDPULSE_CLIENT_SECRET` | SendPulse > Configuración > API | Ídem |
| `SENDPULSE_FLOW_APROBADO_ID` | `6ad102ff405e6a7b3c02e05e` | Flujo "DNI aprobado" |
| `SENDPULSE_FLOW_RECHAZADO_ID` | `6ad1037fc9dc7687a909da19` | Flujo "DNI rechazado" |
| `CRM_ALLOWED_ORIGINS` | opcional, dominio del CRM | Si se carga, solo el CRM puede llamar a `dni-resolver` desde el navegador |

Sin cambios: `SENDPULSE_WEBHOOK_SECRET`. Las variables `SUPABASE_*` las pone Supabase. No hay variables nuevas en el frontend.

Endpoints de SendPulse usados: `POST {SENDPULSE_API_URL}/oauth/access_token` y `POST {SENDPULSE_API_URL}/whatsapp/flows/run` con `{ contact_id, flow_id }`.
Están confirmados contra un cliente de terceros; falta validarlos en la documentación oficial o en el piloto.

## Despliegue (cada paso con OK; después de cada uno, verificar)

1. **Backup nuevo:** `CREATE SCHEMA backup_AAAAMMDD;` y copias de `leads`, `profiles` e `historial_cambios` (con RLS activado en cada copia). Además, un dump fuera de Supabase.
2. **Migraciones 008 y 009.** Verificar: `SELECT clave, valor FROM crm_config;` (todo apagado), `SELECT count(*) FROM leads;` (igual que antes) y que el CRM ande igual.
3. **Secrets** de la tabla de arriba y **desplegar `dni-resolver`** (con verificación de JWT, la opción por defecto).
4. **Frontend** (Vercel). Con todo apagado, lo único nuevo visible es el filtro de DNI, la tarjeta de crédito y el origen con etiqueta en la ficha.
5. **Scripts** `supabase/scripts/habilitar_verificadores.sql` y `habilitar_rotacion.sql`: simulación → OK → aplicar.
6. **Webhook WhatsApp v3.** Si no se aprueba, hay que sacar la llamada al webhook de los flujos "DNI aprobado" y "DNI rechazado" **antes** del paso 8.
7. **Prender** `cola_dni_activa` y `asignacion_automatica_activa`.
8. **Piloto:** prender `aviso_sendpulse_activo` y hacer la prueba de abajo.
9. **Migración 011** (métricas). Los eventos de DNI se cuentan desde acá.
10. **Etapa 4, por separado y con OK:** migración 010; después `duplicados_unificar.sql` (simulación → OK → aplicar); Instagram v8 (reemplazar `index.ts` por `index.v8.ts`); y por último prender `reingreso_perdidos_activo`.

## Prueba del circuito completo

Con un WhatsApp que **no** esté cargado como lead:

1. Escribirle al bot y mandar nombre + DNI.
   → En `/verificacion` aparece en menos de 15 s, "Titular", intento #1, con la espera corriendo.
2. **Rechazado** → confirmar.
   → Aviso "El cliente fue avisado por WhatsApp" y llega el mensaje del flujo "DNI rechazado".
3. Mandar otro DNI como familiar.
   → Vuelve a la cola como intento #2, "Familiar".
4. Desde otra sesión, abrir el mismo con **Aprobado**.
   → Tiene que decir "Lo está revisando …".
5. **Aprobado**, monto `1.500.000` → confirmar.
   → Llega el mensaje del flujo "DNI aprobado".
   → El lead queda `aprobado`, `monto_aprobado = 1500000` y **asignado por turno** (Vendedor 1 o 2).
   → En el historial: "Verificación DNI: aprobado ($1.500.000)" y "Asignación automática: Vendedor X (por turno, DNI aprobado)".
6. Entrar como ese vendedor: el lead aparece arriba, en "DNI aprobado — para contactar". En la ficha se ven el DNI, el monto y los dos intentos.
7. Verificar que no hubo doble registro:
   ```sql
   SELECT l.estado_dni, l.monto_aprobado, l.dni_intentos, p.full_name AS vendedor,
          (SELECT count(*) FROM dni_resoluciones r WHERE r.lead_id = l.id) AS resoluciones,
          (SELECT string_agg(r.aviso_estado, ', ' ORDER BY r.intento) FROM dni_resoluciones r WHERE r.lead_id = l.id) AS avisos
     FROM leads l LEFT JOIN profiles p ON p.id = l.vendedor_asignado
    WHERE l.telefono LIKE '%<últimos 8 dígitos>';
   -- aprobado | 1500000 | 2 | Vendedor X | 2 | enviado, enviado
   ```
8. Probar la falla: poner mal `SENDPULSE_FLOW_APROBADO_ID` y aprobar otro DNI de prueba.
   → El resultado se guarda y aparece en "Sin avisar al cliente". Corregir el ID y tocar **Reintentar aviso**.
9. Comprobar que no se rompió nada: `SELECT count(*) FROM leads;`, y entrar como Vendedor 1 a Leads, Dashboard y Agenda.

## Volver atrás (de menor a mayor; los pasos 1 a 4 no tocan datos)

1. **Apagar los interruptores** (instantáneo):
   ```sql
   UPDATE public.crm_config SET valor = 'false', updated_at = now()
    WHERE clave IN ('cola_dni_activa', 'aviso_sendpulse_activo', 'asignacion_automatica_activa', 'reingreso_perdidos_activo');
   ```
2. **Webhooks:** volver a desplegar la versión anterior: WhatsApp v2 (`git show 46c01de:supabase/functions/sendpulse-whatsapp-webhook/index.ts`) e Instagram v7 (`index.ts` de esta rama).
3. **Frontend:** *Instant Rollback* en Vercel.
4. **`dni-resolver`:** borrarla desde el panel de Supabase.
5. **Scripts:** sección "PARA DESHACER" de cada uno.
6. **Base (destructivo, último recurso, solo con OK)**, en este orden: `supabase/rollback/011…`, `010…`, `009…`, `008…`. Antes, exportar `dni_resoluciones`, `asignaciones_lead`, `leads_duplicados` y `dni_eventos`. Está probado que deja el esquema como producción hoy y los leads intactos (`tests/sql/reversa.test.js`).

## Duplicados (simulación en producción, solo lectura, 16/10)

- **Grupos con el mismo teléfono:** 71 grupos, 154 leads (últimos 10 dígitos).
- **Se marcarían como copia:** 66 leads, en 57 grupos. Quedan en `leads_duplicados`; ningún lead se borra ni se modifica.
- **Para revisar a mano:** 14 grupos, todos por tener vendedores distintos.
- **Origen de las copias:** 64 se cargaron a mano y 17 vinieron de Instagram.

## Tests

```bash
npm install
npm test
```

- `tests/sql/`: cola, permisos, reservas, resolución, webhook idempotente, asignación, entrada de leads, métricas y vuelta atrás. Corren sobre una copia del esquema de producción, con PGlite (Postgres en memoria).
- `tests/unit/`: cliente SendPulse, `dni-resolver`, webhooks de WhatsApp v3 e Instagram v8, y helpers de las pantallas.
- `tests/integracion/`: circuito completo webhook → cola → resolver → SendPulse simulado → webhook.

Limitación: PGlite tiene una sola conexión, así que la concurrencia real (dos operadores en el mismo milisegundo) la garantiza el bloqueo de fila de Postgres (`SELECT … FOR UPDATE` y el lock de la asignación), no un test.
