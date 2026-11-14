Unicode true
!include "MUI2.nsh"
!include "x64.nsh"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Pliego"

Name "Pliego"
OutFile "$%PLIEGO_INSTALLER_FILE%"
InstallDir "$LOCALAPPDATA\Programs\Pliego"
RequestExecutionLevel user
SetCompressor /SOLID zlib
CRCCheck force
BrandingText "Pliego · Harex"
VIProductVersion "$%PLIEGO_VERSION%.0"
VIAddVersionKey /LANG=3082 "ProductName" "Pliego"
VIAddVersionKey /LANG=3082 "FileDescription" "Instalador de Pliego"
VIAddVersionKey /LANG=3082 "FileVersion" "$%PLIEGO_VERSION%"
VIAddVersionKey /LANG=3082 "ProductVersion" "$%PLIEGO_VERSION%"
VIAddVersionKey /LANG=3082 "CompanyName" "Harex"
VIAddVersionKey /LANG=3082 "LegalCopyright" "© 2026 Harex"

!define MUI_ICON "$%PLIEGO_ICON%"
!define MUI_UNICON "$%PLIEGO_ICON%"
!define MUI_WELCOMEPAGE_TITLE "Instalar Pliego"
!define MUI_WELCOMEPAGE_TEXT "Instala Pliego y todos los componentes necesarios para leer cómics y manga.$\r$\n$\r$\nDespués podrás abrir Pliego desde el menú Inicio."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchPliego
!define MUI_FINISHPAGE_RUN_TEXT "Abrir Pliego"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SpanishInternational"

Function .onInit
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Pliego requiere Windows de 64 bits." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}

  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 != ""
  ${AndIf} $0 != $INSTDIR
    MessageBox MB_ICONSTOP "Pliego ya está instalado en otra carpeta. Desinstálalo desde Configuración de Windows y vuelve a intentarlo." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
  ${If} $0 == ""
    IfFileExists "$INSTDIR\*.*" 0 +4
    MessageBox MB_ICONSTOP "La carpeta de destino ya existe. Puedes moverla y volver a ejecutar el instalador." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
FunctionEnd

Function LaunchPliego
  SetOutPath "$INSTDIR"
  Exec '"$INSTDIR\Pliego.exe"'
FunctionEnd

Section "Pliego"
  SetOverwrite on
  IfFileExists "$INSTDIR\Pliego.exe" 0 canInstall
  ClearErrors
  FileOpen $1 "$INSTDIR\Pliego.exe" a
  IfErrors installFailed
  FileClose $1
canInstall:
  ClearErrors
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  IfErrors installFailed
  SetOutPath "$INSTDIR"
  File "$%PLIEGO_APP_DIR%\Pliego.exe"
  IfErrors installFailed
  File /r /x Pliego.exe "$%PLIEGO_APP_DIR%\*"
  IfErrors installFailed
  WriteUninstaller "$INSTDIR\Desinstalar Pliego.exe"
  IfErrors installFailed
  CreateShortcut "$SMPROGRAMS\Pliego.lnk" "$INSTDIR\Pliego.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Pliego"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "$%PLIEGO_VERSION%"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Harex"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Pliego.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Desinstalar Pliego.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Desinstalar Pliego.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  IfErrors installFailed
  Goto done

installFailed:
  MessageBox MB_ICONSTOP "No se pudo completar la instalación. Cierra Pliego y vuelve a intentarlo." /SD IDOK
  SetErrorLevel 1
  Quit
done:
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
FunctionEnd

Section "Uninstall"
  ClearErrors
  Delete "$INSTDIR\Pliego.exe"
  IfErrors uninstallFailed
  !include "$%PLIEGO_REMOVE_FILES%"
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    Delete "$SMPROGRAMS\Pliego.lnk"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ${EndIf}
  Delete "$INSTDIR\Desinstalar Pliego.exe"
  SetOutPath "$TEMP"
  RMDir "$INSTDIR"
  Goto done

uninstallFailed:
  MessageBox MB_ICONSTOP "Cierra Pliego antes de desinstalarlo y vuelve a intentarlo." /SD IDOK
  SetErrorLevel 1
  Quit
done:
SectionEnd
