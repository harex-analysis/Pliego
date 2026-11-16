# Publicar Pliego en GitHub

## Verificación antes de subir

1. Abre la terminal en la carpeta del proyecto, donde está `package.json`. Para compilar necesitas Windows x64 y Node.js 22.12 o posterior. Comprueba la ruta con `dir package.json` y la versión con `node -v`.
2. Revisa `git status --short`, `git ls-files` y `git diff --check`. El proyecto lleva código, licencias, demo y pruebas. Comprueba que quedaron fuera cómics, datos de lectura, credenciales y binarios preparados para compilación. Revisa que el autor de los commits nuevos use el correo `noreply` de GitHub.
3. Desde el commit de la versión, ejecuta `npm ci --ignore-scripts`, `npm audit --audit-level=high`, `npm run setup:win` y `npm run test:win`. Cierra Pliego y ejecuta `npm run release:win`. Los paquetes quedan en `dist/release/v1.12.0`. En una cuenta sin Pliego instalado, comprueba la instalación con `./tests/installer.ps1 -Installer ./dist/release/v1.12.0/Pliego-Setup-x64.exe`.

## Ajustes del repositorio

- En **Settings → Advanced Security**, revisa el reporte privado de vulnerabilidades, las alertas de Dependabot, Secret Scanning y Push Protection. Comprueba desde el repositorio público que aparece **Report a vulnerability**. [Reportes privados de GitHub](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) · [Protección de secretos al subir cambios](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)
- En **Settings → General → Releases**, habilita la inmutabilidad si está disponible. Adjunta y comprueba todos los archivos desde el borrador antes de publicar. [Inmutabilidad de GitHub Releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)

## Repositorio y lanzamiento

1. Sube el tag `v1.12.0` y comprueba que apunta al commit de la versión. Revisa el flujo **Windows x64** en esa referencia y descarga sus artefactos en [GitHub Actions](https://github.com/harex-analysis/Pliego/actions).
2. Prepara una Release como borrador, márcala **pre-release** y adjunta [las notas de esta versión](RELEASE-NOTES.md) y los cuatro archivos de la misma compilación. Verifica los SHA-256 antes de publicar.
   - `Pliego-Setup-x64.exe`
   - `Pliego-1.12.0-windows-x64.zip`
   - `SHA256SUMS.txt`
   - `7z2606-src.7z`
3. Publica la Release y sube `main`. Abre el enlace **Descargar Pliego** del README y comprueba que entrega el instalador. Verifica su SHA-256 con `Get-FileHash -Algorithm SHA256 .\Pliego-Setup-x64.exe`. Para la descarga dentro de Pliego, comprueba que GitHub marque la Release como inmutable y que indique el tamaño y el SHA-256 del archivo `Pliego-Setup-x64.exe`. Actualiza las URLs y el número de versión en estas instrucciones para la versión siguiente.

La beta va sin firma Authenticode. Si firmas el instalador o el ejecutable de Pliego, genera de nuevo el paquete correspondiente y las sumas después de firmar. [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

La compilación de Python incluye OpenSSL 3.5.9. Revisa el siguiente paquete oficial de Astral para incorporar las correcciones de baja severidad de OpenSSL 3.5.10. [Compilaciones oficiales de Astral](https://github.com/astral-sh/python-build-standalone/releases) · [Avisos de OpenSSL 3.5](https://openssl-library.org/news/vulnerabilities-3.5/)
