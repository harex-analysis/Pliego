# Pliego 1.11.0 · Beta para Windows x64

**Descarga `Pliego-Setup-x64.exe` y ábrelo.** El instalador incluye todos los componentes y agrega Pliego al menú Inicio y a la lista de aplicaciones de Windows. En la pantalla final puedes elegir **Crear un acceso directo en el escritorio**. La instalación es para tu usuario y funciona sin conexión una vez descargada.

También puedes usar `Pliego-1.11.0-windows-x64.zip` como versión portable. Extrae la carpeta completa y abre `Pliego.exe`. La beta se ha probado en Windows 11 x64. El instalador y el lector van sin firma Authenticode, así que Windows puede mostrar un aviso según la configuración. Las sumas de los archivos están en `SHA256SUMS.txt`.

## Actualizaciones

Pliego consulta el repositorio oficial de GitHub una vez al abrirse, incluidas las betas. Si hay una versión posterior con instalador, aparece **Descargar actualización** en la biblioteca. El botón abre esa versión en tu navegador, donde puedes elegir la descarga e instalarla cuando quieras. Si vienes de una versión anterior, instala esta beta una vez para empezar a recibir avisos.

## Giro de papel

- Puedes levantar la hoja cerca del lomo y desde la parte superior o inferior. En el centro del borde lateral, el pliegue sigue más de cerca los movimientos verticales.
- Al girar desde el medio, el centro del borde se apoya primero y las esquinas siguen la caída del doblez. Al girar desde una esquina, la hoja se flexiona y termina de apoyarse antes de cambiar de página.
- Al soltar después de un recorrido corto, la hoja vuelve a su sitio. El giro funciona en lectura de izquierda a derecha, modo manga, página simple, doble página y pliegos panorámicos.
- La versión de compatibilidad en Canvas 2D aproxima el relieve en equipos que no disponen de WebGL.

## Biblioteca

Usa **Renombrar…** en el menú de una portada o en la barra de selección. Para varios tomos puedes editar los títulos en una vista previa, buscar y reemplazar texto, añadir prefijos o sufijos y numerarlos. Los títulos se guardan en Pliego y conservan los archivos y el progreso de lectura.

Al actualizar, cierra Pliego y ejecuta el instalador nuevo. Si usas la versión portable, extrae la versión nueva en su propia carpeta. La biblioteca y el progreso se guardan en `%APPDATA%\pliego\reading.json` y se conservan al desinstalar. Tus archivos se leen desde su ubicación y las descargas usan la carpeta que elijas.

Al buscar por BitTorrent, otros participantes pueden conocer tu IP y Pliego puede compartir fragmentos durante la descarga. Una descarga pendiente guarda el magnet y su destino localmente.

El código de Pliego se licencia bajo MIT, © 2026 Harex. Consulta `LICENCIAS-DE-TERCEROS.md` para los componentes incluidos y el código fuente correspondiente de 7-Zip.
