<div align="center">
  <p><img src=".github/pliego.png" width="144" height="144" alt="Logotipo de Pliego"></p>
  <h1>Pliego</h1>
  <p><strong>Lector de cómics y manga para Windows</strong></p>
  <p>Abre <strong>CBR, CBZ, RAR y ZIP</strong> y pasa las páginas con el mouse como en un cómic físico. Organiza tus tomos y retoma la lectura donde la dejaste.</p>
  <p><a href="https://github.com/harex-analysis/Pliego/releases/download/v1.12.0/Pliego-Setup-x64.exe"><strong>Descargar Pliego para Windows x64 (.exe)</strong></a></p>
  <p>Beta 1.12.0 · <a href="https://github.com/harex-analysis/Pliego/releases/download/v1.12.0/Pliego-1.12.0-windows-x64.zip">ZIP portable</a> · <a href="https://github.com/harex-analysis/Pliego/releases/tag/v1.12.0">Notas y SHA-256</a></p>
</div>

![Demostración del giro de papel con la portada de Eco nocturno](assets/giro-de-pagina.gif)

## Empezar a leer

1. Ejecuta **Pliego-Setup-x64.exe**. Encontrarás Pliego en el menú Inicio y podrás crear un acceso directo en el escritorio al terminar.
2. Pulsa **Añadir archivos** o arrastra tus cómics a la biblioteca. Selecciona una portada para empezar a leer.
3. Agarra la hoja por un borde o desde el centro y arrástrala hacia el otro lado. Si sueltas tras un arrastre corto, la hoja vuelve a su sitio.

Si prefieres el **ZIP portable**, extrae la carpeta completa y abre `Pliego.exe`. Esta beta se ha probado en **Windows 11 x64**. Windows puede mostrar un aviso porque el instalador y la aplicación aún van sin firma Authenticode.

Pliego busca nuevas versiones al abrirse y desde **Opciones → Buscar actualizaciones**. En las versiones con el actualizador integrado, **Descargar actualización** descarga y verifica el instalador. Después, **Instalar y reiniciar** abre el instalador de Windows. En la edición portable puedes abrir la versión en GitHub y descargar el ZIP.

## Lectura

- **Giro de papel.** La hoja se curva donde la agarras y se asienta al pasar al otro lado. Puedes activar el sonido de papel o elegir el cambio inmediato.
- **Cómic y manga.** Elige el sentido de lectura, una o dos páginas y disfruta de las ilustraciones panorámicas completas.
- **Pantalla completa y zoom.** Entra con **F11** y acerca el cursor a un borde horizontal para mostrar los controles. Usa la rueda, el doble clic o los botones para ampliar. Con zoom, arrastra para desplazarte.

<details>
<summary>Atajos de lectura</summary>

| Acción | Atajo |
| --- | --- |
| Añadir archivos | Ctrl + O |
| Pasar página | Flechas o Espacio |
| Ver miniaturas o ir a una página | T o G |
| Ajustar a la ventana | 0 |
| Pantalla completa | F11 |

</details>

Los archivos protegidos con contraseña no se admiten en esta versión.

## Biblioteca

Vuelve a tus últimas lecturas en **Recientes**, busca por título y ajusta el tamaño de las portadas. Deja el cursor sobre una portada para previsualizar la página guardada. Pliego conserva tu progreso, el estado y el sentido de lectura en `%APPDATA%\pliego` y abre tus archivos desde su ubicación original.

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

Puedes cerrar el cuadro y seguir leyendo durante la descarga. Si cierras Pliego, encontrarás la descarga pendiente al volver y podrás reanudarla. Pliego gestiona una descarga a la vez y usa la red pública de BitTorrent. Si el info hash tarda en encontrar fuentes, prueba con el magnet completo.

Al pulsar **Buscar archivos**, Pliego se conecta a BitTorrent. Otros participantes pueden ver tu IP y Pliego puede compartir fragmentos mientras descargas. [Protocolo DHT de BitTorrent](https://www.bittorrent.org/beps/bep_0005.html)

</details>

## Ayuda

Si encuentras un problema, indica tu versión de Windows, la versión de Pliego y los pasos para reproducirlo. [Abrir un issue](https://github.com/harex-analysis/Pliego/issues/new) · [Reportes de seguridad](SECURITY.md)

Pliego se distribuye bajo [MIT](LICENSE). Los motores, fuentes tipográficas y demás dependencias tienen sus propios [avisos de licencia](THIRD-PARTY.md).
