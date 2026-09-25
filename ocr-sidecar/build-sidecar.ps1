[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipTests,
    [string]$TesseractRoot = "C:\Program Files\Tesseract-OCR"
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
if (-not $Root) {
    $Root = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $Root) {
    throw "Unable to resolve ocr-sidecar root (PSScriptRoot empty)."
}
Write-Host "Building OCR sidecar from: $Root"
$Venv = Join-Path -Path $Root -ChildPath ".venv"
$Python = Join-Path -Path $Venv -ChildPath "Scripts\python.exe"
Write-Host "Python: $Python"

Push-Location -LiteralPath $Root
try {
    if (-not (Test-Path -LiteralPath $Python)) {
        $version = & py -3.12 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
        if ($LASTEXITCODE -ne 0 -or $version -ne "3.12") {
            throw "Python 3.12 is required. Install it or make 'py -3.12' available."
        }
        & py -3.12 -m venv $Venv
        if ($LASTEXITCODE -ne 0) { throw "Failed to create Python virtual environment." }
    }

    if (-not $SkipInstall) {
        Write-Host "Installing Python dependencies..."
        & $Python -m pip install --disable-pip-version-check -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
    }

    $ModelDir = Join-Path -Path $Root -ChildPath "models\PP-OCRv5_mobile_rec"
    $ModelOnnx = Join-Path -Path $ModelDir -ChildPath "inference.onnx"
    Write-Host "Model: $ModelOnnx"
    if (-not (Test-Path -LiteralPath $ModelOnnx)) {
        Write-Host "PP-OCRv5 ONNX model missing - fetching..."
        $fetchScript = Join-Path -Path $Root -ChildPath "scripts\fetch-pp-ocrv5-onnx.ps1"
        & powershell -NoProfile -ExecutionPolicy Bypass -File $fetchScript
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $ModelOnnx)) {
            throw "PP-OCRv5 model is required at '$ModelOnnx'. Run scripts\fetch-pp-ocrv5-onnx.ps1."
        }
    }

    if (-not $SkipTests) {
        Write-Host "Running sidecar unit tests..."
        & $Python -m unittest discover -s tests -v
        if ($LASTEXITCODE -ne 0) { throw "Unit tests failed." }
    }

    Write-Host "Running PyInstaller..."
    & $Python -m PyInstaller --noconfirm --clean gridiron-ocr-sidecar.spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed." }

    $Output = Join-Path -Path $Root -ChildPath "dist\gridiron-ocr-sidecar\gridiron-ocr-sidecar.exe"
    Write-Host "Checking output: $Output"
    if (-not (Test-Path -LiteralPath $Output)) { throw "Expected sidecar executable was not produced." }
    $RuntimeRoot = Split-Path -Parent $Output
    if (-not $RuntimeRoot) { throw "Unable to resolve sidecar runtime root from '$Output'." }
    Write-Host "Runtime root: $RuntimeRoot"

    # Always copy the recognition model next to the frozen exe (preferred engine path).
    $RuntimeModels = Join-Path -Path $RuntimeRoot -ChildPath "models\PP-OCRv5_mobile_rec"
    New-Item -ItemType Directory -Force -Path $RuntimeModels | Out-Null
    Copy-Item -Path (Join-Path -Path $ModelDir -ChildPath "*") -Destination $RuntimeModels -Force
    $BundledModel = Join-Path -Path $RuntimeModels -ChildPath "inference.onnx"
    if (-not (Test-Path -LiteralPath $BundledModel)) {
        throw "PP-OCRv5 model missing after bundle step: $BundledModel"
    }
    $modelBytes = (Get-Item -LiteralPath $BundledModel).Length
    if ($modelBytes -lt 1000000) {
        throw "PP-OCRv5 model looks corrupt/too small ($modelBytes bytes): $BundledModel"
    }
    Write-Host "Bundled PP-OCRv5 model: $RuntimeModels ($modelBytes bytes)"

    $BundledTesseract = Join-Path -Path $RuntimeRoot -ChildPath "tesseract"
    $safeTesseractRoot = if ([string]::IsNullOrWhiteSpace($TesseractRoot)) {
        "C:\Program Files\Tesseract-OCR"
    } else {
        $TesseractRoot
    }
    $TesseractExe = Join-Path -Path $safeTesseractRoot -ChildPath "tesseract.exe"
    $EnglishData = Join-Path -Path $safeTesseractRoot -ChildPath "tessdata\eng.traineddata"
    $hasTesseract = (Test-Path -LiteralPath $TesseractExe) -and (Test-Path -LiteralPath $EnglishData)
    if (-not $hasTesseract) {
        Write-Host "WARNING: Tesseract not found at '$safeTesseractRoot' - preferred engines still work without it."
    } elseif ($BundledTesseract) {
        if (Test-Path -LiteralPath $BundledTesseract) {
            Remove-Item -LiteralPath $BundledTesseract -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Force -Path $BundledTesseract | Out-Null
        $TessdataDir = Join-Path -Path $BundledTesseract -ChildPath "tessdata"
        New-Item -ItemType Directory -Force -Path $TessdataDir | Out-Null
        Copy-Item -Path $TesseractExe -Destination $BundledTesseract
        Get-ChildItem -Path $safeTesseractRoot -Filter "*.dll" -ErrorAction SilentlyContinue |
            Copy-Item -Destination $BundledTesseract -Force -ErrorAction SilentlyContinue
        Copy-Item -Path $EnglishData -Destination $TessdataDir
        $OsdData = Join-Path -Path $safeTesseractRoot -ChildPath "tessdata\osd.traineddata"
        if (Test-Path -LiteralPath $OsdData) {
            Copy-Item -Path $OsdData -Destination $TessdataDir
        }
        Write-Host "Bundled Tesseract runtime (explicit fallback only): $BundledTesseract"
    }
    Write-Host "Built: $Output"
}
finally {
    Pop-Location
}
