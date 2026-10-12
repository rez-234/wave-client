; Uninstalling asks whether to remove the game data in %APPDATA%\WaveClient (worlds, profiles,
; mods, settings, signed-in accounts). The answer defaults to No. Nothing is asked or removed
; during an update or a silent uninstall, or for an install for all users: that uninstaller may
; run as another (administrator) account, and each player's data is in their own AppData.
!macro customUnInstall
  ${ifNot} ${isUpdated}
  ${andIfNot} ${Silent}
  ${andIf} $installMode == "CurrentUser"
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove your Wave Client game data?$\r$\n$\r$\nThis deletes your worlds, profiles, mods, settings and signed-in accounts in$\r$\n$APPDATA\WaveClient$\r$\n$\r$\nChoose No to keep them for a later reinstall." IDNO wave_keep_data
    RMDir /r "$APPDATA\WaveClient"
    wave_keep_data:
  ${endIf}
!macroend
