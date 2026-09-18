from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
from flask import Flask, jsonify, request
from ultralytics import YOLO

PORT = int(os.getenv("PORT", "5055"))
MODEL_PATH = os.getenv("MODEL_PATH", "yolov8n.pt")
MIN_CONF = float(os.getenv("MIN_CONF", "0.35"))
API_KEY = os.getenv("DETECTOR_API_KEY", "").strip()
MOTION_DIFF_THRESHOLD = int(os.getenv("MOTION_DIFF_THRESHOLD", "25"))
MOTION_MIN_RATIO = float(os.getenv("MOTION_MIN_RATIO", "0.04"))
MOTION_EVENT_COOLDOWN_S = float(os.getenv("MOTION_EVENT_COOLDOWN_S", "8"))

BASE_DIR = Path(__file__).resolve().parent
CAPTURE_ROOT = BASE_DIR / "captures"
LOG_FILE = CAPTURE_ROOT / "detections.jsonl"

CAR_LABELS = {"car", "bus", "truck", "motorcycle"}

app = Flask(__name__)
model = YOLO(MODEL_PATH)
DEVICE_STATE: dict[str, dict] = {}


def ensure_dirs() -> Path:
    day_dir = CAPTURE_ROOT / datetime.now().strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    return day_dir


def write_log_line(payload: dict) -> None:
    CAPTURE_ROOT.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(payload, ensure_ascii=False) + "\n")


def device_id_from_request() -> str:
    return request.headers.get("X-Device-Id", "").strip() or "unknown"


def is_scan_only() -> bool:
    value = request.headers.get("X-Scan-Only", "").strip().lower()
    return value in {"1", "true", "yes"}


def decode_color_image(image_bytes: bytes):
    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    if buffer.size == 0:
        return None
    return cv2.imdecode(buffer, cv2.IMREAD_COLOR)


def detect_image(image) -> dict:
    result = model(image, verbose=False)[0]
    detections = []
    has_person = False
    has_vehicle = False

    for box in result.boxes:
        confidence = float(box.conf[0])
        if confidence < MIN_CONF:
            continue

        class_id = int(box.cls[0])
        label = str(result.names.get(class_id, class_id))

        if label == "person":
            has_person = True
        if label in CAR_LABELS:
            has_vehicle = True

        detections.append(
            {
                "label": label,
                "confidence": round(confidence, 4),
            }
        )

    if has_person:
        kind = "pessoa"
    elif has_vehicle:
        kind = "carro"
    else:
        kind = "outro"

    return {
        "kind": kind,
        "has_person": has_person,
        "has_vehicle": has_vehicle,
        "detections": detections,
    }


def detect_motion(device_id: str, image) -> dict:
    preview = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    preview = cv2.resize(preview, (160, 120), interpolation=cv2.INTER_AREA)
    preview = cv2.GaussianBlur(preview, (5, 5), 0)
    preview = cv2.Canny(preview, 40, 120)

    state = DEVICE_STATE.setdefault(device_id, {})
    previous = state.get("preview")
    frames_seen = int(state.get("frames_seen", 0)) + 1
    state["frames_seen"] = frames_seen
    motion_ratio = 0.0
    motion_detected = False

    if previous is not None and previous.shape == preview.shape:
        diff = cv2.absdiff(previous, preview)
        _, mask = cv2.threshold(diff, MOTION_DIFF_THRESHOLD, 255, cv2.THRESH_BINARY)
        motion_ratio = float(np.count_nonzero(mask) / mask.size)
        motion_detected = frames_seen > 3 and motion_ratio >= MOTION_MIN_RATIO

    state["preview"] = preview
    return {
        "motion_detected": motion_detected,
        "motion_ratio": round(motion_ratio, 5),
    }


def event_allowed(device_id: str) -> bool:
    state = DEVICE_STATE.setdefault(device_id, {})
    last_event_at = float(state.get("last_event_at", 0.0))
    return (time.time() - last_event_at) >= MOTION_EVENT_COOLDOWN_S


def mark_event(device_id: str) -> None:
    state = DEVICE_STATE.setdefault(device_id, {})
    state["last_event_at"] = time.time()


def read_image_bytes() -> bytes:
    if "image" in request.files:
        return request.files["image"].read()
    if request.data:
        return request.data
    return b""


def is_authorized() -> bool:
    if not API_KEY:
        return True
    incoming = request.headers.get("X-Api-Key", "").strip()
    return incoming == API_KEY


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": "esp32cam-motion-detector",
            "model": MODEL_PATH,
            "min_conf": MIN_CONF,
            "motion_diff_threshold": MOTION_DIFF_THRESHOLD,
            "motion_min_ratio": MOTION_MIN_RATIO,
            "motion_event_cooldown_s": MOTION_EVENT_COOLDOWN_S,
        }
    )


@app.post("/analyze")
def analyze():
    if not is_authorized():
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    device_id = device_id_from_request()
    scan_only = is_scan_only()
    image_bytes = read_image_bytes()
    if not image_bytes:
        return jsonify({"ok": False, "error": "empty_image"}), 400

    image = decode_color_image(image_bytes)
    if image is None:
        return jsonify({"ok": False, "error": "invalid_image"}), 400

    detection = detect_image(image)
    motion = detect_motion(device_id, image)
    should_capture_event = event_allowed(device_id) and (
        motion["motion_detected"] or detection["has_person"] or detection["has_vehicle"]
    )

    image_path = None
    if not scan_only:
        day_dir = ensure_dirs()
        ts = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        image_path = day_dir / f"{ts}-{uuid4().hex[:8]}.jpg"
        image_path.write_bytes(image_bytes)
        mark_event(device_id)

    response = {
        "ok": True,
        "device_id": device_id,
        "scan_only": scan_only,
        "should_capture_event": should_capture_event,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "image_path": str(image_path) if image_path else None,
        **motion,
        **detection,
    }

    if image_path is not None:
        write_log_line(response)
    return jsonify(response)


if __name__ == "__main__":
    CAPTURE_ROOT.mkdir(parents=True, exist_ok=True)
    app.run(host="0.0.0.0", port=PORT, debug=False)
