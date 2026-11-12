; Replaces electron-builder's app-running check. The stock one launches PowerShell several times
; (slow) and kills every process whose exe is inside $INSTDIR, including an uninstaller running there.
; This one waits up to ~5 s for "Blackpill Booster.exe" to exit by itself, then force-kills it by name.
!macro customCheckAppRunning
	Push $0
	Push $1
	StrCpy $1 0
	bpWaitLoop:
		nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
		Pop $0
		StrCmp $0 "0" 0 bpNotRunning
		IntOp $1 $1 + 1
		IntCmp $1 7 bpKill 0 bpKill
		Sleep 500
		Goto bpWaitLoop
	bpKill:
		nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
		Pop $0
		Sleep 700
	bpNotRunning:
	Pop $1
	Pop $0
!macroend

!macro customInstall
	; VB-CABLE: only on a fresh install. Updates skip it (the app's Route tab can install it too).
	${ifNot} ${isUpdated}
		DetailPrint "Downloading and installing VB-CABLE from vb-audio.com"
		DetailPrint "Click Install if Windows asks about device software"
		StrCpy $1 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
		IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
		StrCpy $1 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
		nsExec::ExecToLog '"$1" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\app\install-cable.ps1"'
		Pop $0
	${endIf}

	; Windows "Uninstall" opens the styled uninstaller (installer/Setup.cs). The setup puts this back to the
	; NSIS uninstaller before every install/update, so the upgrade step never goes through the styled one.
	IfFileExists "$INSTDIR\Blackpill Booster Uninstaller.exe" 0 +2
	WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\Blackpill Booster Uninstaller.exe"'
!macroend
