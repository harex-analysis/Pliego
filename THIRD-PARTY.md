# Componentes de terceros

El código propio de Pliego se distribuye bajo [MIT](LICENSE). Los componentes siguientes conservan sus licencias.

| Componente | Procedencia y avisos |
| --- | --- |
| Electron 45.3.3 y Chromium | [Electron v45.3.3](https://github.com/electron/electron/releases/tag/v45.3.3). `LICENSE` y `LICENSES.chromium.html` están junto a `Pliego.exe`. |
| 7-Zip 26.06 | Se distribuyen `7z.exe` y `7z.dll` sin modificaciones. Incluye GNU LGPL 2.1 o posterior, componentes BSD y la restricción de unRAR. Los avisos y el texto de LGPL están en `resources/vendor/7zip`. [Fuente exacta, 7z2606-src.7z](https://github.com/ip7z/7zip/releases/download/26.06/7z2606-src.7z), incluido también como archivo adjunto de la distribución. |
| Python 3.13.18 | [Código fuente CPython](https://www.python.org/downloads/release/python-31318/) y [compilación de Astral 20261110 para Windows x64](https://github.com/astral-sh/python-build-standalone/releases/tag/20261110). Se incluyen la licencia de Python y sus avisos para código redistribuible de Microsoft en `resources/vendor/torrent/runtime/LICENSE.txt` y avisos adicionales en `resources/licenses/Python`. |
| libtorrent 2.1.2 | [Wheel Windows x64 oficial](https://github.com/arvidn/libtorrent/releases/tag/v2.1.2) y [código fuente](https://github.com/arvidn/libtorrent/tree/v2.1.2). Su licencia BSD-3-Clause está en `resources/vendor/torrent/libtorrent-LICENSE.txt`. Se incluyen los avisos de Boost y OpenSSL. |
| image-size 2.1.0 | [Paquete npm](https://www.npmjs.com/package/image-size/v/2.1.0). Su licencia MIT está incluida junto al módulo en `resources/app.asar`. |
| Roboto | [Proyecto Roboto](https://github.com/googlefonts/roboto-classic) con licencia SIL Open Font License. El aviso original está en `assets/Roboto-OFL.txt`, incluido en el paquete. El SHA-256 del WOFF2 distribuido es `1404ca348bd75ef836f4dd8b6f2cc719458642d1237c368296b2fc652dca47dc`. |
| NSIS 3.13 | El instalador usa el motor NSIS y compresión zlib. Incluye `LICENSE-NSIS.txt` en la carpeta de Pliego. [Código fuente y herramientas de NSIS 3.13](https://sourceforge.net/projects/nsis/files/NSIS%203/3.13/) · [Licencia de NSIS](https://nsis.sourceforge.io/License) |

Las URL y los SHA-256 que verifica la preparación de Electron, 7-Zip, Python y libtorrent están en [scripts/vendor.mjs](scripts/vendor.mjs). El árbol npm se fija mediante [package-lock.json](package-lock.json). El empaquetado deja `7z.exe` y `7z.dll` como archivos independientes, accesibles para reemplazo por compilaciones compatibles.
