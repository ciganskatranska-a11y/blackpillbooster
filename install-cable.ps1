$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$work = Join-Path $env:TEMP "blackpill-cable"
$log = Join-Path $work "install.log"

function Write-Step([string]$Text) {
	Write-Output $Text
	Add-Content -Path $log -Value $Text
}

function Test-Cable {
	return [bool](Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*VB-Audio*" })
}

function Invoke-Devices([string[]]$Arguments) {
	$output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $here "devices.ps1") @Arguments
	return ($output | Select-Object -Last 1 | ConvertFrom-Json)
}

try {
	Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
	New-Item -ItemType Directory -Path $work -Force | Out-Null

	if (Test-Cable) {
		Write-Step "VB-CABLE is already installed."
		exit 0
	}

	$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
	if (-not $isAdmin) {
		Write-Step "Asking Windows for permission to install the VB-CABLE driver."
		$elevated = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$PSCommandPath`"" -Verb RunAs -Wait -PassThru
		exit $elevated.ExitCode
	}

	$before = $null
	try {
		$before = Invoke-Devices @("list")
	} catch {
		$before = $null
	}

	[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
	$links = @()
	try {
		$page = Invoke-WebRequest -Uri "https://vb-audio.com/Cable/" -UseBasicParsing
		$links = @([regex]::Matches($page.Content, "https://download\.vb-audio\.com/Download_CABLE/VBCABLE_Driver_Pack(\d+)\.zip") | Sort-Object { [int]$_.Groups[1].Value } -Descending | ForEach-Object { $_.Value } | Select-Object -Unique)
	} catch {
		$links = @()
	}
	$links += "https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack46.zip"
	$links += "https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip"

	$zip = Join-Path $work "cable.zip"
	$isDownloaded = $false
	foreach ($link in $links) {
		try {
			Write-Step "Downloading $link"
			Invoke-WebRequest -Uri $link -OutFile $zip -UseBasicParsing
			$isDownloaded = $true
			break
		} catch {
			$isDownloaded = $false
		}
	}
	if (-not $isDownloaded) { throw "Could not download VB-CABLE from vb-audio.com. Check the internet connection." }

	Expand-Archive -Path $zip -DestinationPath (Join-Path $work "pack") -Force
	$setup = Get-ChildItem -Path (Join-Path $work "pack") -Recurse -Filter "VBCABLE_Setup_x64.exe" | Select-Object -First 1
	if (-not $setup) { throw "The VB-CABLE package did not contain the 64-bit setup." }

	$signature = Get-AuthenticodeSignature -FilePath $setup.FullName
	if ($signature.Status -ne "Valid") { throw "The VB-CABLE setup is not correctly signed, so it was not run." }

	Write-Step "Installing the driver. Click Install if Windows asks about device software."
	$process = Start-Process -FilePath $setup.FullName -ArgumentList "-i", "-h" -WorkingDirectory $setup.DirectoryName -Wait -PassThru
	Write-Step "Setup finished with code $($process.ExitCode)."

	$isFound = $false
	for ($attempt = 0; $attempt -lt 20; $attempt++) {
		if (Test-Cable) {
			$isFound = $true
			break
		}
		Start-Sleep -Seconds 1
	}

	Start-Sleep -Seconds 3
	if ($before) {
		try {
			$after = Invoke-Devices @("list")
			if ($before.default -and $after.default -ne $before.default) {
				Invoke-Devices @("setall", $before.default) | Out-Null
				Write-Step "Kept your speakers as the Windows output."
			}
			if ($before.defaultCapture -and $after.defaultCapture -ne $before.defaultCapture) {
				Invoke-Devices @("setall", $before.defaultCapture) | Out-Null
				Write-Step "Kept your microphone as the Windows input."
			}
		} catch {
			Write-Step "Could not check the default devices."
		}
	}

	if (-not $isFound) {
		Write-Step "The driver was not detected yet. Restart the PC."
		exit 2
	}
	Write-Step "VB-CABLE is installed."
	exit 0
} catch {
	Write-Step "$($_.Exception.Message)"
	exit 1
}
