# Estado del servicio

Página pública y neutral para comunicar la disponibilidad de la plataforma.
Está alojada fuera de la VPS productiva para que permanezca visible durante una
interrupción del servidor.

## Controles

El workflow `Verificar servicios` consulta la página pública y el acceso al
panel, reintenta antes de declarar una falla, actualiza los componentes
afectados y abre o resuelve automáticamente el incidente público. Cada control
publica la hora confirmada y despliega el JSON actualizado en GitHub Pages.
La página vuelve a consultar el estado cada minuto y también cuando el usuario
regresa a una pestaña que había quedado abierta.

Cada componente muestra un gráfico compacto de los últimos 90 días. El historial
empieza con la primera medición real: los días anteriores se ven como no medidos
y no se completan con disponibilidad ficticia.

### Una falla del control no es una caída del servicio

El control corre en una máquina alquilada a GitHub. Si esa máquina se queda sin
salida a internet, no puede consultar nada, y eso no dice nada sobre la
plataforma. Por eso, antes de publicar una caída se consulta un destino externo
ajeno al proyecto: si tampoco responde, el resultado se descarta y el estado
queda como estaba.

Hasta el 7 de agosto de 2026 no existía esa comprobación y se publicaron 24
interrupciones que nunca ocurrieron. Los registros de acceso del servidor
mostraron que en esos momentos no llegó ninguna consulta del control y que el
sitio respondía con normalidad. Quedaron marcadas como falsa alarma.

### El resumen diario cuenta controles

Cada día guarda cuántos controles hubo y cuántos fallaron. Antes se guardaba el
peor resultado del día, así que un control fallido de treinta pintaba la jornada
entera como caída total.

### Frecuencia real de los controles

El workflow pide cuatro corridas por hora, pero **GitHub entrega alrededor de
una**. El evento `schedule` corre con baja prioridad y se pospone; es un
comportamiento conocido de Actions y no hay forma de forzarlo desde el propio
workflow. Se llegó a medir 34 controles el 30/07 y solo 6 el 06/08.

Esto no afecta el estado que ve quien entra a la página, porque el navegador
consulta la aplicación en vivo. Afecta la resolución del historial y demora la
detección de un corte real.

Para recuperar la frecuencia hay que disparar el control desde afuera. El evento
`workflow_dispatch` **sí** se atiende casi al instante, así que basta con un
programador externo que llame cada cinco minutos a:

```
POST https://api.github.com/repos/SantiagoEsp/estado-servicio/actions/workflows/check-status.yml/dispatches
Authorization: Bearer <token>
Content-Type: application/json

{"ref":"main"}
```

El token debe ser *fine-grained*, limitado a este repositorio y con el único
permiso `Actions: read and write`. Así, en el peor caso, quien lo obtenga solo
puede disparar este control.

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
