# Pliego

Pliego es un lector local de cómics y manga para Windows. Abre **CBR, CBZ, RAR y ZIP**, guarda tu progreso y te deja pasar las páginas con el mouse como si sostuvieras el cómic.

[**Descargar Pliego para Windows x64 (.exe)**](https://github.com/harex-analysis/Pliego/releases/download/v1.11.0/Pliego-Setup-x64.exe) · [ZIP portable](https://github.com/harex-analysis/Pliego/releases/download/v1.11.0/Pliego-1.11.0-windows-x64.zip) · [Notas de la versión y SHA-256](https://github.com/harex-analysis/Pliego/releases/tag/v1.11.0)

**Beta 1.11.0**, probada en Windows 11 x64. Licencia [MIT](LICENSE).

![La portada de Eco nocturno se arquea al agarrarla desde el centro y se asienta sobre la página al girar](assets/giro-de-pagina.gif)

## Empezar a leer

1. Ejecuta **Pliego-Setup-x64.exe**. El instalador incluye los componentes necesarios, deja Pliego en el menú Inicio y ofrece crear un acceso directo en el escritorio al terminar.
2. Pulsa **Añadir archivos** o arrastra tus cómics a la biblioteca. Haz clic en una portada para abrir el archivo desde su ubicación original.
3. Agarra la hoja por un borde o dentro de una viñeta y arrastra hacia el otro lado. Si sueltas tras un arrastre corto, la hoja vuelve a su sitio.

Para usar el ZIP portable, extrae la carpeta completa y abre `Pliego.exe`. El instalador y la aplicación de esta beta van sin firma Authenticode, así que Windows puede mostrar un aviso. Las sumas SHA-256 están en la página de la versión.

Al abrir Pliego, la biblioteca muestra **Descargar actualización** si hay una versión posterior en GitHub. El botón abre la página de esa versión para que elijas qué descargar.

## Lectura

- **Giro de papel.** La hoja responde al punto de agarre. Al levantarla desde el centro aparece una onda. Si completas el giro, el borde libre se apoya primero y la curva se va reduciendo hacia el lomo.
- **Una página o dos.** Elige vista simple o doble y el sentido de lectura. Las ilustraciones panorámicas se ven completas y también participan en el giro.
- **Pantalla completa y zoom.** Pulsa **F11** para entrar y acerca el cursor a un borde horizontal para mostrar los controles. Usa la rueda, el doble clic o los botones para ampliar. Con zoom, arrastra para desplazarte.
- **Ajustes.** Puedes usar cambio inmediato de página y activar el sonido de papel. El relieve se dibuja con WebGL y cuenta con una versión en Canvas 2D para equipos que lo necesitan.

| Acción | Atajo |
| --- | --- |
| Añadir archivos | Ctrl + O |
| Pasar página | Flechas o Espacio |
| Ver miniaturas o ir a una página | T o G |
| Ajustar a la ventana | 0 |
| Pantalla completa | F11 |

Los archivos protegidos con contraseña no se admiten en esta versión.

## Biblioteca

Pliego guarda tu progreso, el estado de lectura y el sentido de cada título de forma local en `%APPDATA%\pliego`. En **Recientes** puedes volver a lo último que abriste. Deja el cursor sobre una portada para ver la página guardada.

<details>
<summary>Selección, grupos y organización</summary>

- Usa **Añadir archivos**, **Ctrl + O** o arrastra varios archivos al inicio. **Cómics** y **Mangas** muestran sus títulos por separado. **Recientes** muestra lo que has abierto últimamente.
- Si los títulos que añades quedan en otra pestaña, el aviso de importación ofrece **Ver en Cómics** o **Ver en Mangas**. También puedes ir a la pestaña correspondiente al terminar una descarga.
- Usa **Seleccionar** o **Ctrl + clic** para elegir varias portadas. **Mayús + clic** amplía la selección entre dos portadas.
- Arrastra con el botón izquierdo desde un espacio vacío para dibujar un rectángulo sobre las portadas. Mantén **Ctrl** para añadirlas a la selección actual. Si llegas al borde de la biblioteca, la lista se desplaza mientras sigues arrastrando.
- Arrastra una portada seleccionada a la pestaña **Mangas** o **Cómics** para mover toda la selección. También puedes usar **Mover a** en la barra de selección o con clic derecho. Los títulos conservan su página y estado de lectura.
- Arrastra la selección sobre un grupo o usa **Añadir a grupo…**. El botón **Quitar de Pliego** también recibe la selección al arrastrarla. Los archivos se conservan y puedes deshacer la acción.
- Haz clic derecho en una portada o en la selección para actualizar su estado. **Marcar como no leído** vuelve a la primera página. En el menú de una portada también puedes localizar el archivo en el Explorador.
- Usa **Renombrar…** para cambiar el título de una portada o de varios tomos a la vez. La vista previa permite buscar y reemplazar texto, añadir un prefijo o sufijo y numerar los tomos en orden.
- Usa **+ Nuevo grupo** para elegir las portadas en la misma ventana donde le das nombre. Puedes cambiar la selección desde **Editar tomos** en el menú del grupo.
- Usa el icono **Ordenar portadas** en **Todos** o dentro de un grupo y arrastra las portadas de un lado al otro. También puedes moverlas con las flechas bajo cada portada. El orden se guarda con cada movimiento.
- **Sugerir grupos** usa la serie indicada en `ComicInfo.xml` y reconoce números de tomos o capítulos en los nombres. Las coincidencias solo por el inicio del nombre quedan para revisión. Puedes editar los nombres, excluir títulos y decidir qué guardar.

</details>

<details>
<summary>Descargar por magnet o info hash</summary>

1. Pulsa el icono de enlace junto a **Añadir archivos**, pega el magnet o info hash y pulsa **Buscar archivos**.
2. Elige qué tomos descargar. Con varios seleccionados, puedes dejar marcada la opción **Crear grupo en Pliego**. El grupo usa el nombre del torrent.
3. Pulsa **Descargar**. Pliego crea una subcarpeta con el nombre del torrent en `Descargas\Pliego`. Usa **Cambiar** para elegir otra ubicación. Si el nombre ya existe, Pliego añade un número. Los títulos compatibles aparecen en la biblioteca cuando termina la descarga.

Puedes cerrar el cuadro y seguir leyendo durante la descarga. Si cierras Pliego, encontrarás la descarga pendiente al volver y podrás reanudarla. Pliego gestiona una descarga a la vez. Si el info hash tarda en encontrar fuentes, prueba con el magnet completo.

Al pulsar **Buscar archivos**, Pliego se conecta a BitTorrent. Otros participantes pueden ver tu IP y Pliego puede compartir fragmentos mientras descargas. [Protocolo DHT de BitTorrent](https://www.bittorrent.org/beps/bep_0005.html)

</details>

## Ayuda

Si encuentras un problema, indica tu versión de Windows, la versión de Pliego y los pasos para reproducirlo. [Abrir un issue](https://github.com/harex-analysis/Pliego/issues/new) · [Reportes de seguridad](SECURITY.md)

Pliego se distribuye bajo [MIT](LICENSE). Los motores, fuentes tipográficas y demás dependencias tienen sus propios [avisos de licencia](THIRD-PARTY.md).
