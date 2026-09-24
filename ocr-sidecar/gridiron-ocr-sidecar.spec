# -*- mode: python ; coding: utf-8 -*-
import os
from importlib.util import find_spec

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = ["cv2", "numpy", "pytesseract", "PIL", "onnxruntime"]

# Preferred HUD engine runtime + PP-OCRv5 recognition model.
if find_spec("onnxruntime") is not None:
    ort_datas, ort_binaries, ort_hidden = collect_all("onnxruntime")
    datas += ort_datas
    binaries += ort_binaries
    hiddenimports += ort_hidden

model_dir = os.path.join("models", "PP-OCRv5_mobile_rec")
model_onnx = os.path.join(model_dir, "inference.onnx")
model_yml = os.path.join(model_dir, "inference.yml")
if os.path.isfile(model_onnx):
    datas.append((model_onnx, model_dir))
if os.path.isfile(model_yml):
    datas.append((model_yml, model_dir))

# PaddleOCR is optional. Include its installed package data only when the build
# environment has explicitly provisioned PaddleOCR and its runtime.
if find_spec("paddleocr") is not None:
    paddle_datas, paddle_binaries, paddle_hidden = collect_all("paddleocr")
    datas += paddle_datas
    binaries += paddle_binaries
    hiddenimports += paddle_hidden

a = Analysis(
    ["run_sidecar.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="gridiron-ocr-sidecar",
    console=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="gridiron-ocr-sidecar",
)
