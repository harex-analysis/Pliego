# Pliego 1.10.0 · Beta para Windows x64

**Descarga `Pliego-Setup-x64.exe` y ábrelo.** El instalador incluye todos los componentes y agrega Pliego al menú Inicio y a la lista de aplicaciones de Windows. La instalación es para tu usuario y funciona sin conexión una vez descargada.

También puedes usar `Pliego-1.10.0-windows-x64.zip` como versión portable. Extrae la carpeta completa y abre `Pliego.exe`. La beta se ha probado en Windows 11 x64. El instalador y el lector van sin firma Authenticode, así que Windows puede mostrar un aviso según la configuración. Las sumas de los archivos están en `SHA256SUMS.txt`.

## Giro de papel

- Agarra la hoja desde el interior o desde los bordes. La curva responde al punto donde empiezas y la hoja queda sujeta al lomo.
- El agarre central levanta una ondulación. Durante un giro completo, la hoja conserva el impulso del arrastre y pierde velocidad al apoyarse. El borde libre entra en contacto primero y el arco termina de asentarse hacia el lomo.
- Al soltar después de un recorrido corto, la hoja vuelve a su sitio. El giro funciona en lectura de izquierda a derecha, modo manga, página simple, doble página y pliegos panorámicos.
- La versión de compatibilidad en Canvas 2D aproxima el relieve en equipos que no disponen de WebGL.

Al actualizar, cierra Pliego y ejecuta el instalador nuevo. Si usas la versión portable, extrae la versión nueva en su propia carpeta. La biblioteca y el progreso se guardan en `%APPDATA%\pliego\reading.json` y se conservan al desinstalar. Tus archivos se leen desde su ubicación y las descargas usan la carpeta que elijas.

Al buscar por BitTorrent, otros participantes pueden conocer tu IP y Pliego puede compartir fragmentos durante la descarga. Una descarga pendiente guarda el magnet y su destino localmente.

El código de Pliego se licencia bajo MIT, © 2026 Harex. Consulta `LICENCIAS-DE-TERCEROS.md` para los componentes incluidos y el código fuente correspondiente de 7-Zip.
