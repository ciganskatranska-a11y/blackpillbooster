$ErrorActionPreference = "Stop"

# Wraps dist\blackpill-booster-core.exe (electron-builder NSIS output) in the styled setup
# window and writes dist\Blackpill-Booster-Setup.exe plus a matching dist\latest.yml.

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$core = Join-Path $dist "blackpill-booster-core.exe"
$stub = Join-Path $dist "setup-stub.exe"
$output = Join-Path $dist "Blackpill-Booster-Setup.exe"
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
if (-not (Test-Path $core)) { throw "Missing $core. Run npm run dist first." }

$buildInfo = Join-Path $dist "BuildInfo.cs"
Set-Content -Path $buildInfo -Encoding UTF8 -Value "static class BuildInfo { public const string Version = `"$version`"; }"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$stub" "/win32icon:$(Join-Path $root 'build\icon.ico')" /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $PSScriptRoot "Setup.cs") $buildInfo
if ($LASTEXITCODE) { throw "csc failed with code $LASTEXITCODE" }

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
Remove-Item $stub, $buildInfo

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
