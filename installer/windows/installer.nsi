; KNIME Agent Bridge per-user Windows installer (x64). Built by scripts/build-installer.mjs:
;   makensis -DVERSION=0.6.0 -DSTAGE=<build/installer> -DOUTFILE=<exe> installer.nsi
; The installer only copies files and shows pages. Every change outside its own folder is
; made by setup\setup.mjs with the bundled Node, and recorded in install.json for uninstall.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "Sections.nsh"
!include "x64.nsh"

!define PRODUCT "KNIME Agent Bridge"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnimeAgentBridge"
!define NODE '"$INSTDIR\node\node.exe"'
!define SETUP '"$INSTDIR\setup\setup.mjs"'

Name "${PRODUCT} ${VERSION}"
OutFile "${OUTFILE}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\KnimeAgentBridge"
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
BrandingText "${PRODUCT} ${VERSION}, a community project not made by KNIME AG"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${PRODUCT} Setup"
VIAddVersionKey "CompanyName" "KNIME Agent Bridge contributors"
VIAddVersionKey "LegalCopyright" "Copyright (C) 2026 KNIME Agent Bridge contributors"

Var KnimeDir

; Codex and the ChatGPT app run the MCP server with node\node.exe; Windows cannot replace or
; delete it while they do. SETUP is the setup.mjs to run with the installed node.exe.
!macro EnsureNodeFree SETUP
  ${If} ${FileExists} "$INSTDIR\node\node.exe"
    nodecheck:
    nsExec::ExecToLog '"$INSTDIR\node\node.exe" "${SETUP}" node-in-use --root "$INSTDIR"'
    Pop $0
    ${If} $0 == 3
      MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "The KNIME Agent Bridge is still in use, so its files cannot be replaced or removed. The programs using it are listed in the log.$\r$\n$\r$\nClose Codex and the ChatGPT app, and any open connection check window, then click Retry.$\r$\n$\r$\nClick Ignore to stop those processes now. Their KNIME connection ends until you restart them." IDRETRY nodecheck IDIGNORE nodestop
      Abort
      nodestop:
      nsExec::ExecToLog '"$INSTDIR\node\node.exe" "${SETUP}" node-in-use --stop --root "$INSTDIR"'
      Pop $0
      ${If} $0 == 3
        Goto nodecheck
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Set up the ${PRODUCT}"
!define MUI_WELCOMEPAGE_TEXT "This lets AI assistants (Claude Desktop, ChatGPT and Codex) read and edit the workflows open in KNIME on this computer.$\r$\n$\r$\nSetup will:$\r$\n  - add the Agent Bridge extension to KNIME$\r$\n  - connect Codex and the ChatGPT desktop app$\r$\n  - open the Claude Desktop install dialog$\r$\n$\r$\nEverything stays on this computer. Close KNIME before you continue.$\r$\n$\r$\nThis is a community project, not made or supported by KNIME AG."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS

!define MUI_PAGE_CUSTOMFUNCTION_PRE KnimePagePre
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE KnimePageLeave
!define MUI_DIRECTORYPAGE_VARIABLE $KnimeDir
!define MUI_PAGE_HEADER_TEXT "Choose your KNIME installation"
!define MUI_PAGE_HEADER_SUBTEXT "The extension is added to this KNIME."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Setup found the folder below. If KNIME is installed somewhere else, choose the folder that contains knime.exe."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "KNIME folder"
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "Setup is done"
!define MUI_FINISHPAGE_TEXT "Start KNIME, open a workflow, then ask your assistant about it.$\r$\n$\r$\nCodex and ChatGPT: use a Codex task (normal ChatGPT chats cannot see local tools).$\r$\nClaude Desktop: click Install in the dialog Claude showed.$\r$\n$\r$\nYou can run the connection check again from the Start menu."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start KNIME and check the connection"
!define MUI_FINISHPAGE_RUN_FUNCTION RunCheck
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "-Files" SecFiles
  ; An earlier install's node.exe runs this version's check, copied out first.
  ${If} ${FileExists} "$INSTDIR\node\node.exe"
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File "${STAGE}/setup/setup.mjs"
    !insertmacro EnsureNodeFree "$PLUGINSDIR\setup.mjs"
  ${EndIf}
  SetOutPath "$INSTDIR"
  ; Replace the server and setup wholesale so no stale files survive an upgrade.
  RMDir /r "$INSTDIR\server"
  RMDir /r "$INSTDIR\setup"
  RMDir /r "$INSTDIR\payload"
  File /r "${STAGE}/node"
  File /r "${STAGE}/server"
  File /r "${STAGE}/setup"
  File /r "${STAGE}/payload"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\${PRODUCT}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT}\Check the KNIME connection.lnk" "$INSTDIR\node\node.exe" '${SETUP} check --start --pause'
  CreateShortCut "$SMPROGRAMS\${PRODUCT}\Uninstall ${PRODUCT}.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "KNIME Agent Bridge contributors"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/juniper234/knime-agent-bridge"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "KNIME extension" SecKnime
  WriteRegStr HKCU "${UNINSTALL_KEY}" "KnimeDir" "$KnimeDir"
  retry:
  nsExec::Exec '${NODE} ${SETUP} knime-running'
  Pop $0
  ${If} $0 == 2
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "KNIME is running. Save your work, close KNIME, then click Retry." IDRETRY retry
    DetailPrint "Skipped the KNIME extension because KNIME was still running. Run Setup again to add it."
    Goto done
  ${EndIf}
  nsExec::ExecToLog '${NODE} ${SETUP} install --extension --knime "$KnimeDir"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "The KNIME extension could not be added. The reason is in the log."
  ${EndIf}
  done:
