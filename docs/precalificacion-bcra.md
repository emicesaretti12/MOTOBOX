# Precalificación automática de DNI (BCRA)

Cuando el bot recibe un DNI para financiar, `sendpulse-whatsapp-webhook` (v6) consulta la
**Central de Deudores del BCRA** (API pública, gratis, sin clave) y decide en 2–5 segundos:

| Resultado | Cuándo | Qué pasa en el CRM | Qué hace el bot |
|---|---|---|---|
| `apto` | Sin deudas, o peor situación ≤ `precalif_situacion_maxima` (2) | Entra a la cola de verificación como siempre, con prioridad **alta** | "Pasó la primera revisión, un asesor te escribe" |
| `no_apto` | Situación 3+, cheques rechazados sin pagar o proceso judicial | **No** entra a la cola. Queda en la nota. Prioridad baja (media si ofreció anticipo) | Pide el DNI de un familiar, hasta `precalif_intentos_max` (3) |
| `sin_verificar` | El BCRA no respondió o la función está apagada | Igual que hoy: entra a la cola | "Recibimos tu DNI, un asesor lo revisa" |

No reemplaza a Credicuotas: saca de entrada a los que casi seguro van a ser rechazados.

## Interruptores (`crm_config`)

```sql
-- Prender / apagar (instantáneo, sin redesplegar)
UPDATE public.crm_config SET valor = 'true',  updated_at = now() WHERE clave = 'precalif_bcra_activa';
UPDATE public.crm_config SET valor = 'false', updated_at = now() WHERE clave = 'precalif_bcra_activa';
-- Más estricto (solo situación 1) o más DNIs de familiares
UPDATE public.crm_config SET valor = '1', updated_at = now() WHERE clave = 'precalif_situacion_maxima';
UPDATE public.crm_config SET valor = '4', updated_at = now() WHERE clave = 'precalif_intentos_max';
```

## Respuesta del webhook (campos nuevos, para el bot)

```json
{
  "message": "Lead existente actualizado",
  "lead_id": "…",
  "precalificacion": "no_apto",
  "pedir_otro_dni": "si",
  "intentos_restantes": "2",
  "mensaje_bot": "Con este DNI no vamos a poder sacar la financiación. Si tenés un familiar…"
}
```

## Configuración en SendPulse (bots de Instagram y WhatsApp)

En el flujo donde hoy se pide el DNI:

1. **Antes de pedirlo**, avisar: *"Para ver si te sale la financiación vamos a consultar tu situación crediticia con tu DNI."*
2. En el bloque **Solicitud a la API** que ya llama a `sendpulse-whatsapp-webhook`, en *Respuesta* guardar en variables de contacto:
   `precalificacion`, `pedir_otro_dni`, `mensaje_bot`.
3. Después del bloque, un **Mensaje** con `{{mensaje_bot}}`.
4. Una **Condición** con `pedir_otro_dni = si`:
   - **Sí** → pregunta *"¿Qué relación tiene con vos?"* (guardar en `relacion`, p. ej. "familiar") → pedir el DNI →
     volver al mismo bloque de API mandando `dni` y `relacion`. El webhook cuenta los intentos solo.
   - **No** → termina el flujo (si `precalificacion = apto` o `sin_verificar`, el lead ya está en la cola).

## Despliegue

1. Migración `015_precalificacion_bcra.sql` (solo agrega columnas y claves, arranca apagada).
2. Desplegar `sendpulse-whatsapp-webhook` con `index.ts`, `resultado.ts` y `precalificacion.ts` (sin verificación de JWT, igual que v5).
   Con el interruptor apagado se comporta igual que v5; solo suma los campos nuevos a la respuesta.
3. Configurar el bot (arriba) y probar con un DNI propio.
4. Prender `precalif_bcra_activa`.

## Medir

```sql
SELECT bcra_resultado, estado_dni, count(*)
  FROM public.leads WHERE bcra_consultado_at >= now() - interval '7 days'
 GROUP BY 1, 2 ORDER BY 1, 2;
```

Si muchos `apto` igual son rechazados por Credicuotas, bajar `precalif_situacion_maxima` a 1.

## Volver atrás

Apagar `precalif_bcra_activa` (instantáneo). Para sacar todo: redesplegar v5 y correr `015_precalificacion_bcra.down.sql`.
