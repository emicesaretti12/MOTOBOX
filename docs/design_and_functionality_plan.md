# Plan de Diseño y Funcionalidad para MotoBox CRM (Estilo Apple)

## 1. Visión General

Este documento detalla la propuesta para transformar el CRM MotoBox en una herramienta altamente funcional y estéticamente minimalista, inspirada en el diseño de Apple. El objetivo es cubrir el ciclo completo de venta de un concesionario de motos, diferenciando claramente las experiencias para gerentes (administradores) y vendedores.

## 2. Principios de Diseño (Estilo Apple)

Adoptaremos los siguientes principios para la interfaz de usuario:

*   **Minimalismo y Claridad**: Eliminación de elementos superfluos, enfoque en el contenido principal. Espacios en blanco generosos.
*   **Tipografía Legible**: Uso consistente de la fuente Inter, con jerarquías claras y tamaños optimizados para la lectura.
*   **Paleta de Colores Sofisticada**: Predominio de grises neutros, blancos y un color de acento azul (`--primary: #007AFF`) para elementos interactivos y llamadas a la acción. Colores semánticos (éxito, advertencia, error) sutiles.
*   **Iconografía Consistente**: Uso de iconos vectoriales claros y uniformes (Lucide React).
*   **Bordes Suaves y Sombras Sutiles**: Elementos con bordes ligeramente redondeados y sombras discretas para dar profundidad sin distraer.
*   **Animaciones Fluidas**: Transiciones y micro-interacciones suaves y rápidas para una experiencia de usuario premium.

## 3. Arquitectura de Información (IA) y Navegación

La navegación se simplificará y se hará más intuitiva. La barra lateral (Sidebar) será el elemento central, con secciones claras:

*   **Dashboard**: Resumen ejecutivo.
*   **Leads**: Gestión de prospectos.
*   **Agenda/Calendario**: Gestión de citas y seguimientos.
*   **Inventario (Nuevo)**: Gestión de motos disponibles.
*   **Ventas (Nuevo)**: Registro y seguimiento de ventas cerradas.
*   **Clientes (Nuevo)**: Base de datos de clientes post-venta.
*   **Usuarios (Admin)**: Gestión de perfiles y roles.
*   **Configuración (Admin)**: Ajustes generales del sistema.

## 4. Funcionalidades Clave por Rol

### 4.1. Ciclo Completo de Venta (Vendedor/Comerciante)

El CRM guiará al vendedor a través de las siguientes etapas:

1.  **Captura de Leads**: Formulario simplificado para añadir nuevos leads con validación en tiempo real.
    *   **Mejora**: Integración con fuentes de leads (ej. formularios web si se implementan en el futuro).
2.  **Calificación y Contacto**: Visualización clara del estado del lead (`nuevo`, `contactado`, `en_negociacion`).
    *   **Mejora**: Acciones rápidas para llamadas/WhatsApp/email directamente desde la lista o detalle del lead.
3.  **Seguimiento y Agenda**: Gestión de interacciones y programación de citas/recordatorios.
    *   **Mejora**: Vista de calendario integrada para el vendedor, mostrando sus citas y tareas pendientes.
4.  **Propuesta y Negociación**: Registro de modelos de interés, presupuesto estimado y notas de negociación.
    *   **Mejora**: Posibilidad de adjuntar documentos (ej. cotizaciones, fichas técnicas) al lead.
5.  **Cierre de Venta**: Marcar lead como `venta_cerrada`.
    *   **Mejora**: Generación de un resumen de venta y vinculación con el módulo de Inventario y Clientes.
6.  **Post-Venta (Básico)**: Acceso rápido al historial de interacciones y ventas del cliente.
    *   **Mejora**: Recordatorios automáticos para seguimiento post-venta (ej. revisión, cumpleaños).

### 4.2. Gestión y Supervisión (Gerente/Admin)

El gerente tendrá una vista holística y herramientas de gestión:

1.  **Dashboard Ejecutivo**: Métricas clave de ventas, leads por estado, rendimiento de vendedores, embudo de ventas.
    *   **Mejora**: Gráficos interactivos y personalizables. Proyecciones de ventas.
2.  **Gestión de Leads Global**: Acceso a todos los leads, con filtros avanzados por vendedor, estado, origen, etc.
    *   **Mejora**: Reasignación de leads entre vendedores. Auditoría completa del historial de cambios de cualquier lead.
3.  **Gestión de Usuarios**: Creación, edición y eliminación de perfiles de vendedor. Asignación de roles.
    *   **Mejora**: Permisos granulares para ciertas acciones.
4.  **Gestión de Inventario (Nuevo Módulo)**: CRUD completo de motos disponibles (marca, modelo, año, precio, estado, fotos).
    *   **Mejora**: Vinculación de motos del inventario a leads y ventas.
5.  **Reportes y Analíticas (Nuevo)**: Informes detallados sobre el rendimiento del equipo, efectividad de campañas, etc.
    *   **Mejora**: Exportación de reportes a CSV/PDF.
6.  **Configuración del Sistema**: Personalización de estados de leads, orígenes, tipos de interacción, etc.

## 5. Mejoras de UX/UI Específicas

*   **Formularios**: Diseño limpio, validación en tiempo real, mensajes de error claros, campos auto-completables donde sea posible.
*   **Tablas de Datos**: Columnas redimensionables, ordenamiento, paginación, búsqueda global y filtros rápidos.
*   **Kanban View**: Mejoras visuales para arrastrar y soltar leads entre estados, con animaciones suaves.
*   **Modales**: Diseño consistente y ligero, con enfoque en la tarea actual.
*   **Notificaciones**: Sistema de notificaciones unificado y no intrusivo para eventos importantes (ej. nueva interacción, lead asignado).

## 6. Próximos Pasos Técnicos (Frontend)

1.  **Refactorización de Componentes Existentes**: Adaptar `LeadsPage`, `LeadDetailPage`, `DashboardPage`, `LoginPage` a los nuevos estilos y patrones de diseño.
2.  **Creación de Nuevos Componentes**: Desarrollar componentes para los módulos de `Inventario`, `Ventas`, `Clientes` y `Agenda/Calendario`.
3.  **Gestión de Estado Global**: Evaluar la necesidad de una solución de gestión de estado más robusta (ej. Zustand, Redux Toolkit) para funcionalidades complejas.
4.  **Rutas y Navegación**: Ajustar `react-router-dom` para las nuevas rutas y asegurar la protección por roles.
5.  **Optimización de Rendimiento**: Continuar con lazy loading, optimización de imágenes y bundle splitting.

## 7. Próximos Pasos Técnicos (Backend/Database)

1.  **Extensión del Esquema de DB**: Añadir tablas para `inventario_motos`, `ventas`, `clientes`.
2.  **Funciones y RLS**: Crear funciones y políticas RLS para los nuevos módulos, asegurando la seguridad y el acceso por rol.
3.  **Triggers Adicionales**: Implementar triggers para automatizar la auditoría en las nuevas tablas.
4.  **APIs de Supabase**: Crear o ajustar las funciones RPC necesarias para las nuevas funcionalidades.

Este plan servirá como hoja de ruta. Estaré en comunicación constante para validar cada paso y asegurar que el resultado final cumpla con tus expectativas de un CRM de nivel senior.
