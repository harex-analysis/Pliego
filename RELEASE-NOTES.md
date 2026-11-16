# Pliego 1.12.0 · Beta para Windows x64

**Descarga `Pliego-Setup-x64.exe` y ábrelo.** El instalador incluye todos los componentes y agrega Pliego al menú Inicio y a la lista de aplicaciones de Windows. En la pantalla final puedes elegir **Crear un acceso directo en el escritorio**. La instalación es para tu usuario y funciona sin conexión una vez descargada.

También puedes usar `Pliego-1.12.0-windows-x64.zip` como versión portable. Extrae la carpeta completa y abre `Pliego.exe`. La beta se ha probado en Windows 11 x64. El instalador y el lector van sin firma Authenticode, así que Windows puede mostrar un aviso según la configuración. Las sumas de los archivos están en `SHA256SUMS.txt`.

## Novedades

- **Actualizaciones dentro de Pliego.** Descarga el instalador desde la biblioteca o desde **Opciones → Buscar actualizaciones**. Pliego muestra el progreso y comprueba el SHA-256 antes de ofrecer la instalación.
- **Agarre lateral con zoom.** El pliegue sigue los arrastres diagonales y verticales a lo largo de ambos bordes. Las esquinas se levantan gradualmente y la hoja cae más rápido al soltar desde un borde.
- **Giro con teclado.** Espacio y las flechas completan el giro antes de mostrar la página nueva, también al pasar de una página a dos o viceversa.
- **Tramas más uniformes.** La página quieta y la parte plana de la hoja al girar usan la misma muestra de la imagen.

## Seguridad

- Electron 45.3.3 incorpora los parches de seguridad de Node.js 24.22.3. El proceso de compilación comprueba el SHA-256 de los binarios descargados. [Electron 45.3.3](https://github.com/electron/electron/releases/tag/v45.3.3)
- Pliego comprueba el formato del archivo antes de abrirlo y limita la extracción a ZIP y RAR.
- BitTorrent bloquea direcciones locales y reservadas en las conexiones filtradas por libtorrent y descarta parámetros de origen ajenos a los admitidos por Pliego. [libtorrent 2.1.2](https://github.com/arvidn/libtorrent/releases/tag/v2.1.2)

## Actualizaciones

Pliego consulta el repositorio oficial de GitHub al abrirse, incluidas las betas. En la edición instalada, **Descargar actualización** descarga y verifica el instalador. Pulsa **Instalar y reiniciar** para abrir el instalador de Windows y elige **Abrir Pliego** al terminar. Si vienes de una versión anterior al actualizador integrado, instala esta versión manualmente una vez. En la edición portable puedes abrir la versión en GitHub y descargar el ZIP.

## Giro de papel

- Puedes levantar la hoja cerca del lomo y desde la parte superior o inferior. En el centro del borde lateral, el pliegue sigue más de cerca los movimientos verticales.
- Al girar desde el medio, el centro del borde se apoya primero y las esquinas siguen la caída del doblez. Al girar desde una esquina, la hoja se flexiona y termina de apoyarse antes de cambiar de página.
- Al soltar después de un recorrido corto, la hoja vuelve a su sitio. El giro funciona en lectura de izquierda a derecha, modo manga, página simple, doble página y pliegos panorámicos.
- La versión de compatibilidad en Canvas 2D aproxima el relieve en equipos que no disponen de WebGL.

## Biblioteca

Usa **Renombrar…** en el menú de una portada o en la barra de selección. Para varios tomos puedes editar los títulos en una vista previa, buscar y reemplazar texto, añadir prefijos o sufijos y numerarlos. Los títulos se guardan en Pliego y conservan los archivos y el progreso de lectura.

Si actualizas manualmente, cierra Pliego antes de ejecutar el instalador nuevo. Si usas la versión portable, extrae la versión nueva en su propia carpeta. La biblioteca y el progreso se guardan en `%APPDATA%\pliego\reading.json` y se conservan al desinstalar. Tus archivos se leen desde su ubicación y las descargas usan la carpeta que elijas.

Al buscar por BitTorrent, otros participantes pueden conocer tu IP y Pliego puede compartir fragmentos durante la descarga. Una descarga pendiente guarda el magnet y su destino localmente.

El código de Pliego se licencia bajo MIT, © 2026 Harex. Consulta `LICENCIAS-DE-TERCEROS.md` para los componentes incluidos y el código fuente correspondiente de 7-Zip.
