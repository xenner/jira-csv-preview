# Chrome Web Store — material de publicación

> Versión en inglés: `CHROME-WEB-STORE-LISTING-EN.md`.

## Ficha

- **Nombre:** CSV Preview for Jira
- **Resumen (máx. 132 caracteres):** Previsualiza los adjuntos CSV y TSV de una incidencia de Jira en una tabla, sin descargarlos ni salir de Jira.
- **Categoría:** Herramientas para desarrolladores
- **Idioma predeterminado:** Inglés
- **Idiomas de la interfaz:** inglés, español de Argentina, portugués de Brasil
- **Página de privacidad:** publicar `PRIVACY.md` en una URL pública y pegarla en la ficha.

## Descripción

Abre una incidencia de Jira y pulsa el botón CSV de la esquina inferior derecha. El adjunto se abre en una tabla sobre la propia incidencia, con búsqueda, ordenación, gestión de columnas, copia y exportación.

Pensado para los CSV que se adjuntan a tickets: exportaciones de datos, listados de clientes, resultados de consultas, hojas de cálculo compartidas. En lugar de descargar el archivo y abrirlo en otra aplicación, se revisa donde ya está.

- Detecta automáticamente la incidencia y sus adjuntos `.csv` / `.tsv`.
- Visor con tabla virtualizada para archivos grandes.
- Búsqueda con normalización de acentos, ordenación y detección de columnas numéricas.
- Separador y codificación automáticos, con selector manual.
- Columnas ajustables, ocultables y con la primera fila como encabezado opcional.
- Copia celdas o la vista completa en TSV, y exporta la vista filtrada como CSV.
- Tema claro/oscuro que sigue a Jira.
- Jira Cloud, Data Center y dominios propios.
- Atajo `Ctrl + Shift + Y`.

La extensión no recopila datos. Solo consulta la lista de adjuntos de la incidencia y descarga el archivo que decides abrir, usando tu sesión de Jira.

No está afiliada, respaldada ni patrocinada por Atlassian. Jira es una marca registrada de Atlassian Pty Ltd.

## Justificación de permisos

- **storage:** guardar tema, densidad, tamaño de letra, preferencia de encabezado y dominios adicionales.
- **scripting:** registrar el content script únicamente en los dominios de Jira que el usuario añada en ajustes (Jira Data Center o dominios propios).
- **`*://*.atlassian.net/*`, `*://*.atlassian.com/*`, `*://*.jira.com/*`:** consultar la lista de adjuntos de la incidencia y descargar el CSV/TSV elegido. `atlassian.com` también cubre el host de medios al que Jira Cloud redirige las descargas.
- **`*://*/*` opcional (desactivado):** permitir la descarga cuando una instalación de Jira sirve los adjuntos desde un host externo (S3, CDN). Solo se solicita si el usuario activa la opción en ajustes y se puede revocar allí.

## Declaraciones

- **Propósito único:** previsualizar adjuntos CSV/TSV de incidencias de Jira.
- **Código remoto:** no. Todo el código, incluido Papa Parse, está empaquetado en la extensión.
- **Datos del usuario:** no se recopilan, venden ni comparten. Sin analíticas ni telemetría.
- **Publicidad:** no.
- **Afiliación con Atlassian:** no.

## Capturas

- `screenshots/viewer-light.png`
- `screenshots/viewer-dark.png`
- `screenshots/search-accent.png`
- `screenshots/launcher-menu.png`

## Notas para la revisión

1. Cargar la extensión descomprimida.
2. Abrir una incidencia de Jira con un adjunto `.csv`.
3. Pulsar el botón CSV de la esquina inferior derecha.
4. Probar búsqueda, ordenación, columnas y exportación.

La extensión necesita una sesión real de Jira para consultar adjuntos; no usa datos de demostración en producción.