SectionEnd

Section "ChatGPT and Codex" SecCodex
  nsExec::ExecToLog '${NODE} ${SETUP} install --codex --knime "$KnimeDir"'
  Pop $0
SectionEnd

Section "Claude Desktop" SecClaude
  nsExec::ExecToLog '${NODE} ${SETUP} install --claude'
  Pop $0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecKnime} "Adds the Agent Bridge to KNIME so assistants can reach it. KNIME must be closed."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecCodex} "Lets Codex, and Codex tasks in the ChatGPT desktop app, use KNIME."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecClaude} "Opens the Claude Desktop install dialog for the KNIME extension. Needs Claude Desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${PRODUCT} needs 64-bit Windows."
    Abort
  ${EndIf}
  ReadRegStr $KnimeDir HKCU "${UNINSTALL_KEY}" "KnimeDir"
  ${If} $KnimeDir == ""
  ${OrIfNot} ${FileExists} "$KnimeDir\knime.exe"
    StrCpy $KnimeDir "$LOCALAPPDATA\Programs\KNIME"
  ${EndIf}
  ${IfNot} ${FileExists} "$KnimeDir\knime.exe"
  ${AndIf} ${FileExists} "$PROGRAMFILES64\KNIME\knime.exe"
    StrCpy $KnimeDir "$PROGRAMFILES64\KNIME"
  ${EndIf}
  ; Claude Desktop registers the .mcpb file type; without it, leave that part unticked.
  ReadRegStr $0 HKCR ".mcpb" ""
  ${If} $0 == ""
    !insertmacro UnselectSection ${SecClaude}
  ${EndIf}
FunctionEnd

Function KnimePagePre
  ${IfNot} ${SectionIsSelected} ${SecKnime}
    Abort
  ${EndIf}
FunctionEnd

Function KnimePageLeave
  ${IfNot} ${FileExists} "$KnimeDir\knime.exe"
    MessageBox MB_ICONEXCLAMATION "There is no knime.exe in $KnimeDir. Choose the folder where KNIME is installed."
    Abort
  ${EndIf}
FunctionEnd

Function RunCheck
  Exec '${NODE} ${SETUP} check --start --pause --knime "$KnimeDir"'
FunctionEnd

Section "Uninstall"
  ; Only remove a folder that really is this installer's folder.
  ${IfNot} ${FileExists} "$INSTDIR\setup\setup.mjs"
    MessageBox MB_ICONSTOP "$INSTDIR does not look like a ${PRODUCT} folder. Nothing was removed."
    Abort
  ${EndIf}
  retry:
  nsExec::Exec '${NODE} ${SETUP} knime-running'
  Pop $0
  ${If} $0 == 2
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "KNIME is running. Save your work, close KNIME, then click Retry." IDRETRY retry
    Abort
  ${EndIf}
  !insertmacro EnsureNodeFree "$INSTDIR\setup\setup.mjs"
  nsExec::ExecToLog '${NODE} ${SETUP} uninstall'
  Pop $0
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\server"
  RMDir /r "$INSTDIR\setup"
  RMDir /r "$INSTDIR\payload"
  Delete "$INSTDIR\install.json"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  ${If} ${FileExists} "$INSTDIR\*.*"
    MessageBox MB_ICONEXCLAMATION "Some files in $INSTDIR are still in use and were left there. Delete that folder after closing the programs that use it."
  ${EndIf}
  RMDir /r "$SMPROGRAMS\${PRODUCT}"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
