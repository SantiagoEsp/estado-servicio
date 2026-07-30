# Estado del servicio

Página pública y neutral para comunicar la disponibilidad de la plataforma.
Está alojada fuera de la VPS productiva para que permanezca visible durante una
interrupción del servidor.

## Controles

El workflow `Verificar servicios` consulta cada 15 minutos:

- la página pública
- el acceso al panel

Reintenta antes de declarar una falla, actualiza los componentes afectados y
abre o resuelve automáticamente el incidente público. Cada control publica la
hora confirmada para que la página muestre cuándo se verificó realmente el
servicio y despliega el JSON actualizado directamente en GitHub Pages.
La página vuelve a consultar el estado cada minuto y también cuando el usuario
regresa a una pestaña que había quedado abierta.

Cada componente muestra un gráfico compacto de los últimos 90 días. El historial
empieza con la primera medición real: los días anteriores se ven como no medidos
y no se completan con disponibilidad ficticia.

## Desarrollo

No requiere dependencias externas.

```bash
npm run check
python -m http.server 8080
```

Abrir `http://localhost:8080`.

## Datos públicos

- `data/status.json`: estado general y por componente.
- `data/incidents.json`: incidentes de los últimos 90 días.

Los archivos no incluyen IP, versiones, credenciales, logs ni mensajes de error
internos.

## Publicación

`Publicar página de estado` valida y despliega el sitio mediante GitHub Pages.
El dominio temporal previsto es `estado.sanezeit.com`.
