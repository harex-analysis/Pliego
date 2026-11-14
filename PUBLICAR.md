# Publicar Pliego en GitHub

## Verificación antes de subir

1. Abre la terminal en la carpeta del proyecto, donde está `package.json`. Si estás en CMD y partes de otra unidad, usa `cd /d "Z:\Programa de comics"` para esta copia del proyecto. Comprueba la ruta con `dir package.json` y la versión con `node -v`. Para compilar necesitas Windows x64 y Node.js 22.12 o posterior.
2. Para generar un ZIP nuevo, ejecuta `npm ci`, `npm run setup:win` y `npm run test:win`. Cierra Pliego y ejecuta `npm run release:win`. Verifica que el ZIP se extraiga y que Pliego abra un CBZ con un perfil de prueba. Si ya tienes los archivos de la versión en `dist/release`, puedes usar esos archivos después de comprobar sus hashes.
3. Revisa `git status --short`, `git ls-files` y `git diff --check`. El proyecto lleva código, licencias, demo y pruebas. Los paquetes generados se guardan en `dist/release`. Comprueba que quedaron fuera cómics, datos de lectura, credenciales y binarios preparados para compilación.

## Repositorio y lanzamiento

1. El código está preparado en el índice local de Git. Antes del primer commit, configura el nombre y el correo que quieres mostrar en el historial. Puedes usar el correo noreply que aparece en **Settings → Emails** en GitHub.
2. Crea un repositorio público vacío en tu cuenta de GitHub, configura su URL real como remoto `origin` y sube `main`.
3. Comprueba que pasa el flujo Windows de GitHub Actions. Habilita alertas de Dependabot y los reportes privados de seguridad. Configura protección básica de la rama principal según tu flujo de mantenimiento.
4. Crea el tag `v1.9.1` sobre el commit verificado. Abre una Release marcada como **pre-release**, usa [las notas de esta versión](RELEASE-NOTES.md) y adjunta los tres archivos de `dist/release`:
   - `Pliego-1.9.1-windows-x64.zip`
   - `SHA256SUMS.txt`
   - `7z2606-src.7z`
5. Descarga el ZIP desde la página pública y comprueba su SHA-256 con `Get-FileHash -Algorithm SHA256 .\Pliego-1.9.1-windows-x64.zip`. Extrae el paquete en Windows 11 x64 limpio y prueba añadir y leer un archivo de ejemplo. La beta actual va sin firma. Si se firma el ejecutable, vuelve a generar el ZIP y su hash después de firmar.

Las Releases proporcionan el ZIP para lectores. El código fuente y el historial quedan en Git. [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) · [Reportes privados de seguridad](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
