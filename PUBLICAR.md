# Publicar Pliego en GitHub

## Verificación antes de subir

1. Abre la terminal en la carpeta del proyecto, donde está `package.json`. Para compilar necesitas Windows x64 y Node.js 22.12 o posterior. Comprueba la ruta con `dir package.json` y la versión con `node -v`.
2. Para generar una versión, ejecuta `npm ci`, `npm run setup:win` y `npm run test:win`. Cierra Pliego y ejecuta `npm run release:win`. En una cuenta sin Pliego instalado, prueba el instalador con `./tests/installer.ps1 -Installer ./dist/release/v1.10.0/Pliego-Setup-x64.exe`.
3. Revisa `git status --short`, `git ls-files` y `git diff --check`. El proyecto lleva código, licencias, demo y pruebas. Los paquetes generados se guardan en `dist/release/v1.10.0`. Comprueba que quedaron fuera cómics, datos de lectura, credenciales y binarios preparados para compilación.

## Repositorio y lanzamiento

1. Crea el tag `v1.10.0` sobre el commit de la versión. Sube el tag al [repositorio de Pliego](https://github.com/harex-analysis/Pliego) y verifica el flujo Windows de [GitHub Actions](https://github.com/harex-analysis/Pliego/actions) sobre ese commit.
2. Abre una Release marcada como **pre-release**, usa [las notas de esta versión](RELEASE-NOTES.md) y adjunta los cuatro archivos de `dist/release/v1.10.0`:
   - `Pliego-Setup-x64.exe`
   - `Pliego-1.10.0-windows-x64.zip`
   - `SHA256SUMS.txt`
   - `7z2606-src.7z`
3. Publica la Release y sube `main`. Abre el enlace **Descargar Pliego** del README y comprueba que entrega el instalador. Verifica su SHA-256 con `Get-FileHash -Algorithm SHA256 .\Pliego-Setup-x64.exe`. Actualiza las URLs y el número de versión en estas instrucciones para la versión siguiente.

La beta va sin firma Authenticode. Si firmas el instalador o el ejecutable de Pliego, genera de nuevo el paquete correspondiente y las sumas después de firmar. [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) · [Reportes privados de seguridad](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
