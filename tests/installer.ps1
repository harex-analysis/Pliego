param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Pliego'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Pliego.lnk'
if ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $shortcut)) {
  throw 'La prueba de instalación necesita una cuenta sin una instalación previa de Pliego.'
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('pliego-setup-' + [guid]::NewGuid().ToString('N'))
$installed = Join-Path $work 'Pliego prueba'
$exe = Join-Path $installed 'Pliego.exe'
$uninstaller = Join-Path $installed 'Desinstalar Pliego.exe'
New-Item -ItemType Directory -Path $work | Out-Null

function Run-Installer([string]$Executable, [string]$Arguments) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "$Executable terminó con código $($process.ExitCode)." }
}

function Remove-TestInstallation {
  if (Test-Path -LiteralPath $uninstaller) {
    Run-Installer $uninstaller "/S _?=$installed"
    if (Test-Path -LiteralPath $uninstaller) { Remove-Item -LiteralPath $uninstaller -Force }
  } elseif ((Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).InstallLocation -eq $installed) {
    Remove-Item -LiteralPath $key -Force
  }
}

try {
  Run-Installer $Installer "/S /D=$installed"
  $registration = Get-ItemProperty -LiteralPath $key
  if ($registration.InstallLocation -ne $installed -or !(Test-Path -LiteralPath $shortcut)) {
    throw 'Falta el registro de desinstalación o el acceso directo del menú Inicio.'
  }
  $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  if ($registration.DisplayVersion -ne $version) { throw 'La versión instalada no coincide con el registro.' }
  $previousExe = $env:PLIEGO_TEST_EXE
  try {
    $env:PLIEGO_TEST_EXE = $exe
    node --test tests/windows.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Falló la prueba de lectura con Pliego instalado.' }
  } finally {
    $env:PLIEGO_TEST_EXE = $previousExe
  }

  $userFile = Join-Path $installed 'archivo-personal.txt'
  Set-Content -LiteralPath $userFile 'Conservar durante la actualización y desinstalación.'
  $locked = [IO.File]::Open($exe, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $runningUpdate = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installed" -Wait -PassThru -WindowStyle Hidden
    if ($runningUpdate.ExitCode -eq 0) { throw 'La actualización continuó a pesar de que el ejecutable estaba en uso.' }
  } finally {
    $locked.Dispose()
  }
  Run-Installer $Installer "/S /D=$installed"
  Remove-TestInstallation
  if ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $shortcut) -or
      (Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath $userFile)) {
    throw 'La desinstalación no limpió sus archivos o tocó un archivo ajeno.'
  }
  Write-Output "Pliego $version instalado, probado y desinstalado."
} finally {
  try { Remove-TestInstallation } finally {
    $resolved = (Resolve-Path -LiteralPath $work).Path
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase)) { throw 'Carpeta temporal inesperada.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
