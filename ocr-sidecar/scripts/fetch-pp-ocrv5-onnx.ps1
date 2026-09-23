# Fetch official PP-OCRv5 mobile recognition ONNX (Apache-2.0)
# Source: https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx
# Artifacts: inference.onnx + inference.yml — not committed (too large / optional).

param(
  [string]$DestRoot = (Join-Path $PSScriptRoot "..\models\PP-OCRv5_mobile_rec")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null

$base = "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/main"
$files = @("inference.onnx", "inference.yml")

foreach ($name in $files) {
  $target = Join-Path $DestRoot $name
  if (Test-Path $target) {
    Write-Host "Already present: $target"
    continue
  }
  $url = "$base/$name"
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
}

$license = Join-Path (Split-Path $DestRoot -Parent) "MODEL_LICENSE.txt"
@"
PP-OCRv5_mobile_rec_onnx
Source: https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx
License: Apache-2.0 (model card cardData.license)
Files: inference.onnx, inference.yml
Fetched for optional Gridiron OCR ONNX Runtime engine (onnx_ppocrv5).
Do not redistribute without preserving Apache-2.0 notices.
"@ | Set-Content -Path $license -Encoding UTF8

Write-Host "Model ready under $DestRoot"
Write-Host "License note: $license"
Write-Host "Install runtime: pip install onnxruntime  (or onnxruntime-gpu for CUDA)"
