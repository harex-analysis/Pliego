# Pliego

Lector local de cómics para Windows con giro de papel. Abre CBR, CBZ, RAR y ZIP sin convertir el archivo. La biblioteca guarda la página, el estado y la dirección de lectura de tus títulos.

![Giro de página en Pliego con páginas originales de Eco nocturno](assets/giro-de-pagina.gif)

## Descargar y abrir en Windows

Pliego se distribuye como beta portable para Windows x64. En GitHub, descarga el ZIP de la sección **Releases**, verifica su SHA-256 con el archivo `SHA256SUMS.txt` y extrae la carpeta completa. Ejecuta `Pliego.exe` desde esa carpeta. La beta actual va sin firma Authenticode, por lo que Windows puede mostrar un aviso.

Usa **Añadir archivos** o arrastra los cómics a la biblioteca. Haz clic en una portada para leer desde la ubicación original del archivo. La biblioteca se guarda en `%APPDATA%\pliego`, incluso cuando mueves o actualizas la carpeta portable.

- Mantén pulsada una esquina para levantar la hoja y arrástrala hacia el otro lado. Suelta después de un recorrido corto para devolverla a su sitio. También puedes arrastrar desde el interior de la página con la vista ajustada a la ventana. El visor muestra un consejo que se puede cerrar y se oculta al completar el primer giro por arrastre.
- Las ilustraciones panorámicas participan en el giro como un pliego y vuelven a mostrarse como una sola imagen completa al terminar.
- Usa las flechas, Espacio o los botones inferiores para girar la hoja. Pulsa **T** para ver miniaturas y **G** para ir a una página.
- En la biblioteca, deja el cursor sobre una portada para ver la página guardada. Haz clic en la portada para abrir el cómic.
- Amplía con la rueda, doble clic o los botones de zoom. Cuando la página esté ampliada, arrastra para desplazarte. Pulsa **0** para ajustar a la ventana.
- Usa el botón **Pantalla completa** de Pliego o pulsa **F11** para entrar. Acerca el cursor al borde superior o inferior para mostrar temporalmente los controles. Usa **Esc** o **F11** para salir.
- En ajustes puedes elegir una o dos páginas, activar el sentido manga, silenciar el sonido y usar cambio inmediato de página. El sonido de papel viene apagado.
- El giro usa WebGL cuando está disponible y un pliegue en Canvas 2D en los demás equipos.

Los archivos protegidos con contraseña no se admiten en esta versión.

## Biblioteca

- Usa **Añadir archivos**, **Ctrl + O** o arrastra varios archivos al inicio. **Cómics** y **Mangas** muestran sus títulos por separado. **Recientes** muestra lo que has abierto últimamente.
- Si los títulos que añades quedan en otra pestaña, el aviso de importación ofrece **Ver en Cómics** o **Ver en Mangas**. También puedes ir a la pestaña correspondiente al terminar una descarga.
- Usa **Seleccionar** o **Ctrl + clic** para elegir varias portadas. **Mayús + clic** amplía la selección entre dos portadas.
- Arrastra con el botón izquierdo desde un espacio vacío para dibujar un rectángulo sobre las portadas. Mantén **Ctrl** para añadirlas a la selección actual. Si llegas al borde de la biblioteca, la lista se desplaza mientras sigues arrastrando.
- Arrastra una portada seleccionada a la pestaña **Mangas** o **Cómics** para mover toda la selección. También puedes usar **Mover a** en la barra de selección o con clic derecho. Los títulos conservan su página y estado de lectura.
- Arrastra la selección sobre un grupo o usa **Añadir a grupo…**. El botón **Quitar de Pliego** también recibe la selección al arrastrarla. Los archivos se conservan y puedes deshacer la acción.
- Haz clic derecho en una portada o en la selección para actualizar su estado. **Marcar como no leído** vuelve a la primera página. En el menú de una portada también puedes localizar el archivo en el Explorador.
- Usa **+ Nuevo grupo** para elegir las portadas en la misma ventana donde le das nombre. Puedes cambiar la selección desde **Editar tomos** en el menú del grupo.
- Usa el icono **Ordenar portadas** en **Todos** o dentro de un grupo y arrastra las portadas de un lado al otro. También puedes moverlas con las flechas bajo cada portada. El orden se guarda con cada movimiento.
- **Sugerir grupos** usa la serie indicada en `ComicInfo.xml` y reconoce números de tomos o capítulos en los nombres. Las coincidencias solo por el inicio del nombre quedan para revisión. Puedes editar los nombres, excluir títulos y decidir qué guardar.

## Descargar por magnet o info hash

1. Pulsa el icono de enlace junto a **Añadir archivos**, pega el magnet o info hash y pulsa **Buscar archivos**.
2. Elige qué tomos descargar. Con varios seleccionados, puedes dejar marcada la opción **Crear grupo en Pliego**. El grupo usa el nombre del torrent.
3. Pulsa **Descargar**. Pliego crea una subcarpeta con el nombre del torrent en `Descargas\Pliego`. Usa **Cambiar** para elegir otra ubicación. Si el nombre ya existe, Pliego añade un número. Los títulos compatibles aparecen en la biblioteca cuando termina la descarga.

Puedes cerrar el cuadro y seguir leyendo durante la descarga. Si cierras Pliego, encontrarás la descarga pendiente al volver y podrás reanudarla. Pliego gestiona una descarga a la vez. Si el info hash tarda en encontrar fuentes, prueba con el magnet completo.

Al pulsar **Buscar archivos**, Pliego se conecta a BitTorrent. Otros participantes pueden ver tu IP y Pliego puede compartir fragmentos mientras descargas. [Protocolo DHT de BitTorrent](https://www.bittorrent.org/beps/bep_0005.html)

## Código fuente

En Windows x64, con Node.js 22.12 o posterior, ejecuta:

```powershell
npm ci
npm run setup:win
npm run test:win
npm start
```

Usa `npm run build:win` para compilar la carpeta portable y `npm run release:win` para crear los archivos de distribución. [Guía de publicación](PUBLICAR.md) · [Reportes de seguridad](SECURITY.md)

Pliego se distribuye bajo [MIT](LICENSE). Los motores, fuentes tipográficas y demás dependencias tienen sus propios [avisos de licencia](THIRD-PARTY.md).
