# Publicar CSV Preview for Jira en Chrome Web Store

Guía para publicar la versión **1.1.1** como **Unlisted**: no aparece en las búsquedas de la Store, pero cualquiera con el enlace puede instalarla.

## Antes de empezar

Necesitás:

- Cuenta de Google para el developer dashboard (idealmente una cuenta de la empresa).
- **USD 5** por única vez para registrar el publisher.
- Verificación de email y **2FA** activo en la cuenta.
- El ZIP: `dist/jira-csv-preview-1.1.1.zip`.
- La ficha en inglés: `CHROME-WEB-STORE-LISTING-EN.md`.
- La política de privacidad en inglés: `privacy.html` o `PRIVACY-EN.md`.
- Una URL pública para la política de privacidad.
- Una cuenta/instancia de Jira de prueba para el revisor.

## 1. Registrar la cuenta de desarrollador

1. Entrá a https://chrome.google.com/webstore/devconsole
2. Iniciá sesión con la cuenta de Google elegida.
3. Aceptá el acuerdo y pagá los USD 5.
4. Verificá el email.
5. Activá 2FA.

> Si usás una cuenta personal, la extensión queda bajo tu identidad personal. Para un activo de la empresa conviene una cuenta corporativa administrada por la empresa.

## 2. Crear el item

1. Pulsá **Add new item**.
2. Subí `dist/jira-csv-preview-1.1.1.zip`.
3. Verificá que el dashboard acepte el manifest y el paquete.

## 3. Store listing

Usá los textos de `CHROME-WEB-STORE-LISTING-EN.md`.

| Campo | Valor |
|---|---|
| Nombre | `CSV Preview for Jira` |
| Summary | `Preview CSV and TSV attachments on a Jira issue in a fast table viewer, without downloading them.` |
| Categoría | `Productivity` o `Developer Tools` |
| Idioma | `English` |
| Descripción | La descripción completa del archivo |
| Screenshots | `screenshots/viewer-light.png`, `viewer-dark.png`, `search-accent.png`, `launcher-menu.png` |
| Icono | Viene en el ZIP |
| Support URL | Opcional; usá una página pública de contacto de la empresa |

Las capturas son 1280×800 y la interfaz está en inglés. Se pueden agregar fichas localizadas en español y portugués más adelante.

## 4. Privacy

En la pestaña **Privacy**:

- **Single purpose:** `Preview CSV and TSV attachments on Jira issues in a table viewer.`
- **Remote code:** No.
- **Host permissions:** leer la lista de adjuntos y descargar el archivo elegido del Jira del usuario.
- **`scripting`:** registrar el content script solo en dominios de Jira agregados manualmente.
- **`storage`:** guardar preferencias localmente.
- **`*://*/*` opcional:** solo para instalaciones que sirven adjuntos desde hosts externos; desactivado por defecto.
- **Datos:** no se recopilan, venden ni comparten. Todo se procesa localmente.
- **Privacy policy URL:** https://xenner.github.io/jira-csv-preview/privacy.html

Si el cuestionario obliga a elegir una categoría de datos, la opción más honesta es **Website content**, usada solo localmente para mostrar el adjunto y nunca transmitida.

### Dónde publicar la política de privacidad

La URL publicada es:

```text
https://xenner.github.io/jira-csv-preview/privacy.html
```

También podés usar otra URL pública, sin login. Opciones:

1. **Google Sites** (recomendado): crear un sitio, pegar el contenido de `privacy.html` o `PRIVACY-EN.md`, publicar con visibilidad “Cualquier persona con el enlace”.
2. **Sitio web de la empresa:** pedir una página `/privacy/jira-csv-preview`.
3. **Hosting estático interno/público:** subir `privacy.html` y usar esa URL.

No uses una URL del GitLab privado: el revisor no puede iniciar sesión.

## 5. Test instructions

El revisor necesita un Jira accesible desde Internet. Lo ideal es crear un **Jira Cloud gratuito** solo para la revisión:

1. Crear un sitio de prueba.
2. Crear una incidencia `ABC-123`.
3. Adjuntar un CSV pequeño.
4. Crear un usuario de prueba con acceso limitado.
5. Pegar en **Test instructions**:

```text
1. Open https://<test-site>.atlassian.net and sign in with the provided test account.
2. Open issue ABC-123, which has a CSV attachment.
3. Click the CSV button in the bottom-right corner of the issue.
4. Test search, sorting, column visibility and CSV export.
```

No uses el Jira interno de la empresa si el revisor no puede acceder por VPN. Tampoco compartas datos reales de clientes.

## 6. Distribution

1. **Visibility:** `Unlisted`.
2. **Regions:** todos, o solo Argentina.
3. **Pricing:** gratis.

Unlisted significa que no aparece en búsquedas, pero cualquiera que tenga el enlace puede instalarla. Si más adelante querés restringirla, se puede cambiar a Private y pasar por revisión nuevamente.

## 7. Enviar a revisión

1. Pulsá **Submit for Review**.
2. Podés dejar la publicación automática o usar **Defer publish** para publicar manualmente cuando esté aprobada.
3. Revisá el email de la cuenta.
4. La revisión puede tardar horas o varios días.

## 8. Después de la aprobación

1. Copiá la URL de la ficha (`https://chromewebstore.google.com/detail/...`).
2. Compartila con los compañeros.
3. Verificá que la instalación y la actualización funcionen.

## Actualizaciones

Para publicar una versión nueva:

1. Cambiar `version` en `manifest.json`.
2. Regenerar el ZIP.
3. En el mismo item, subir el nuevo paquete.
4. Enviar a revisión.

No crees otro item: se mantienen la URL, las instalaciones y las preferencias.

## Checklist final

- [ ] Versión `1.1.1` en `manifest.json`.
- [ ] ZIP `dist/jira-csv-preview-1.1.1.zip`.
- [ ] Cuenta de desarrollador registrada y verificada.
- [ ] 2FA activo.
- [ ] Ficha en inglés completa.
- [ ] Capturas 1280×800.
- [ ] Política de privacidad publicada en URL pública.
- [ ] Justificación de permisos completa.
- [ ] Jira de prueba accesible para el revisor.
- [ ] Visibilidad `Unlisted`.
- [ ] Enviado a revisión.

## Posibles rechazos

- La política de privacidad no es pública o no carga sin login.
- El revisor no puede probar la extensión porque no tiene acceso a Jira.
- Falta justificar `scripting`, los hosts de Atlassian o el permiso opcional `*://*/*`.
- La ficha promete funciones que la extensión no tiene.
- Se intenta evadir el límite de 2 extensiones publicadas creando cuentas duplicadas.
