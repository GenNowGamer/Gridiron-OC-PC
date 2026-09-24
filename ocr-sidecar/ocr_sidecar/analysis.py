import re
import time
import unicodedata
import hashlib
from collections import defaultdict

from .errors import SidecarError
from .images import (
    decode_image_data,
    detect_field_side_arrow,
    encode_png_data_url,
    estimate_anchor_drift,
    expand_roi_band,
    locate_hud_text_crops,
    preprocess,
    shift_roi,
)
from .profile import crop_normalized


def _capture_parts(value):
    image = getattr(value, "image", value)
    metadata_method = getattr(value, "metadata", None)
    metadata = metadata_method() if callable(metadata_method) else {}
    return image, metadata


def _frame_record(index, frame, metadata, frame_started):
    return {
        "index": index,
        "capturedAt": round(time.time(), 6),
        "hash": hashlib.sha256(frame.tobytes()).hexdigest(),
        "width": int(frame.shape[1]),
        "height": int(frame.shape[0]),
        "elapsedMs": round((time.monotonic() - frame_started) * 1000),
        **{key: value for key, value in metadata.items() if value is not None},
    }


def _qpc_seconds(metadata):
    qpc = metadata.get("capturedQpc")
    freq = metadata.get("qpcFrequency")
    if qpc is None or not freq:
        return None
    try:
        return float(qpc) / float(freq)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def frame_is_stale(metadata, previous_metadata=None, max_age_seconds=0.35):
    """Detect stale plugin frames via explicit flag, QPC regression, or excessive age."""
    if metadata.get("stale"):
        return True
    qpc = metadata.get("capturedQpc")
    if qpc is None:
        return False
    try:
        qpc = int(qpc)
    except (TypeError, ValueError):
        return False
    if previous_metadata:
        prev_qpc = previous_metadata.get("capturedQpc")
        if prev_qpc is not None:
            try:
                if qpc <= int(prev_qpc):
                    return True
            except (TypeError, ValueError):
                pass
        prev_seconds = _qpc_seconds(previous_metadata)
        current_seconds = _qpc_seconds(metadata)
        if prev_seconds is not None and current_seconds is not None:
            if current_seconds + 1e-6 < prev_seconds:
                return True
            if current_seconds - prev_seconds > max(0.05, float(max_age_seconds) * 8):
                # Sequence jumped unrealistically far forward — treat as suspect/stale source clock.
                return False
    return False


def count_stale_frames(frames, max_age_seconds=0.35):
    stale = 0
    previous = None
    max_qpc_seconds = None
    for item in frames:
        seconds = _qpc_seconds(item)
        if seconds is not None:
            max_qpc_seconds = seconds if max_qpc_seconds is None else max(max_qpc_seconds, seconds)
    for item in frames:
        if item.get("stale") or frame_is_stale(item, previous, max_age_seconds=max_age_seconds):
            stale += 1
        elif max_qpc_seconds is not None:
            seconds = _qpc_seconds(item)
            if seconds is not None and (max_qpc_seconds - seconds) > float(max_age_seconds):
                stale += 1
        previous = item
    return stale


def normalize_text(text):
    text = unicodedata.normalize("NFKC", str(text or "")).casefold()
    return re.sub(r"\s+", " ", text).strip()


def down_distance_structure_score(text):
    """Prefer OCR samples that still show ordinal/separator structure over digit soup."""
    normalized = normalize_text(text).upper()
    if not normalized:
        return 0
    compact = re.sub(r"\s+", "", normalized)
    if "&" in normalized or re.search(r"\bAND\b", normalized):
        return 2
    if re.search(r"\b[1-4](?:ST|ND|RD|TH)\b", normalized):
        return 2
    if re.search(r"[1-4](?:ST|ND|RD|TH)(?:\d{1,2}|GOAL)\b", compact):
        return 2
    return 0


def _field_position_yard_candidates(text):
    normalized = normalize_text(text).upper()
    # Ignore digits that sit before an arrow glyph (left bleed).
    normalized = re.sub(r"\d+([V↑↓∨∧Λ^])", r"\1", normalized)
    return [int(match) for match in re.findall(r"\b(\d{1,2})\b", normalized) if 1 <= int(match) <= 50]


