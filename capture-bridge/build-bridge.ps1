#Requires -Version 5.1
param(
  [switch]$Spike,
  [string]$SourceId = ""
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Project = Join-Path $Root "GridironCaptureBridge"
$Dist = Join-Path $Root "dist"

Push-Location $Project
try {
  dotnet publish -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $Dist
  if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }
}
finally {
  Pop-Location
}

$exe = Join-Path $Dist "GridironCaptureBridge.exe"
if (-not (Test-Path $exe)) { throw "Missing $exe" }
Write-Host "Published: $exe"

if ($Spike) {
  $args = @("--spike")
  if ($SourceId) { $args += $SourceId }
  & $exe @args
  exit $LASTEXITCODE
}
