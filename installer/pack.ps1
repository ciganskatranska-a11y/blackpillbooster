param(
	# "stub": compile installer\Setup.cs to build-stub\Blackpill Booster Uninstaller.exe (run BEFORE npm run dist,
	#         electron-builder ships it in the install folder as the uninstaller).
	# "wrap": append dist\blackpill-booster-core.exe to that exe -> dist\Blackpill-Booster-Setup.exe + dist\latest.yml.
	[ValidateSet("stub", "wrap")][string]$Stage = "wrap"
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$stubDir = Join-Path $root "build-stub"
$stub = Join-Path $stubDir "Blackpill Booster Uninstaller.exe"
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version

if ($Stage -eq "stub") {
	New-Item -ItemType Directory -Force $stubDir | Out-Null
	$buildInfo = Join-Path $stubDir "BuildInfo.cs"
	Set-Content -Path $buildInfo -Encoding UTF8 -Value "static class BuildInfo { public const string Version = `"$version`"; }"
	$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
	& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$stub" "/win32icon:$(Join-Path $root 'build\icon.ico')" /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $PSScriptRoot "Setup.cs") $buildInfo
	if ($LASTEXITCODE) { throw "csc failed with code $LASTEXITCODE" }
	Remove-Item $buildInfo
	Write-Output "Built $stub for v$version"
	exit 0
}

$core = Join-Path $dist "blackpill-booster-core.exe"
$output = Join-Path $dist "Blackpill-Booster-Setup.exe"
if (-not (Test-Path $core)) { throw "Missing $core. Run npm run dist first." }
if (-not (Test-Path $stub)) { throw "Missing $stub. Run pack.ps1 -Stage stub first." }

$out = [IO.File]::Create($output)
try {
	foreach ($part in @($stub, $core)) {
		$in = [IO.File]::OpenRead($part)
		try { $in.CopyTo($out) } finally { $in.Dispose() }
	}
	$length = (Get-Item $core).Length
	$trailer = [BitConverter]::GetBytes([long]$length) + [Text.Encoding]::ASCII.GetBytes("BPBOOST1")
	$out.Write($trailer, 0, $trailer.Length)
} finally {
	$out.Dispose()
}

$sha = [IO.File]::OpenRead($output)
try { $hash = [Convert]::ToBase64String([Security.Cryptography.SHA512]::Create().ComputeHash($sha)) } finally { $sha.Dispose() }
$size = (Get-Item $output).Length
$date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$yml = @"
version: $version
files:
  - url: Blackpill-Booster-Setup.exe
    sha512: $hash
    size: $size
path: Blackpill-Booster-Setup.exe
sha512: $hash
releaseDate: '$date'
"@
[IO.File]::WriteAllText((Join-Path $dist "latest.yml"), $yml.Replace("`r`n", "`n") + "`n")
Write-Output "Built $output ($size bytes) and latest.yml for v$version"
