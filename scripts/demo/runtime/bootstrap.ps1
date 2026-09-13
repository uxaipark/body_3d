param(
 [ValidateSet('install','start','verify')][string]$Action = 'start',
 [ValidateRange(1024,65535)][int]$Port = 3000,
 [string]$BindHost = '127.0.0.1'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
 if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Use the macOS/Linux launcher on this operating system.' }
 if ([Environment]::OSVersion.Version.Build -lt 22000) { throw 'SOMA requires Windows 11 or newer.' }
 $SomaRoot = Split-Path -Parent $PSScriptRoot
 $SomaVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-version.txt') -Raw).Trim()
 # workerd currently ships a Windows x64 binary; Windows ARM64 uses x64 emulation.
 $SomaName = "node-$SomaVersion-win-x64"
 $SomaRuntime = Join-Path $SomaRoot '.runtime'
 $SomaNode = Join-Path $SomaRuntime "$SomaName/node.exe"
 $SomaValid = $false
 if (Test-Path -LiteralPath $SomaNode) { $SomaValid = ((& $SomaNode --version) -eq $SomaVersion) }
 if (-not $SomaValid) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  New-Item -ItemType Directory -Force -Path $SomaRuntime | Out-Null
  $SomaTemp = Join-Path $SomaRuntime ('download.' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $SomaTemp | Out-Null
  try {
   $SomaFile = "$SomaName.zip"
   $SomaArchive = Join-Path $SomaTemp $SomaFile
   Write-Host "Installing isolated Node.js $SomaVersion (Windows x64)..."
   Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/download/release/$SomaVersion/$SomaFile" -OutFile $SomaArchive -TimeoutSec 600
   $SomaLine = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-shasums.txt') | Where-Object { ($_ -split '\s+')[1] -eq $SomaFile }
   if (-not $SomaLine) { throw 'Missing Node.js checksum.' }
   $SomaExpected = ($SomaLine -split '\s+')[0]
   if ((Get-FileHash -LiteralPath $SomaArchive -Algorithm SHA256).Hash -ne $SomaExpected) { throw 'Node.js SHA-256 mismatch; installation stopped.' }
   Expand-Archive -LiteralPath $SomaArchive -DestinationPath $SomaTemp
   $SomaExtracted = Join-Path $SomaTemp $SomaName
   & (Join-Path $SomaExtracted 'node.exe') --version
   if ($LASTEXITCODE -ne 0) { throw 'The downloaded Node.js runtime could not run.' }
   $SomaDestination = Join-Path $SomaRuntime $SomaName
   if (Test-Path -LiteralPath $SomaDestination) { Remove-Item -LiteralPath $SomaDestination -Recurse -Force }
   Move-Item -LiteralPath $SomaExtracted -Destination $SomaDestination
  } finally { Remove-Item -LiteralPath $SomaTemp -Recurse -Force }
 }
 $env:PATH = (Split-Path -Parent $SomaNode) + [IO.Path]::PathSeparator + $env:PATH
 & $SomaNode (Join-Path $PSScriptRoot 'runner.mjs') $Action '--port' $Port '--host' $BindHost
 exit $LASTEXITCODE
} catch {
 [Console]::Error.WriteLine($_.Exception.Message)
 exit 1
}
