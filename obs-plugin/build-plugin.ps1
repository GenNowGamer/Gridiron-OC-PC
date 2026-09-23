#Requires -Version 5.1
param(
  [string]$ObsInstall = "C:\Program Files\obs-studio",
  [string]$ObsTag = "32.2.2",
  [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Cache = Join-Path $Root ".cache"
$ObsSrc = Join-Path $Cache "obs-studio-$ObsTag"
$OutDir = Join-Path $Root "dist\64bit"
$LibDir = Join-Path $Cache "import-libs"
$DllName = "gridiron-ocr-capture.dll"
$OutDll = Join-Path $OutDir $DllName

# Reuse headers already downloaded under PC/.cache if present.
$LegacyCache = Join-Path (Split-Path -Parent $Root) ".cache\obs-studio-$ObsTag"
if (-not (Test-Path (Join-Path $ObsSrc "libobs\obs-module.h")) -and (Test-Path (Join-Path $LegacyCache "libobs\obs-module.h"))) {
  $ObsSrc = $LegacyCache
}

New-Item -ItemType Directory -Force -Path $Cache, $OutDir, $LibDir | Out-Null

function Find-VsDevCmd {
  $vswhereCandidates = @(
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
    "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
  )
  $vswhere = $vswhereCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $vswhere) { throw "vswhere.exe not found" }
  $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $install) {
    $install = "C:\Program Files\Microsoft Visual Studio\2022\Community"
  }
  $devcmd = Join-Path $install "Common7\Tools\VsDevCmd.bat"
  if (-not (Test-Path $devcmd)) { throw "VsDevCmd.bat not found at $devcmd" }
  return $devcmd
}

function Ensure-ObsHeaders {
  if ($SkipDownload -and (Test-Path (Join-Path $ObsSrc "libobs\obs-module.h"))) {
    Write-Host "Using cached OBS headers at $ObsSrc"
    return
  }
  if (Test-Path (Join-Path $ObsSrc "libobs\obs-module.h")) {
    Write-Host "OBS $ObsTag headers already cached"
    return
  }
  $zip = Join-Path $Cache "obs-studio-$ObsTag.zip"
  $url = "https://github.com/obsproject/obs-studio/archive/refs/tags/$ObsTag.zip"
  Write-Host "Downloading OBS $ObsTag source headers..."
  Invoke-WebRequest -Uri $url -OutFile $zip
  if (Test-Path $ObsSrc) { Remove-Item -Recurse -Force $ObsSrc }
  Expand-Archive -Path $zip -DestinationPath $Cache -Force
  $extracted = Join-Path $Cache "obs-studio-$ObsTag"
  if (-not (Test-Path $extracted)) {
    # GitHub zip extracts as obs-studio-<tag>
    $candidate = Get-ChildItem $Cache -Directory | Where-Object { $_.Name -like "obs-studio-*" } | Select-Object -First 1
    if ($candidate) { $script:ObsSrc = $candidate.FullName }
  }
  if (-not (Test-Path (Join-Path $ObsSrc "libobs\obs-module.h"))) {
    throw "Failed to extract OBS headers to $ObsSrc"
  }
}

function Ensure-ImportLib {
  param([string]$DevCmdPath)
  $obsDll = Join-Path $ObsInstall "bin\64bit\obs.dll"
  if (-not (Test-Path $obsDll)) { throw "obs.dll not found at $obsDll" }
  $defFile = Join-Path $LibDir "obs.def"
  $libFile = Join-Path $LibDir "obs.lib"
  $exportsFile = Join-Path $LibDir "obs-exports.txt"
  if (Test-Path $libFile) {
    Write-Host "Using cached obs.lib"
    return $libFile
  }
  Write-Host "Generating obs.lib from $obsDll"
  $dumpCmd = @(
    "call `"$DevCmdPath`" -arch=amd64 >nul"
    "dumpbin /EXPORTS `"$obsDll`" > `"$exportsFile`""
  ) -join " && "
  cmd /c $dumpCmd
  if ($LASTEXITCODE -ne 0) { throw "dumpbin failed with exit $LASTEXITCODE" }
  $exports = Get-Content $exportsFile | ForEach-Object {
    if ($_ -match '^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)') { $Matches[1] }
  } | Where-Object { $_ -and $_ -ne "[NONAME]" } | Select-Object -Unique
  if (-not $exports) { throw "dumpbin produced no exports for obs.dll" }
  @(
    "LIBRARY obs"
    "EXPORTS"
  ) + ($exports | ForEach-Object { "  $_" }) | Set-Content -Path $defFile -Encoding ASCII
  $libCmd = @(
    "call `"$DevCmdPath`" -arch=amd64 >nul"
    "lib /NOLOGO /MACHINE:X64 /DEF:`"$defFile`" /OUT:`"$libFile`""
  ) -join " && "
  cmd /c $libCmd
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $libFile)) { throw "Failed to create obs.lib" }
  return $libFile
}

$DevCmd = Find-VsDevCmd
Ensure-ObsHeaders
$ObsLib = Ensure-ImportLib -DevCmdPath $DevCmd

$IncludeDirs = @(
  (Join-Path $Root "include"),
  (Join-Path $ObsSrc "libobs"),
  (Join-Path $ObsSrc "libobs\util")
) | ForEach-Object { "/I`"$_`"" }

$Source = Join-Path $Root "src\gridiron_ocr_capture.cpp"
$Obj = Join-Path $OutDir "gridiron_ocr_capture.obj"

$compileCmd = @(
  "call `"$DevCmd`" -arch=amd64 >nul"
  "cl /nologo /std:c++17 /EHsc /MD /O2 /DNDEBUG /DWIN32 /D_WINDOWS /DUNICODE /D_UNICODE $($IncludeDirs -join ' ') /c `"$Source`" /Fo`"$Obj`""
  "link /nologo /DLL /OUT:`"$OutDll`" `"$Obj`" `"$ObsLib`" user32.lib kernel32.lib gdi32.lib /INCREMENTAL:NO"
) -join " && "

Write-Host "Building $DllName..."
cmd /c $compileCmd
if ($LASTEXITCODE -ne 0) { throw "OBS plugin build failed with exit $LASTEXITCODE" }
if (-not (Test-Path $OutDll)) { throw "Expected output missing: $OutDll" }

Write-Host "Built: $OutDll"
Write-Host "Install by copying to: $ObsInstall\obs-plugins\64bit\"
Write-Host "Then restart OBS Studio."
