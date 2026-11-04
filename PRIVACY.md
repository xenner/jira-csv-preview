# Privacidad — CSV Preview for Jira

**CSV Preview for Jira no recopila, vende, comparte ni transmite datos personales.**

## Qué datos se tratan

La extensión solo trabaja con datos que ya están en tu navegador y en tu instancia de Jira:

- La clave de la incidencia que estás viendo (por ejemplo, `ABC-123`), leída de la URL o del DOM.
- La lista de adjuntos de esa incidencia, obtenida de la API REST de tu propio Jira.
- El contenido del adjunto `.csv` o `.tsv` que decides previsualizar, descargado de tu propio Jira con tu sesión.

Estos datos se procesan localmente y se muestran en el visor. No se envían a servidores de la extensión, porque la extensión no tiene servidores.

## Qué se guarda

Solo se guardan preferencias en `chrome.storage.local`, en tu equipo:

- tema (automático, claro u oscuro);
- densidad de filas y tamaño de texto;
- si la primera fila se usa como encabezado;
- dominios de Jira adicionales que hayas añadido manualmente.

Puedes borrar estos datos desinstalando la extensión o desde las herramientas de desarrollo de Chrome.

## Peticiones de red

La extensión hace únicamente estas peticiones, siempre a tu instancia de Jira:

1. `GET /rest/api/3/issue/{clave}?fields=attachment` (o `/rest/api/2/...` en instalaciones antiguas) para leer la lista de adjuntos.
2. La descarga del adjunto que pulsas, siguiendo la redirección que Jira indique (por ejemplo, a su host de medios).

No se cargan analíticas, fuentes, scripts ni imágenes desde Internet. Papa Parse está incluido dentro de la extensión; no se ejecuta código remoto.

## Permisos

- **storage**: guardar las preferencias indicadas.
- **scripting**: activar la extensión en dominios de Jira que añadas manualmente.
- **Host permissions de Atlassian**: leer la lista de adjuntos y descargar el archivo elegido.
- **`*://*/*` opcional**: solo si tú lo activas, para instalaciones que sirven adjuntos desde un dominio externo. Puedes revocarlo en cualquier momento en los ajustes.

## Terceros

- [Papa Parse](https://www.papaparse.com/) (MIT) se distribuye dentro de `vendor/` para analizar CSV. No es un servicio remoto.
- La extensión no está afiliada, respaldada ni patrocinada por Atlassian. Jira es una marca registrada de Atlassian Pty Ltd.

## Cambios

Si en el futuro la extensión cambiara su tratamiento de datos, esta política se actualizaría antes de publicar la nueva versión.

Última actualización: noviembre de 2026.