def filter_field_position_leading_digit_bleed(samples):
    """
    When the burst sees both "5" and "45", the longer reading is usually a
    leading-digit bleed — drop those samples before majority vote.
    True OWN 45 typically never produces a competing "5" sample.
    """
    yards = []
    for sample in samples or []:
        yards.extend(_field_position_yard_candidates(sample.get("text", "")))
    short = {yard for yard in yards if 1 <= yard <= 9}
    if not short:
        return list(samples or [])
    filtered = []
    for sample in samples or []:
        sample_yards = _field_position_yard_candidates(sample.get("text", ""))
        if not sample_yards:
            filtered.append(sample)
            continue
        yard = sample_yards[-1]
        if yard >= 10 and (yard % 10) in short and (yard // 10) <= 4:
            continue
        filtered.append(sample)
    return filtered or list(samples or [])


def temporal_consensus(samples, roi_id=""):
    if not samples:
        return {"text": "", "confidence": 0.0, "agreement": 0.0, "sampleCount": 0}
    roi = str(roi_id or "")
    working = filter_field_position_leading_digit_bleed(samples) if roi == "field_position" else samples
    groups = defaultdict(list)
    for sample in working:
        groups[normalize_text(sample.get("text", ""))].append(sample)
    prefer_structure = roi == "down_distance"
    winner_key, winners = max(
        groups.items(),
        key=lambda item: (
            down_distance_structure_score(item[0]) if prefer_structure else 0,
            len(item[1]),
            sum(float(sample.get("confidence", 0)) for sample in item[1]),
            item[0],
        ),
    )
    representative = max(
        winners, key=lambda item: (float(item.get("confidence", 0)), item.get("text", ""))
    )
    confidence = sum(float(sample.get("confidence", 0)) for sample in winners) / len(winners)
    result = {
        "text": representative.get("text", "") if winner_key else "",
        "confidence": round(max(0.0, min(1.0, confidence)), 4),
        "agreement": round(len(winners) / max(1, len(working)), 4),
        "sampleCount": len(working),
    }
    if representative.get("bandSource"):
        result["bandSource"] = representative.get("bandSource")
    if representative.get("bandScore") is not None:
        result["bandScore"] = representative.get("bandScore")
    side = temporal_consensus_field_side(samples)
    if side.get("fieldSide"):
        result["fieldSide"] = side["fieldSide"]
        result["fieldSideDirection"] = side.get("fieldSideDirection")
        result["fieldSideConfidence"] = side.get("fieldSideConfidence", 0.0)
        result["fieldSideAgreement"] = side.get("fieldSideAgreement", 0.0)
    return result


def temporal_consensus_field_side(samples):
    votes = defaultdict(list)
    for sample in samples or []:
        side = str(sample.get("fieldSide") or "").strip().upper()
        if side not in ("OWN", "OPP"):
            continue
        votes[side].append(float(sample.get("fieldSideConfidence") or 0.0))
    if not votes:
        return {
            "fieldSide": None,
            "fieldSideDirection": None,
            "fieldSideConfidence": 0.0,
            "fieldSideAgreement": 0.0,
        }
    winner, scores = max(
        votes.items(),
        key=lambda item: (len(item[1]), sum(item[1]), item[0]),
    )
    total = max(1, sum(len(values) for values in votes.values()))
    direction = "down" if winner == "OWN" else "up"
    return {
        "fieldSide": winner,
        "fieldSideDirection": direction,
        "fieldSideConfidence": round(sum(scores) / max(1, len(scores)), 4),
        "fieldSideAgreement": round(len(scores) / total, 4),
    }


def _reference_frame(profile):
    encoded = profile.get("referenceImageBase64")
    if not encoded:
        return None
    try:
        return decode_image_data(encoded)
    except SidecarError:
        return None


def _field_has_usable_structure(field_id, text):
    """True when the tight ROI already looks like a complete HUD situation read."""
    normalized = normalize_text(text)
    if not normalized:
        return False
    if field_id == "down_distance":
        # Require ordinal + yards/goal — bare "1st" is usually the quarter label.
        return bool(
            re.search(
                r"\b[1-4](?:st|nd|rd|th)?\s*(?:&|and)\s*(?:\d{1,2}|goal)\b",
                normalized,
                re.I,
            )
            or re.search(r"[1-4](?:st|nd|rd|th)(?:\d{1,2}|goal)\b", normalized.replace(" ", ""), re.I)
        )
    if field_id == "field_position":
        yards = _field_position_yard_candidates(text)
        if not yards:
            return False
        if re.search(r"\b(own|opp|opponent)\b", normalized, re.I):
            return True
        if re.search(r"[v^↑↓∨∧Λ]", text or ""):
            return True
        # Bare midfield 50 is usable without OWN/OPP.
        return len(yards) == 1 and yards[0] == 50
    return False


def _field_read_score(field_id, text, confidence):
    """Rank candidate OCR reads for HUD situation fields (higher is better)."""
    normalized = normalize_text(text)
    if not normalized:
        return -1.0
    score = float(confidence or 0) * 0.35
    if field_id == "down_distance":
        score += down_distance_structure_score(text) * 1.5
        if re.search(r"\b[1-4](?:st|nd|rd|th)?\s*(?:&|and)\s*(?:\d{1,2}|goal)\b", normalized, re.I):
            score += 2.5
        elif re.search(r"[1-4](?:st|nd|rd|th)", normalized, re.I):
            score += 1.2
        # Penalize bare digit soup / scoreboard bleed that usually means a bad crop.
        if re.fullmatch(r"\d{1,4}", normalized.replace(" ", "")):
            score -= 1.5
        # Quarter labels ("1st") without yards-to-go are not down/distance.
        if re.fullmatch(r"[1-4](?:st|nd|rd|th)", normalized.replace(" ", ""), re.I):
            score -= 2.0
    elif field_id == "field_position":
        if re.search(r"\b(own|opp|opponent)\b", normalized, re.I):
            score += 1.8
        if re.search(r"[v^↑↓∨∧Λ]", text or ""):
            score += 1.2
        yards = _field_position_yard_candidates(text)
        if yards:
            score += 1.4
            # Prefer a single clear yard token over digit soup.
            if len(yards) == 1 and 1 <= yards[0] <= 50:
                score += 0.8
        if re.fullmatch(r"v?0+", normalized.replace(" ", "")) or normalized in {"v", "^"}:
            score -= 2.0
    else:
        score += min(2.0, len(normalized) / 8.0)
    return score


def _recognize_roi_with_band(frame, roi, engine, include_images=False):
    """OCR the tight ROI first; only band-search when that read is empty/junk."""
    field_id = str(roi.get("id") or "")
    use_band = field_id in ("down_distance", "field_position")
    base_crop = crop_normalized(frame, roi)
    raw_opts = dict(roi.get("preprocess") or {})
    preprocess_opts = {
        "grayscale": raw_opts.get("grayscale", True) is not False,
        "scale": float(raw_opts.get("scale") or 1),
        "invert": bool(raw_opts.get("invert")),
        "threshold": raw_opts.get("threshold") or "none",
        "thresholdValue": int(raw_opts.get("thresholdValue") or 128),
        "blur": int(raw_opts.get("blur") or 1),
        "morphology": raw_opts.get("morphology") or "none",
        "kernel": int(raw_opts.get("kernel") or 3),
    }
    if use_band:
        preprocess_opts["scale"] = max(float(preprocess_opts["scale"] or 1), 3.0)

    def _read_crop(crop, source, prior_score=0.0):
        if crop is None or getattr(crop, "size", 0) == 0:
            return None
        prepared = preprocess(crop, preprocess_opts)
        recognized = engine.recognize(prepared, roi.get("ocr") or {})
        text = str(recognized.get("text", ""))[:512]
        confidence = max(0.0, min(1.0, float(recognized.get("confidence", 0) or 0)))
        score = _field_read_score(field_id, text, confidence) + float(prior_score or 0) * 0.15
        return {
            "text": text,
            "confidence": round(confidence, 4),
            "cropHash": hashlib.sha256(crop.tobytes()).hexdigest(),
            "processedCropHash": hashlib.sha256(prepared.tobytes()).hexdigest(),
            "bandSource": source,
            "bandScore": round(float(score), 4),
            "_score": score,
            "_crop": crop,
            "_prepared": prepared,
        }

    # Always evaluate the drawn ROI first. Prefer it when structure is already good.
    best = _read_crop(base_crop, "roi", 0.55)
    if best is None:
        prepared = preprocess(base_crop, preprocess_opts)
        best = {
            "text": "",
            "confidence": 0.0,
            "cropHash": hashlib.sha256(base_crop.tobytes()).hexdigest(),
            "processedCropHash": hashlib.sha256(prepared.tobytes()).hexdigest(),
            "bandSource": "roi",
            "bandScore": 0.0,
            "_score": -1.0,
            "_crop": base_crop,
            "_prepared": prepared,
        }

    if use_band and not _field_has_usable_structure(field_id, best.get("text")):
        band_roi = expand_roi_band(roi)
        band_crop = crop_normalized(frame, band_roi)
        for item in locate_hud_text_crops(band_crop, max_crops=3):
            candidate = _read_crop(item.get("image"), item.get("source") or "band_strip", item.get("score") or 0)
            if candidate and candidate["_score"] > best["_score"]:
                best = candidate

    result = {
        "text": best.get("text", ""),
        "confidence": best.get("confidence", 0.0),
        "cropHash": best.get("cropHash"),
        "processedCropHash": best.get("processedCropHash"),
        "bandSource": best.get("bandSource") or "roi",
        "bandScore": best.get("bandScore", 0.0),
    }
    best_crop = best.get("_crop") if best.get("_crop") is not None else base_crop
    best_prepared = best.get("_prepared")

    if field_id == "field_position":
        arrow = detect_field_side_arrow(best_crop)
        if not arrow.get("side"):
            arrow = detect_field_side_arrow(base_crop)
        if arrow.get("side"):
            result["fieldSide"] = arrow["side"]
            result["fieldSideDirection"] = arrow.get("direction")
            result["fieldSideConfidence"] = float(arrow.get("confidence") or 0.0)

    if include_images:
        result["rawCrop"] = encode_png_data_url(best_crop)
        if best_prepared is not None:
            result["processedCrop"] = encode_png_data_url(best_prepared)
    return result


def analyze_frame(frame, profile, engine, include_images=False, drift=None):
    results = {}
    dx = float((drift or {}).get("dx") or 0)
    dy = float((drift or {}).get("dy") or 0)
    for roi in profile["rois"]:
        adjusted = shift_roi(roi, dx, dy) if (dx or dy) else roi
        field_id = str(adjusted.get("id") or "")
        if field_id in ("down_distance", "field_position"):
            results[field_id] = _recognize_roi_with_band(
                frame, adjusted, engine, include_images=include_images
            )
            continue
        cropped = crop_normalized(frame, adjusted)
        prepared = preprocess(cropped, roi["preprocess"])
        recognized = engine.recognize(prepared, roi["ocr"])
        entry = {
            "text": str(recognized.get("text", ""))[:512],
            "confidence": round(
                max(0.0, min(1.0, float(recognized.get("confidence", 0)))), 4
            ),
            "cropHash": hashlib.sha256(cropped.tobytes()).hexdigest(),
            "processedCropHash": hashlib.sha256(prepared.tobytes()).hexdigest(),
        }
        results[roi["id"]] = entry
        if include_images:
            results[roi["id"]]["rawCrop"] = encode_png_data_url(cropped)
            results[roi["id"]]["processedCrop"] = encode_png_data_url(prepared)
    return results


def analyze_burst(
    capture, source, profile, engine, frame_count, interval_ms, cancel_event, include_images=False
):
    per_roi = {roi["id"]: [] for roi in profile["rois"]}
    captured = 0
    frame_metadata = []
    duplicate_frames = 0
    stale_frames = 0
    seen_sequences = set()
    previous_meta = None
    started = time.monotonic()
    attempts = 0
    anchor_drift = None
    reference = _reference_frame(profile)
    last_frame = None
    while captured < frame_count and attempts < frame_count * 3:
        if cancel_event.is_set():
            raise SidecarError("cancelled", "capture burst was cancelled", {"framesCaptured": captured})
        frame_started = time.monotonic()
        value = capture(source)
        frame, metadata = _capture_parts(value)
        attempts += 1
        if frame_is_stale(metadata, previous_meta):
            stale_frames += 1
            continue
        source_sequence = metadata.get("sourceSequence")
        if metadata.get("stale"):
            stale_frames += 1
            continue
        if source_sequence is not None and source_sequence in seen_sequences:
            duplicate_frames += 1
            continue
        if source_sequence is not None:
            seen_sequences.add(source_sequence)
        if anchor_drift is None and profile.get("anchors"):
            anchor_drift = estimate_anchor_drift(frame, profile.get("anchors") or [], reference)
        frame_results = analyze_frame(frame, profile, engine, include_images=False, drift=anchor_drift)
        record = _frame_record(captured, frame, metadata, frame_started)
        captured += 1
        last_frame = frame
        frame_metadata.append(record)
        previous_meta = metadata
        for roi_id, result in frame_results.items():
            per_roi[roi_id].append(result)
        if captured < frame_count and cancel_event.wait(interval_ms / 1000):
            raise SidecarError("cancelled", "capture burst was cancelled", {"framesCaptured": captured})
    frames_without_sequence = [
        item["hash"] for item in frame_metadata if item.get("sourceSequence") is None
    ]
    duplicate_frames += max(0, len(frames_without_sequence) - len(set(frames_without_sequence)))
    stale_frames = max(stale_frames, count_stale_frames(frame_metadata))
    rois = {
        roi_id: {
            **temporal_consensus(samples, roi_id=roi_id),
            "samples": samples,
        }
        for roi_id, samples in per_roi.items()
    }
    if include_images and last_frame is not None:
        imaged = analyze_frame(
            last_frame, profile, engine, include_images=True, drift=anchor_drift
        )
        for roi_id, entry in rois.items():
            crop_source = imaged.get(roi_id) or {}
            if crop_source.get("rawCrop"):
                entry["rawCrop"] = crop_source["rawCrop"]
            if crop_source.get("processedCrop"):
                entry["processedCrop"] = crop_source["processedCrop"]
            if crop_source.get("bandSource") and not entry.get("bandSource"):
                entry["bandSource"] = crop_source.get("bandSource")
            if crop_source.get("bandScore") is not None and entry.get("bandScore") is None:
                entry["bandScore"] = crop_source.get("bandScore")
    return {
        "engine": engine.name,
        "framesCaptured": captured,
        "elapsedMs": round((time.monotonic() - started) * 1000),
        "frameHashes": [item["hash"] for item in frame_metadata],
        "frames": frame_metadata,
        "duplicateFrames": duplicate_frames,
        "staleFrames": stale_frames,
        "captureAdapters": sorted({item.get("captureAdapter", "unknown") for item in frame_metadata}),
        "fallbackFrames": sum(1 for item in frame_metadata if item.get("fallbackReason")),
        "anchorDrift": anchor_drift,
        "rois": rois,
        "rawFramesRetained": False,
        "includeImages": bool(include_images),
    }


def benchmark_capture(capture, source, frame_count, interval_ms):
    frames = []
    started = time.monotonic()
    for index in range(frame_count):
        frame_started = time.monotonic()
        value = capture(source)
        frame, metadata = _capture_parts(value)
        frames.append(_frame_record(index, frame, metadata, frame_started))
        if index + 1 < frame_count and interval_ms:
            time.sleep(interval_ms / 1000)
    identities = [
        ("sequence", item["sourceSequence"]) if item.get("sourceSequence") is not None
        else ("hash", item["hash"])
        for item in frames
    ]
    return {
        "framesCaptured": len(frames),
        "elapsedMs": round((time.monotonic() - started) * 1000),
        "frames": frames,
        "frameHashes": [item["hash"] for item in frames],
        "duplicateFrames": max(0, len(frames) - len(set(identities))),
        "staleFrames": count_stale_frames(frames),
        "captureAdapters": sorted({item.get("captureAdapter", "unknown") for item in frames}),
        "fallbackFrames": sum(1 for item in frames if item.get("fallbackReason")),
        "rawFramesRetained": False,
    }
