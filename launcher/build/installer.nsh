; Uninstalling asks whether to remove the game data in %APPDATA%\WaveClient (worlds, profiles,
; mods, settings, signed-in accounts). The answer defaults to No, and nothing is asked or removed
; during an update or a silent uninstall.
!macro customUnInstall
  ${ifNot} ${isUpdated}
  ${andIfNot} ${Silent}
    ; The launcher keeps its data in the user's own AppData, also after an install for all users.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove your Wave Client game data?$\r$\n$\r$\nThis deletes your worlds, profiles, mods, settings and signed-in accounts in$\r$\n$APPDATA\WaveClient$\r$\n$\r$\nChoose No to keep them for a later reinstall." IDNO wave_keep_data
    RMDir /r "$APPDATA\WaveClient"
    wave_keep_data:
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endIf}
!macroend
