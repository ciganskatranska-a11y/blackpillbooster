; Tiny web installer: downloads the newest Blackpill Booster Setup.exe from
; GitHub Releases, installs it silently and launches the app.
; Built and attached to every release by .github/workflows/release.yml.

Unicode true
!define SETUP_URL "https://github.com/ciganskatranska-a11y/blackpillbooster/releases/latest/download/Blackpill-Booster-Setup.exe"
!ifndef OUTFILE
	!define OUTFILE "..\dist\Blackpill-Booster-Installer.exe"
!endif

Name "Blackpill Booster"
Caption "Blackpill Booster Installer"
OutFile "${OUTFILE}"
Icon "icon.ico"
RequestExecutionLevel admin
ShowInstDetails show
AutoCloseWindow true
SetCompressor /SOLID lzma
BrandingText "Blackpill Booster"

Page instfiles

Section
	InitPluginsDir
	StrCpy $1 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
	IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
	StrCpy $1 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"

	DetailPrint "Downloading the latest Blackpill Booster..."
	nsExec::ExecToLog `"$1" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$ErrorActionPreference='Stop'; $$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '${SETUP_URL}' -OutFile '$PLUGINSDIR\setup.exe'"`
	Pop $0
	StrCmp $0 "0" 0 failed
	IfFileExists "$PLUGINSDIR\setup.exe" 0 failed

	DetailPrint "Installing (this also sets up the VB-CABLE audio driver)..."
	ExecWait `"$PLUGINSDIR\setup.exe" /S --force-run` $0
	StrCmp $0 "0" 0 installFailed
	DetailPrint "Done. Blackpill Booster is starting."
	Sleep 1500
	Return

	failed:
		MessageBox MB_ICONSTOP "Could not download Blackpill Booster. Check your internet connection and try again."
		Abort
	installFailed:
		MessageBox MB_ICONSTOP "The Blackpill Booster installer failed (code $0)."
		Abort
SectionEnd
