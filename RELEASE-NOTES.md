# Pliego 1.9.1 · Beta portable para Windows x64

Extrae todo el ZIP y ejecuta `Pliego.exe` dentro de la carpeta extraída. Se ha probado en Windows 11 x64. El ejecutable de esta beta carece de firma Authenticode, por lo que Windows puede mostrar un aviso o bloquear su ejecución según la configuración. Comprueba el SHA-256 publicado en `SHA256SUMS.txt` junto al archivo ZIP.

- Lector de CBR, CBZ, RAR y ZIP con giro de papel y modo manga.
- Biblioteca local con Recientes, grupos, progreso, selección por rectángulo y movimiento de títulos entre Cómics y Mangas.
- Descarga BitTorrent por magnet o info hash, con selección de tomos, opción de grupo y reanudación.
- Límites de imágenes antes de decodificarlas y comprobación de espacio en discos locales. Runtime Python 3.13.18 y validación del archivo de aplicación empaquetado.

Al actualizar, cierra Pliego y extrae la versión nueva en su propia carpeta. La biblioteca y el progreso se guardan en `%APPDATA%\pliego\reading.json`. Tus archivos se leen desde su ubicación y las descargas usan la carpeta que elijas.

Al buscar por BitTorrent, otros participantes pueden conocer tu IP y Pliego puede compartir fragmentos durante la descarga. Una descarga pendiente guarda el magnet y su destino localmente.

El código de Pliego se licencia bajo MIT, © 2026 Harex. Consulta `LICENCIAS-DE-TERCEROS.md` para los componentes incluidos y el código fuente correspondiente de 7-Zip.
