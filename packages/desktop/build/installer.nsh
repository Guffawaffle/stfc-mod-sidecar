!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var StfcDeveloperModeCheckbox
Var StfcDeveloperModeState

!macro customPageAfterChangeDir
  Page custom StfcCompanionModePage StfcCompanionModePageLeave
!macroend

Function StfcCompanionModePage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 26u "Choose the initial companion experience. This can be changed later in Settings."
  Pop $0

  ${NSD_CreateCheckbox} 0 38u 100% 20u "Enable Developer Tools on first launch"
  Pop $StfcDeveloperModeCheckbox
  ${If} $StfcDeveloperModeState == "1"
    ${NSD_Check} $StfcDeveloperModeCheckbox
  ${EndIf}

  ${NSD_CreateLabel} 0 68u 100% 34u "Standard Companion is recommended. Developer Tools exposes raw event and replay surfaces for maintainers."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function StfcCompanionModePageLeave
  ${NSD_GetState} $StfcDeveloperModeCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $StfcDeveloperModeState "1"
  ${Else}
    StrCpy $StfcDeveloperModeState "0"
  ${EndIf}
FunctionEnd

!macro customInstall
  CreateDirectory "$INSTDIR\resources"
  FileOpen $0 "$INSTDIR\resources\desktop-initial-settings.json" w
  ${If} $StfcDeveloperModeState == "1"
    FileWrite $0 '{"developerMode":true}$\r$\n'
  ${Else}
    FileWrite $0 '{"developerMode":false}$\r$\n'
  ${EndIf}
  FileClose $0
!macroend
!endif