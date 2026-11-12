!macro customInstall
	DetailPrint "Downloading and installing VB-CABLE from vb-audio.com"
	DetailPrint "Click Install if Windows asks about device software"
	StrCpy $1 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
	IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
	StrCpy $1 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
	nsExec::ExecToLog '"$1" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\app\install-cable.ps1"'
	Pop $0
!macroend
