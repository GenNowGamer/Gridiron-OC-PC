# Local OCR golden dataset

Put personal/raw Madden captures only in `private/`; that directory is
gitignored. Benchmark output belongs in gitignored `results/`.

## Sanitized fixtures (committed)

Unit-level synthetic PNGs live in `fixtures/` with `fixtures/manifest.json`.
These use the mock OCR engine so smoke/benchmark gates can run without
personal captures or a neural model:

```powershell
npm run benchmark:ocr -- .\ocr-golden\fixtures\manifest.json
```

## Private captures (gitignored)

The personal benchmark manifest is `private/manifest.json`:

```json
{
  "engine": "auto",
  "profile": {
    "name": "Madden presentation",
    "rois": [
      {
        "id": "down_distance",
        "x": 0.1,
        "y": 0.8,
        "width": 0.2,
        "height": 0.08,
        "preprocess": { "grayscale": true, "scale": 2, "threshold": "otsu" },
        "ocr": { "psm": 7 }
      }
    ]
  },
  "samples": [
    {
      "image": "captures/frame-001.png",
      "expected": { "down_distance": "3rd & 6" }
    }
  ]
}
```

Run from `PC`:

```powershell
npm run benchmark:ocr -- .\ocr-golden\private\manifest.json
```

Only sanitized, synthetic fixtures may be committed outside `private/`.
