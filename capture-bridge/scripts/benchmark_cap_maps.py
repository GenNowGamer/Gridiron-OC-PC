"""Phase 0 timing harness: consume Cap V1 shared memory while the bridge publishes."""
from __future__ import annotations

import argparse
import statistics
import sys
import time

# Allow importing sibling ocr_sidecar when run from repo.
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "ocr-sidecar"))

from ocr_sidecar.shared_frame import (  # noqa: E402
    CAP_CONTROL_MAP_NAME,
    CAP_FRAME_MAP_NAME,
    SharedFrameConsumer,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="spike")
    parser.add_argument("--frames", type=int, default=3)
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--interval-ms", type=int, default=80)
    parser.add_argument("--gate-ms", type=float, default=700.0)
    args = parser.parse_args()

    consumer = SharedFrameConsumer(
        control_map_name=CAP_CONTROL_MAP_NAME,
        frame_map_name=CAP_FRAME_MAP_NAME,
        unavailable_code="capture_bridge_unavailable",
        timeout_code="capture_bridge_frame_timeout",
        adapter_name="capture-bridge",
    )
    times = []
    try:
        for _ in range(args.samples):
            started = time.perf_counter()
            for i in range(args.frames):
                consumer.capture(args.source, timeout_seconds=2.0)
                if i + 1 < args.frames and args.interval_ms > 0:
                    time.sleep(args.interval_ms / 1000.0)
            times.append((time.perf_counter() - started) * 1000.0)
        times.sort()
        p50 = statistics.median(times)
        p95 = times[max(0, int(round(0.95 * (len(times) - 1))))]
        print(f"frames={args.frames} samples={args.samples} p50={p50:.1f}ms p95={p95:.1f}ms gate={args.gate_ms}ms")
        print(f"pass={p95 <= args.gate_ms}")
        return 0 if p95 <= args.gate_ms else 3
    finally:
        consumer.close()


if __name__ == "__main__":
    raise SystemExit(main())
