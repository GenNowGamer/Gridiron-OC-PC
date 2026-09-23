[CmdletBinding()]
param([switch]$SkipInstall)

$ErrorActionPreference = "Stop"
$Venv = Join-Path $PSScriptRoot ".venv"
$Python = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Python)) {
    & py -3.12 -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 virtual environment creation failed." }
}
if (-not $SkipInstall) {
    & $Python -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "OCR worker dependency installation failed." }
}
Push-Location $PSScriptRoot
try {
    & $Python -m unittest discover -s tests -v
    if ($LASTEXITCODE -ne 0) { throw "OCR worker tests failed." }
}
finally {
    Pop-Location
}
