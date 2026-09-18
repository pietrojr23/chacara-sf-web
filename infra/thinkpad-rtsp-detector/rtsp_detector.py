from __future__ import annotations

import csv
import json
import logging
import os
import threading
import time
from collections import deque
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urlsplit, urlunsplit

import cv2
import numpy as np
from dotenv import load_dotenv
from flask import Flask, Response, abort, jsonify, request, send_file
from ultralytics import YOLO

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

LOG_LEVEL_NAME = str(os.getenv("LOG_LEVEL", "INFO")).strip().upper() or "INFO"
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL_NAME, logging.INFO),
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("rtsp_detector")

PORT = int(os.getenv("PORT", "5060"))
CAMERA_NAME = str(os.getenv("CAMERA_NAME", "cam1")).strip() or "cam1"
RTSP_URL = str(os.getenv("RTSP_URL", "")).strip()
RTSP_TRANSPORT = str(os.getenv("RTSP_TRANSPORT", "tcp")).strip().lower() or "tcp"
SIMPLE_DETECTION_MODE = str(os.getenv("SIMPLE_DETECTION_MODE", "true")).strip().lower() not in {
    "0",
    "false",
    "no",
}
SUBSTREAM_ONLY = str(os.getenv("SUBSTREAM_ONLY", "true")).strip().lower() not in {"0", "false", "no"}
MODEL_PATH = str(os.getenv("MODEL_PATH", "yolo11n.pt")).strip() or "yolo11n.pt"
MIN_CONF = float(os.getenv("MIN_CONF", "0.35"))
PRIMARY_IMGSZ = max(320, int(os.getenv("PRIMARY_IMGSZ", "640")))
DETECT_INTERVAL_S = float(os.getenv("DETECT_INTERVAL_S", "1.0"))
EVENT_COOLDOWN_S = float(os.getenv("EVENT_COOLDOWN_S", "12"))
SAVE_ALL_DETECTIONS = True if SIMPLE_DETECTION_MODE else (
    str(os.getenv("SAVE_ALL_DETECTIONS", "true")).strip().lower() not in {"0", "false", "no"}
)
SNAPSHOT_INTERVAL_S = max(0.0, float(os.getenv("SNAPSHOT_INTERVAL_S", "0.0")))
SAVE_BEST_ONLY = False if SIMPLE_DETECTION_MODE else (
    str(os.getenv("SAVE_BEST_ONLY", "false")).strip().lower() not in {"0", "false", "no"}
)
BEST_EVENT_GAP_S = max(0.5, float(os.getenv("BEST_EVENT_GAP_S", "2.0")))
BEST_EVENT_MAX_HOLD_S = max(2.0, float(os.getenv("BEST_EVENT_MAX_HOLD_S", "20.0")))
BEST_REPLACE_SCORE_DELTA = max(0.0, float(os.getenv("BEST_REPLACE_SCORE_DELTA", "0.02")))
DEFAULT_ALLOWED_MIN_CONF = float(os.getenv("DEFAULT_ALLOWED_MIN_CONF", "0.65"))
MIN_BBOX_AREA_RATIO = float(os.getenv("MIN_BBOX_AREA_RATIO", "0.015"))
ANNOTATE_SAVED_IMAGES = str(os.getenv("ANNOTATE_SAVED_IMAGES", "true")).strip().lower() not in {
    "0",
    "false",
    "no",
}
PERSON_MIN_CONF = float(os.getenv("PERSON_MIN_CONF", "0.50"))
PERSON_MIN_AREA_RATIO = float(os.getenv("PERSON_MIN_AREA_RATIO", "0.006"))
PERSON_MIN_ASPECT_RATIO = float(os.getenv("PERSON_MIN_ASPECT_RATIO", "0.20"))
PERSON_MAX_ASPECT_RATIO = float(os.getenv("PERSON_MAX_ASPECT_RATIO", "0.95"))
PERSON_MIN_BOTTOM_RATIO = float(os.getenv("PERSON_MIN_BOTTOM_RATIO", "0.30"))
PERSON_KEEP_WITHOUT_VERIFY_CONF = float(os.getenv("PERSON_KEEP_WITHOUT_VERIFY_CONF", "0.62"))
PERSON_KEEP_WITHOUT_VERIFY_AREA_RATIO = float(os.getenv("PERSON_KEEP_WITHOUT_VERIFY_AREA_RATIO", "0.010"))
PERSON_KEEP_WITHOUT_VERIFY_BOTTOM_RATIO = float(os.getenv("PERSON_KEEP_WITHOUT_VERIFY_BOTTOM_RATIO", "0.38"))
BIRD_MIN_CONF = float(os.getenv("BIRD_MIN_CONF", "0.40"))
BIRD_TO_CAT_AREA_RATIO = float(os.getenv("BIRD_TO_CAT_AREA_RATIO", "0.007"))
BIRD_TO_CAT_MIN_ASPECT_RATIO = float(os.getenv("BIRD_TO_CAT_MIN_ASPECT_RATIO", "0.80"))
BIRD_TO_CAT_MIN_BOTTOM_RATIO = float(os.getenv("BIRD_TO_CAT_MIN_BOTTOM_RATIO", "0.30"))
MOTION_DIFF_THRESHOLD = int(os.getenv("MOTION_DIFF_THRESHOLD", "25"))
MOTION_MIN_RATIO = float(os.getenv("MOTION_MIN_RATIO", "0.02"))
MAX_INFER_WIDTH = max(0, int(os.getenv("MAX_INFER_WIDTH", "640")))
RECONNECT_DELAY_S = float(os.getenv("RECONNECT_DELAY_S", "5"))
JPEG_QUALITY = max(30, min(95, int(os.getenv("JPEG_QUALITY", "85"))))
API_KEY = str(os.getenv("API_KEY", "")).strip()
VERIFY_RTSP_URL = str(os.getenv("VERIFY_RTSP_URL", "")).strip()
VERIFY_MODEL_PATH = str(os.getenv("VERIFY_MODEL_PATH", "yolo11s.pt")).strip() or "yolo11s.pt"
VERIFY_MIN_CONF = float(os.getenv("VERIFY_MIN_CONF", "0.40"))
VERIFY_IMGSZ = max(640, int(os.getenv("VERIFY_IMGSZ", "960")))
VERIFY_FRAME_SKIP = max(1, int(os.getenv("VERIFY_FRAME_SKIP", "3")))
VERIFY_REQUIRED = False if SIMPLE_DETECTION_MODE else (
    str(os.getenv("VERIFY_REQUIRED", "true")).strip().lower() not in {"0", "false", "no"}
)
SAVE_PRIMARY_ON_VERIFY_MISS = (
    str(os.getenv("SAVE_PRIMARY_ON_VERIFY_MISS", "true")).strip().lower() not in {"0", "false", "no"}
)
REQUIRE_VERIFY_FOR_PERSON = False if SIMPLE_DETECTION_MODE else (
    str(os.getenv("REQUIRE_VERIFY_FOR_PERSON", "true")).strip().lower() not in {"0", "false", "no"}
)
SEMANTIC_FILTERS_ENABLED = False if SIMPLE_DETECTION_MODE else (
    str(os.getenv("SEMANTIC_FILTERS_ENABLED", "false")).strip().lower() not in {"0", "false", "no"}
)
VERIFY_STREAM_ACTIVE = bool(VERIFY_RTSP_URL) and not SIMPLE_DETECTION_MODE and not SUBSTREAM_ONLY

if RTSP_TRANSPORT == "tcp":
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

BASE_ALLOWED_SAVE_CLASS_RULES: dict[int, dict[str, Any]] = {
    0: {"label": "person", "min_conf": 0.55},
    1: {"label": "bicycle", "min_conf": 0.50},
    2: {"label": "car", "min_conf": 0.50},
    3: {"label": "motorcycle", "min_conf": 0.50},
    5: {"label": "bus", "min_conf": 0.50},
    7: {"label": "truck", "min_conf": 0.50},
    15: {"label": "cat", "min_conf": 0.55},
    16: {"label": "dog", "min_conf": 0.55},
    17: {"label": "horse", "min_conf": 0.55},
    18: {"label": "sheep", "min_conf": 0.55},
    19: {"label": "cow", "min_conf": 0.55},
}


def parse_target_labels(raw: str) -> set[str]:
    return {item.strip().lower() for item in str(raw or "").split(",") if item.strip()}


def get_rule_min_conf_override(label: str, default: float) -> float:
    env_name = f"{label.upper().replace(' ', '_')}_SAVE_MIN_CONF"
    raw_value = str(os.getenv(env_name, "")).strip()
    if not raw_value:
        return default
    try:
        return float(raw_value)
    except ValueError:
        logger.warning("Invalid %s=%r, using default %.2f", env_name, raw_value, default)
        return default


def build_allowed_save_class_rules() -> dict[int, dict[str, Any]]:
    requested_labels = parse_target_labels(os.getenv("TARGET_LABELS", ""))
    built: dict[int, dict[str, Any]] = {}

    for class_id, rule in BASE_ALLOWED_SAVE_CLASS_RULES.items():
        label = str(rule["label"]).lower()
        if requested_labels and label not in requested_labels:
            continue
        built[class_id] = {
            **rule,
            "min_conf": get_rule_min_conf_override(label, float(rule.get("min_conf", DEFAULT_ALLOWED_MIN_CONF))),
        }

    if requested_labels and not built:
        logger.warning("TARGET_LABELS=%r did not match known classes; using default class set", sorted(requested_labels))
        for class_id, rule in BASE_ALLOWED_SAVE_CLASS_RULES.items():
            label = str(rule["label"]).lower()
            built[class_id] = {
                **rule,
                "min_conf": get_rule_min_conf_override(label, float(rule.get("min_conf", DEFAULT_ALLOWED_MIN_CONF))),
            }

    return built


ALLOWED_SAVE_CLASS_RULES = build_allowed_save_class_rules()
CLASS_COOLDOWN_SECONDS: dict[int, float] = {
    class_id: 1.0 for class_id in ALLOWED_SAVE_CLASS_RULES
}
TARGET_LABELS = {rule["label"] for rule in ALLOWED_SAVE_CLASS_RULES.values()}

VEHICLE_LABELS = {"bicycle", "car", "bus", "truck", "motorcycle"}
ANIMAL_LABELS = {"dog", "cat", "horse", "sheep", "cow"}
DISPLAY_LABELS_PT = {
    "person": "Pessoa",
    "bicycle": "Bicicleta",
    "car": "Carro",
    "motorcycle": "Moto",
    "bus": "Onibus",
    "truck": "Caminhao",
    "dog": "Cachorro",
    "cat": "Gato",
    "horse": "Cavalo",
    "sheep": "Ovelha",
    "cow": "Vaca",
}
DISPLAY_TITLES_PT = {
    "person": "Pessoa detectada",
    "bicycle": "Bicicleta detectada",
    "car": "Carro detectado",
    "motorcycle": "Moto detectada",
    "bus": "Onibus detectado",
    "truck": "Caminhao detectado",
    "dog": "Cachorro detectado",
    "cat": "Gato detectado",
    "horse": "Cavalo detectado",
    "sheep": "Ovelha detectada",
    "cow": "Vaca detectada",
}
EVENTS_DIR = BASE_DIR / "events"
EVENT_IMAGES_DIR = Path(str(os.getenv("EVENT_IMAGES_DIR", str(EVENTS_DIR))).strip() or str(EVENTS_DIR))
EVENTS_LOG = EVENTS_DIR / "events.jsonl"
DETECTIONS_CSV = BASE_DIR / "detections_log.csv"
MAX_EVENTS_IN_MEMORY = 200
DISPLAY_BITMAP_WIDTH = 128
DISPLAY_BITMAP_HEIGHT = 64

app = Flask(__name__)
primary_model = None
verify_model = None
PRIMARY_MODEL_NAMES: dict[int, str] = {}
VERIFY_MODEL_NAMES: dict[int, str] = {}
PRIMARY_TARGET_CLASS_IDS: list[int] = []
VERIFY_TARGET_CLASS_IDS: list[int] = []


@app.after_request
def add_cors_headers(response: Response) -> Response:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Api-Key"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    return response


def normalize_names(raw: Any) -> dict[int, str]:
    if isinstance(raw, dict):
        return {int(key): str(value) for key, value in raw.items()}
    if isinstance(raw, list):
        return {index: str(value) for index, value in enumerate(raw)}
    return {}

state_lock = threading.Lock()
state: dict[str, Any] = {
    "service": "thinkpad-rtsp-detector",
    "camera_name": CAMERA_NAME,
    "model_path": MODEL_PATH,
    "simple_detection_mode": SIMPLE_DETECTION_MODE,
    "substream_only": SUBSTREAM_ONLY,
    "verify_model_path": VERIFY_MODEL_PATH if VERIFY_STREAM_ACTIVE else None,
    "target_labels": sorted(TARGET_LABELS),
    "save_all_detections": SAVE_ALL_DETECTIONS,
    "snapshot_interval_s": SNAPSHOT_INTERVAL_S,
    "save_best_only": SAVE_BEST_ONLY,
    "best_event_gap_s": BEST_EVENT_GAP_S,
    "best_event_max_hold_s": BEST_EVENT_MAX_HOLD_S,
    "min_bbox_area_ratio": MIN_BBOX_AREA_RATIO,
    "class_cooldowns_s": {str(class_id): cooldown for class_id, cooldown in CLASS_COOLDOWN_SECONDS.items()},
    "detections_csv": str(DETECTIONS_CSV),
    "save_primary_on_verify_miss": SAVE_PRIMARY_ON_VERIFY_MISS,
    "require_verify_for_person": REQUIRE_VERIFY_FOR_PERSON,
    "semantic_filters_enabled": SEMANTIC_FILTERS_ENABLED,
    "model_ready": False,
    "model_loading": False,
    "model_error": None,
    "verify_enabled": VERIFY_STREAM_ACTIVE,
    "verify_model_ready": False,
    "verify_model_loading": False,
    "verify_model_error": None,
    "connected": False,
    "frames_seen": 0,
    "last_frame_at": None,
    "last_infer_at": None,
    "last_event_at": None,
    "last_error": None,
    "motion_ratio": 0.0,
    "last_detection": None,
    "last_event": None,
    "latest_jpeg": None,
}
events_cache: deque[dict[str, Any]] = deque(maxlen=MAX_EVENTS_IN_MEMORY)
device_state: dict[str, Any] = {
    "preview": None,
    "last_infer_at": 0.0,
    "last_event_at": 0.0,
    "last_preview_at": 0.0,
    "last_saved_by_class": {},
    "pending_best_event": None,
}


def masked_rtsp_url(raw_url: str) -> str:
    text = str(raw_url or "").strip()
    if not text:
        return ""

    try:
        parsed = urlsplit(text)
        if not parsed.username and not parsed.password:
            return text

        hostname = parsed.hostname or ""
        port = f":{parsed.port}" if parsed.port else ""
        username = parsed.username or ""
        netloc = f"{username}:***@{hostname}{port}" if username else f"***@{hostname}{port}"
        return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))
    except Exception:
        return text


def load_model_if_needed() -> None:
    global primary_model, verify_model, PRIMARY_MODEL_NAMES, VERIFY_MODEL_NAMES
    global PRIMARY_TARGET_CLASS_IDS, VERIFY_TARGET_CLASS_IDS

    if primary_model is not None and (not VERIFY_STREAM_ACTIVE or verify_model is not None):
        return

    with state_lock:
        if state["model_loading"] or state["verify_model_loading"]:
            return
        state["model_loading"] = True
        state["model_error"] = None
        if VERIFY_STREAM_ACTIVE:
            state["verify_model_loading"] = True
            state["verify_model_error"] = None

    try:
        loaded_primary_model = YOLO(MODEL_PATH)
        loaded_primary_names = normalize_names(loaded_primary_model.names)
        loaded_primary_target_ids = sorted(class_id for class_id in ALLOWED_SAVE_CLASS_RULES if class_id in loaded_primary_names)

        loaded_verify_model = None
        loaded_verify_names: dict[int, str] = {}
        loaded_verify_target_ids: list[int] = []
        if VERIFY_STREAM_ACTIVE:
            loaded_verify_model = YOLO(VERIFY_MODEL_PATH)
            loaded_verify_names = normalize_names(loaded_verify_model.names)
            loaded_verify_target_ids = sorted(class_id for class_id in ALLOWED_SAVE_CLASS_RULES if class_id in loaded_verify_names)

        with state_lock:
            primary_model = loaded_primary_model
            PRIMARY_MODEL_NAMES = loaded_primary_names
            PRIMARY_TARGET_CLASS_IDS = loaded_primary_target_ids
            state["model_ready"] = True
            state["model_loading"] = False
            state["model_error"] = None
            if VERIFY_STREAM_ACTIVE:
                verify_model = loaded_verify_model
                VERIFY_MODEL_NAMES = loaded_verify_names
                VERIFY_TARGET_CLASS_IDS = loaded_verify_target_ids
                state["verify_model_ready"] = True
                state["verify_model_loading"] = False
                state["verify_model_error"] = None
            else:
                state["verify_model_ready"] = False
                state["verify_model_loading"] = False
                state["verify_model_error"] = None
    except Exception as error:
        with state_lock:
            state["model_ready"] = False
            state["model_loading"] = False
            state["model_error"] = str(error)
            if VERIFY_STREAM_ACTIVE:
                state["verify_model_ready"] = False
                state["verify_model_loading"] = False
                state["verify_model_error"] = str(error)
        raise


def ensure_dirs() -> Path:
    day_dir = EVENT_IMAGES_DIR / datetime.now().strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    return day_dir


def write_log_line(payload: dict[str, Any]) -> None:
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    with EVENTS_LOG.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(payload, ensure_ascii=False) + "\n")


def is_authorized() -> bool:
    if not API_KEY:
        return True
    incoming = str(request.headers.get("X-Api-Key", "")).strip() or str(request.args.get("k", "")).strip()
    return incoming == API_KEY


def require_auth() -> None:
    if not is_authorized():
        abort(401)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def detect_motion(frame: np.ndarray) -> dict[str, Any]:
    preview = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    preview = cv2.resize(preview, (160, 120), interpolation=cv2.INTER_AREA)
    preview = cv2.GaussianBlur(preview, (5, 5), 0)
    preview = cv2.Canny(preview, 40, 120)

    previous = device_state.get("preview")
    motion_ratio = 0.0
    motion_detected = False

    if previous is not None and previous.shape == preview.shape:
        diff = cv2.absdiff(previous, preview)
        _, mask = cv2.threshold(diff, MOTION_DIFF_THRESHOLD, 255, cv2.THRESH_BINARY)
        motion_ratio = float(np.count_nonzero(mask) / mask.size)
        motion_detected = motion_ratio >= MOTION_MIN_RATIO

    device_state["preview"] = preview
    return {
        "motion_detected": motion_detected,
        "motion_ratio": round(motion_ratio, 5),
    }


def downscale_frame(frame: np.ndarray) -> np.ndarray:
    if MAX_INFER_WIDTH <= 0:
        return frame

    height, width = frame.shape[:2]
    if width <= MAX_INFER_WIDTH:
        return frame

    scale = MAX_INFER_WIDTH / width
    return cv2.resize(frame, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)


def build_kind(detections: list[dict[str, Any]]) -> str:
    labels = {item["label"] for item in detections}
    if "person" in labels:
        return "pessoa"
    if labels & VEHICLE_LABELS:
        return "veiculo"
    if labels & ANIMAL_LABELS:
        return "animal"
    return "outro"


def summarize_detections(detections: list[dict[str, Any]]) -> dict[str, Any]:
    labels = [item["label"] for item in detections]
    return {
        "labels": labels,
        "has_person": "person" in labels,
        "has_vehicle": bool(set(labels) & VEHICLE_LABELS),
        "has_animal": bool(set(labels) & ANIMAL_LABELS),
        "kind": build_kind(detections),
        "detections": detections,
    }


def get_min_confidence_for_class(class_id: int) -> float:
    rule = ALLOWED_SAVE_CLASS_RULES.get(int(class_id))
    if not rule:
        return DEFAULT_ALLOWED_MIN_CONF
    return float(rule.get("min_conf", DEFAULT_ALLOWED_MIN_CONF))


def log_skipped_detection(detection: dict[str, Any], reason: str) -> None:
    logger.debug(
        "skipped_detection reason=%s class_id=%s class_name=%s confidence=%.4f bbox_area_ratio=%.5f",
        reason,
        detection.get("class_id"),
        detection.get("label"),
        float(detection.get("confidence", 0.0)),
        float(detection.get("bbox_area_ratio", 0.0)),
    )


def filter_detections_for_save(detections: list[dict[str, Any]], now: float) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    last_saved_by_class = device_state.get("last_saved_by_class", {})

    for detection in detections:
        class_id = int(detection.get("class_id", -1))
        if class_id not in ALLOWED_SAVE_CLASS_RULES:
            log_skipped_detection(detection, "disallowed_class")
            continue

        confidence = float(detection.get("confidence", 0.0))
        bbox_area_ratio = float(detection.get("bbox_area_ratio", 0.0))
        min_confidence = get_min_confidence_for_class(class_id)

        if confidence < min_confidence:
            log_skipped_detection(detection, "low_confidence")
            continue

        if bbox_area_ratio < MIN_BBOX_AREA_RATIO:
            log_skipped_detection(detection, "small_box")
            continue

        cooldown_s = float(CLASS_COOLDOWN_SECONDS.get(class_id, 0.0))
        last_saved_at = float(last_saved_by_class.get(class_id, 0.0))
        if cooldown_s > 0 and (now - last_saved_at) < cooldown_s:
            log_skipped_detection(detection, "cooldown")
            continue

        kept.append(detection)

    kept.sort(key=lambda item: float(item.get("confidence", 0.0)), reverse=True)
    return kept


def apply_semantic_filters(frame_shape: tuple[int, ...], detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not SEMANTIC_FILTERS_ENABLED:
        return detections

    frame_height, frame_width = frame_shape[:2]
    frame_area = max(1, frame_height * frame_width)
    filtered: list[dict[str, Any]] = []

    for item in detections:
        label = str(item.get("label", "")).lower()
        confidence = float(item.get("confidence", 0.0))
        x1, y1, x2, y2 = item["bbox"]
        box_width = max(1, x2 - x1)
        box_height = max(1, y2 - y1)
        area_ratio = float((box_width * box_height) / frame_area)
        aspect_ratio = float(box_width / max(1, box_height))
        bottom_ratio = float(y2 / max(1, frame_height))

        # Strong person gate: suppress tiny/wide/top-of-frame false positives
        # caused by birds and moving palm shadows.
        if label == "person":
            if confidence < PERSON_MIN_CONF:
                continue
            if area_ratio < PERSON_MIN_AREA_RATIO:
                continue
            if aspect_ratio < PERSON_MIN_ASPECT_RATIO or aspect_ratio > PERSON_MAX_ASPECT_RATIO:
                continue
            if bottom_ratio < PERSON_MIN_BOTTOM_RATIO:
                continue

        if label == "bird":
            if confidence < BIRD_MIN_CONF:
                continue
            # Large "bird" boxes in this camera are often the white cat.
            if (
                area_ratio >= BIRD_TO_CAT_AREA_RATIO
                and aspect_ratio >= BIRD_TO_CAT_MIN_ASPECT_RATIO
                and bottom_ratio >= BIRD_TO_CAT_MIN_BOTTOM_RATIO
            ):
                item = {**item, "label": "cat", "relabel_reason": "large_bird_box"}

        filtered.append(item)

    filtered.sort(key=lambda entry: entry["confidence"], reverse=True)
    return filtered


def drop_label_from_result(result: dict[str, Any], label: str) -> dict[str, Any]:
    kept = [item for item in result.get("detections", []) if item.get("label") != label]
    return summarize_detections(kept)


def should_keep_person_without_verify(result: dict[str, Any], frame_shape: tuple[int, ...]) -> bool:
    frame_height, frame_width = frame_shape[:2]
    frame_area = max(1, frame_height * frame_width)
    person_items = [item for item in result.get("detections", []) if item.get("label") == "person"]
    if not person_items:
        return False

    best = max(person_items, key=lambda item: float(item.get("confidence", 0.0)))
    x1, y1, x2, y2 = best["bbox"]
    area_ratio = float(max(1, (x2 - x1) * (y2 - y1)) / frame_area)
    bottom_ratio = float(y2 / max(1, frame_height))
    confidence = float(best.get("confidence", 0.0))

    return (
        confidence >= PERSON_KEEP_WITHOUT_VERIFY_CONF
        and area_ratio >= PERSON_KEEP_WITHOUT_VERIFY_AREA_RATIO
        and bottom_ratio >= PERSON_KEEP_WITHOUT_VERIFY_BOTTOM_RATIO
    )


def run_detection(
    frame: np.ndarray,
    *,
    detector,
    model_names: dict[int, str],
    target_class_ids: list[int],
    min_conf: float,
    imgsz: int,
) -> dict[str, Any]:
    if detector is None:
        raise RuntimeError("model_not_ready")

    source = downscale_frame(frame)
    original_height, original_width = frame.shape[:2]
    frame_area = max(1, original_height * original_width)
    source_height, source_width = source.shape[:2]
    scale_x = original_width / max(1, source_width)
    scale_y = original_height / max(1, source_height)
    result = detector(
        source,
        verbose=False,
        conf=min_conf,
        imgsz=imgsz,
        classes=target_class_ids or None,
    )[0]

    detections: list[dict[str, Any]] = []
    for box in result.boxes:
        confidence = float(box.conf[0])
        if confidence < min_conf:
            continue

        class_id = int(box.cls[0])
        class_rule = ALLOWED_SAVE_CLASS_RULES.get(class_id)
        if not class_rule:
            continue
        label = str(class_rule["label"]).lower()

        raw_bbox = [int(value) for value in box.xyxy[0].tolist()]
        bbox = [
            int(raw_bbox[0] * scale_x),
            int(raw_bbox[1] * scale_y),
            int(raw_bbox[2] * scale_x),
            int(raw_bbox[3] * scale_y),
        ]
        bbox_width = max(1, bbox[2] - bbox[0])
        bbox_height = max(1, bbox[3] - bbox[1])
        bbox_area_ratio = float((bbox_width * bbox_height) / frame_area)
        detections.append(
            {
                "class_id": class_id,
                "label": label,
                "confidence": round(confidence, 4),
                "bbox": bbox,
                "bbox_area_ratio": round(bbox_area_ratio, 5),
            }
        )

    detections = apply_semantic_filters(frame.shape, detections)
    return summarize_detections(detections)


def annotate_frame(frame: np.ndarray, detections: list[dict[str, Any]], motion_ratio: float) -> np.ndarray:
    annotated = frame.copy()
    for item in detections:
        x1, y1, x2, y2 = item["bbox"]
        label = item["label"]
        confidence = item["confidence"]
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (38, 179, 94), 2)
        cv2.putText(
            annotated,
            f"{label} {confidence:.2f}",
            (x1, max(18, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (38, 179, 94),
            2,
            cv2.LINE_AA,
        )

    cv2.putText(
        annotated,
        f"{CAMERA_NAME} | motion {motion_ratio:.3f}",
        (12, 24),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return annotated


def encode_jpeg(frame: np.ndarray) -> bytes | None:
    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    if not ok:
        return None
    return buffer.tobytes()


def save_event_frame(frame: np.ndarray, event_kind: str) -> str | None:
    day_dir = ensure_dirs()
    kind_dir = day_dir / (str(event_kind or "outro").strip().lower() or "outro")
    kind_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    path = kind_dir / f"{timestamp}-{CAMERA_NAME}-{event_kind}.jpg"
    jpeg = encode_jpeg(frame)
    if jpeg is None:
        return None
    path.write_bytes(jpeg)
    return str(path)


def append_detection_csv_rows(timestamp: str, detections: list[dict[str, Any]], image_path: str | None) -> None:
    DETECTIONS_CSV.parent.mkdir(parents=True, exist_ok=True)
    file_exists = DETECTIONS_CSV.exists()

    with DETECTIONS_CSV.open("a", encoding="utf-8", newline="") as fp:
        writer = csv.writer(fp)
        if not file_exists:
            writer.writerow(["timestamp", "class_name", "confidence", "bbox_area_ratio", "image_path"])

        for detection in detections:
            writer.writerow(
                [
                    timestamp,
                    detection.get("label"),
                    f"{float(detection.get('confidence', 0.0)):.4f}",
                    f"{float(detection.get('bbox_area_ratio', 0.0)):.5f}",
                    image_path or "",
                ]
            )


def update_saved_class_timestamps(detections: list[dict[str, Any]], saved_at: float) -> None:
    last_saved_by_class = device_state.setdefault("last_saved_by_class", {})
    for detection in detections:
        class_id = int(detection.get("class_id", -1))
        if class_id in CLASS_COOLDOWN_SECONDS:
            last_saved_by_class[class_id] = saved_at


def compute_detection_score(frame: np.ndarray, detection: dict[str, Any]) -> float:
    detections = detection.get("detections", [])
    if not detections:
        return 0.0

    top = detections[0]
    x1, y1, x2, y2 = top["bbox"]
    frame_height, frame_width = frame.shape[:2]
    frame_area = max(1, frame_height * frame_width)
    box_area = max(1, (x2 - x1) * (y2 - y1))
    box_area_ratio = float(box_area / frame_area)
    top_conf = float(top.get("confidence", 0.0))

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sharpness_norm = min(1.0, sharpness / 300.0)
    multi_det_bonus = min(0.2, 0.03 * max(0, len(detections) - 1))

    return round((top_conf * 1.0) + (box_area_ratio * 1.8) + (sharpness_norm * 0.25) + multi_det_bonus, 6)


def build_event_signature(detection: dict[str, Any]) -> str:
    labels = detection.get("labels", [])
    primary_label = labels[0] if labels else detection.get("kind", "outro")
    return f"{detection.get('kind', 'outro')}:{primary_label}"


def create_event_payload(
    *,
    detection: dict[str, Any],
    frame: np.ndarray,
    motion_ratio: float,
    verification: dict[str, Any],
) -> dict[str, Any]:
    saved_frame = annotate_frame(frame, detection["detections"], motion_ratio) if ANNOTATE_SAVED_IMAGES else frame
    image_path = save_event_frame(saved_frame, detection["kind"])
    timestamp = now_iso()
    saved_at = time.time()
    payload = {
        "camera_name": CAMERA_NAME,
        "timestamp": timestamp,
        "kind": detection["kind"],
        "labels": detection["labels"],
        "detections": detection["detections"],
        "motion_ratio": motion_ratio,
        "image_path": image_path,
        "verification": verification,
    }
    events_cache.appendleft(payload)
    write_log_line(payload)
    update_saved_class_timestamps(detection["detections"], saved_at)
    append_detection_csv_rows(timestamp, detection["detections"], image_path)
    for item in detection["detections"]:
        logger.info(
            "saved_detection class_name=%s confidence=%.4f bbox_area_ratio=%.5f image_path=%s",
            item.get("label"),
            float(item.get("confidence", 0.0)),
            float(item.get("bbox_area_ratio", 0.0)),
            image_path,
        )
    return payload


def flush_pending_best_event(now: float, force: bool = False) -> dict[str, Any] | None:
    pending = device_state.get("pending_best_event")
    if not pending:
        return None

    idle_gap = now - float(pending["last_seen_at"])
    age = now - float(pending["started_at"])
    if not force and idle_gap < BEST_EVENT_GAP_S and age < BEST_EVENT_MAX_HOLD_S:
        return None

    payload = create_event_payload(
        detection=pending["detection"],
        frame=pending["frame"],
        motion_ratio=float(pending["motion_ratio"]),
        verification=pending["verification"],
    )
    device_state["pending_best_event"] = None
    return payload


def stage_best_event_candidate(
    *,
    now: float,
    detection: dict[str, Any],
    frame: np.ndarray,
    motion_ratio: float,
    verification: dict[str, Any],
) -> dict[str, Any] | None:
    signature = build_event_signature(detection)
    score = compute_detection_score(frame, detection)
    pending = device_state.get("pending_best_event")

    candidate = {
        "started_at": now,
        "last_seen_at": now,
        "signature": signature,
        "score": score,
        "detection": detection,
        "frame": frame.copy(),
        "motion_ratio": motion_ratio,
        "verification": verification,
    }

    if pending is None:
        device_state["pending_best_event"] = candidate
        return None

    if pending["signature"] != signature:
        payload = flush_pending_best_event(now, force=True)
        device_state["pending_best_event"] = candidate
        return payload

    pending["last_seen_at"] = now
    if score >= float(pending["score"]) + BEST_REPLACE_SCORE_DELTA:
        pending["score"] = score
        pending["detection"] = detection
        pending["frame"] = frame.copy()
        pending["motion_ratio"] = motion_ratio
        pending["verification"] = verification

    if (now - float(pending["started_at"])) >= BEST_EVENT_MAX_HOLD_S:
        payload = flush_pending_best_event(now, force=True)
        device_state["pending_best_event"] = candidate
        return payload

    return None


def snapshot_state() -> dict[str, Any]:
    with state_lock:
        payload = deepcopy(state)
    payload.pop("latest_jpeg", None)
    payload["rtsp_url"] = masked_rtsp_url(RTSP_URL)
    payload["verify_rtsp_url"] = masked_rtsp_url(VERIFY_RTSP_URL) if VERIFY_STREAM_ACTIVE else ""
    if payload.get("last_event"):
        payload["last_event"] = enrich_event_payload(payload["last_event"])
    payload["event_count"] = len(events_cache)
    return payload


def event_relpath_from_image_path(image_path: str | None) -> str | None:
    text = str(image_path or "").strip()
    if not text:
        return None

    try:
        resolved = Path(text).resolve()
        return resolved.relative_to(EVENTS_DIR.resolve()).as_posix()
    except Exception:
        return None


def resolve_event_image_path(relpath: str) -> Path | None:
    text = str(relpath or "").strip().lstrip("/")
    if not text:
        return None

    try:
        candidate = (EVENTS_DIR / text).resolve()
        candidate.relative_to(EVENTS_DIR.resolve())
        if not candidate.is_file():
            return None
        return candidate
    except Exception:
        return None


def enrich_event_payload(event: dict[str, Any] | None) -> dict[str, Any] | None:
    if not event:
        return event

    payload = deepcopy(event)
    relpath = event_relpath_from_image_path(payload.get("image_path"))
    payload["image_relpath"] = relpath
    payload["image_url_path"] = f"/event-image/{relpath}" if relpath else None

    detections = list(payload.get("detections") or [])
    if detections:
        top_detection = max(detections, key=lambda item: float(item.get("confidence", 0.0)))
        top_label = str(top_detection.get("label") or "evento").lower()
        top_confidence = float(top_detection.get("confidence", 0.0))
        payload["label"] = top_label
        payload["label_pt"] = DISPLAY_LABELS_PT.get(top_label, top_label.title())
        payload["title"] = DISPLAY_TITLES_PT.get(top_label, f"{payload['label_pt']} detectado")
        payload["confidence"] = round(top_confidence, 4)
        payload["confidence_pct"] = int(round(top_confidence * 100.0))
    else:
        payload["label"] = None
        payload["label_pt"] = None
        payload["title"] = "Evento detectado"
        payload["confidence"] = 0.0
        payload["confidence_pct"] = 0

    payload["time"] = format_time_for_display(str(payload.get("timestamp") or ""))
    return payload


def format_time_for_display(raw_timestamp: str) -> str:
    text = str(raw_timestamp or "").strip()
    if not text:
        return "--:--:--"

    try:
        return datetime.fromisoformat(text).strftime("%H:%M:%S")
    except Exception:
        if "T" in text:
            return text.split("T", 1)[1][:8]
        return text[:8]


def build_display_event_payload(event: dict[str, Any] | None) -> dict[str, Any]:
    if not event:
        return {
            "ok": True,
            "has_event": False,
            "title": "Aguardando evento",
            "time": "--:--:--",
            "confidence_pct": 0,
            "camera_name": CAMERA_NAME,
        }

    detections = list(event.get("detections") or [])
    if not detections:
        return {
            "ok": True,
            "has_event": False,
            "title": "Aguardando evento",
            "time": format_time_for_display(str(event.get("timestamp") or "")),
            "confidence_pct": 0,
            "camera_name": str(event.get("camera_name") or CAMERA_NAME),
        }

    top_detection = max(detections, key=lambda item: float(item.get("confidence", 0.0)))
    top_label = str(top_detection.get("label") or "evento").lower()
    top_confidence = float(top_detection.get("confidence", 0.0))
    label_pt = DISPLAY_LABELS_PT.get(top_label, top_label.title())
    title = DISPLAY_TITLES_PT.get(top_label, f"{label_pt} detectado")
    timestamp = str(event.get("timestamp") or "")

    labels = [str(item.get("label") or "") for item in detections]
    labels_pt = [DISPLAY_LABELS_PT.get(label, label.title()) for label in labels]

    enriched = enrich_event_payload(event) or {}
    return {
        "ok": True,
        "has_event": True,
        "event_id": f"{timestamp}|{top_label}|{event.get('image_path') or ''}",
        "camera_name": str(event.get("camera_name") or CAMERA_NAME),
        "timestamp": timestamp,
        "time": format_time_for_display(timestamp),
        "title": title,
        "label": top_label,
        "label_pt": label_pt,
        "labels": labels,
        "labels_pt": labels_pt,
        "kind": str(event.get("kind") or "outro"),
        "confidence": round(top_confidence, 4),
        "confidence_pct": int(round(top_confidence * 100.0)),
        "image_path": event.get("image_path"),
        "image_relpath": enriched.get("image_relpath"),
        "image_url_path": enriched.get("image_url_path"),
    }


def get_latest_event() -> dict[str, Any] | None:
    return events_cache[0] if events_cache else state.get("last_event")


def build_display_event_id(event: dict[str, Any] | None) -> str:
    payload = build_display_event_payload(event)
    return str(payload.get("event_id") or "")


def blank_display_bitmap() -> bytes:
    return bytes((DISPLAY_BITMAP_WIDTH * DISPLAY_BITMAP_HEIGHT) // 8)


def resize_for_display_bitmap(image: np.ndarray, width: int, height: int) -> np.ndarray:
    src_h, src_w = image.shape[:2]
    if src_h <= 0 or src_w <= 0:
        return np.zeros((height, width), dtype=np.uint8)

    scale = min(width / float(src_w), height / float(src_h))
    dst_w = max(1, int(round(src_w * scale)))
    dst_h = max(1, int(round(src_h * scale)))
    resized = cv2.resize(image, (dst_w, dst_h), interpolation=cv2.INTER_AREA)

    canvas = np.zeros((height, width), dtype=np.uint8)
    x = max(0, (width - dst_w) // 2)
    y = max(0, (height - dst_h) // 2)
    canvas[y : y + dst_h, x : x + dst_w] = resized
    return canvas


def render_event_bitmap_bytes(event: dict[str, Any] | None) -> bytes:
    if not event:
        return blank_display_bitmap()

    image_path = str(event.get("image_path") or "").strip()
    if not image_path or not Path(image_path).exists():
        return blank_display_bitmap()

    image = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if image is None or image.size == 0:
        return blank_display_bitmap()

    crop = image
    detections = list(event.get("detections") or [])
    if detections:
        top_detection = max(detections, key=lambda item: float(item.get("confidence", 0.0)))
        x1, y1, x2, y2 = [int(v) for v in top_detection.get("bbox", [0, 0, image.shape[1], image.shape[0]])]
        box_w = max(1, x2 - x1)
        box_h = max(1, y2 - y1)
        pad_x = max(8, int(box_w * 0.25))
        pad_y = max(8, int(box_h * 0.25))
        cx1 = max(0, x1 - pad_x)
        cy1 = max(0, y1 - pad_y)
        cx2 = min(image.shape[1], x2 + pad_x)
        cy2 = min(image.shape[0], y2 + pad_y)
        candidate = image[cy1:cy2, cx1:cx2]
        if candidate.size > 0:
            crop = candidate

    enhanced = cv2.equalizeHist(crop)
    enhanced = cv2.GaussianBlur(enhanced, (3, 3), 0)
    fitted = resize_for_display_bitmap(enhanced, DISPLAY_BITMAP_WIDTH, DISPLAY_BITMAP_HEIGHT)
    _, binary = cv2.threshold(fitted, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bitmap = (binary > 0).astype(np.uint8)
    packed = np.packbits(bitmap, axis=1, bitorder="big")
    return packed.tobytes()


def open_capture(rtsp_url: str) -> cv2.VideoCapture:
    capture = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    if not capture.isOpened():
        capture.release()
        capture = cv2.VideoCapture(rtsp_url)
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 2)
    return capture


def capture_single_frame(rtsp_url: str, frames_to_skip: int = 1) -> np.ndarray | None:
    if not rtsp_url:
        return None

    capture = open_capture(rtsp_url)
    if not capture.isOpened():
        capture.release()
        return None

    frame = None
    try:
        for _ in range(max(1, frames_to_skip)):
            ok, candidate = capture.read()
            if ok and candidate is not None:
                frame = candidate
        return frame
    finally:
        capture.release()


def set_error(message: str) -> None:
    with state_lock:
        state["connected"] = False
        state["last_error"] = message


def capture_loop() -> None:
    while True:
        try:
            load_model_if_needed()
        except Exception as error:
            set_error(f"model_load_failed:{error}")
            time.sleep(RECONNECT_DELAY_S)
            continue

        if not RTSP_URL:
            set_error("rtsp_url_missing")
            time.sleep(RECONNECT_DELAY_S)
            continue

        capture = open_capture(RTSP_URL)
        if not capture.isOpened():
            set_error("rtsp_connect_failed")
            time.sleep(RECONNECT_DELAY_S)
            continue

        with state_lock:
            state["connected"] = True
            state["last_error"] = None

        try:
            while True:
                ok, frame = capture.read()
                if not ok or frame is None:
                    raise RuntimeError("rtsp_read_failed")

                now = time.time()
                motion = detect_motion(frame)
                should_infer = (
                    motion["motion_detected"]
                    or (now - float(device_state.get("last_infer_at", 0.0))) >= DETECT_INTERVAL_S
                )

                with state_lock:
                    state["frames_seen"] = int(state["frames_seen"]) + 1
                    state["last_frame_at"] = now_iso()
                    state["motion_ratio"] = motion["motion_ratio"]

                if not should_infer:
                    if now - float(device_state.get("last_preview_at", 0.0)) >= 1.5:
                        preview_jpeg = encode_jpeg(frame)
                        if preview_jpeg is not None:
                            with state_lock:
                                state["latest_jpeg"] = preview_jpeg
                        device_state["last_preview_at"] = now
                    continue

                device_state["last_infer_at"] = now
                detection = run_detection(
                    frame,
                    detector=primary_model,
                    model_names=PRIMARY_MODEL_NAMES,
                    target_class_ids=PRIMARY_TARGET_CLASS_IDS,
                    min_conf=MIN_CONF,
                    imgsz=PRIMARY_IMGSZ,
                )
                latest_jpeg = encode_jpeg(frame)

                event_payload = None
                save_ready_detections: list[dict[str, Any]] = []
                if detection["detections"]:
                    final_detection = detection
                    final_frame = frame
                    verification = {
                        "used": False,
                        "confirmed": False,
                        "source": "primary",
                        "rtsp_url": masked_rtsp_url(VERIFY_RTSP_URL) if VERIFY_STREAM_ACTIVE else "",
                        "fallback_to_primary": False,
                    }

                    if VERIFY_STREAM_ACTIVE:
                        verification["used"] = True
                        verify_frame = capture_single_frame(VERIFY_RTSP_URL, VERIFY_FRAME_SKIP)
                        if verify_frame is not None:
                            verified_detection = run_detection(
                                verify_frame,
                                detector=verify_model,
                                model_names=VERIFY_MODEL_NAMES,
                                target_class_ids=VERIFY_TARGET_CLASS_IDS,
                                min_conf=VERIFY_MIN_CONF,
                                imgsz=VERIFY_IMGSZ,
                            )
                            verification.update(
                                {
                                    "confirmed": bool(verified_detection["detections"]),
                                    "source": "verify_rtsp",
                                    "labels": verified_detection["labels"],
                                    "kind": verified_detection["kind"],
                                    "detections": verified_detection["detections"],
                                }
                            )

                            if verified_detection["detections"]:
                                final_detection = verified_detection
                                final_frame = verify_frame
                            else:
                                verification["fallback_to_primary"] = True
                                if REQUIRE_VERIFY_FOR_PERSON and final_detection["has_person"]:
                                    if should_keep_person_without_verify(final_detection, frame.shape):
                                        verification["kept_unverified_person"] = True
                                    else:
                                        final_detection = drop_label_from_result(final_detection, "person")
                                        final_frame = frame
                                if VERIFY_REQUIRED and not SAVE_PRIMARY_ON_VERIFY_MISS:
                                    final_detection = None
                        else:
                            verification["source"] = "verify_rtsp_unavailable"
                            verification["fallback_to_primary"] = True
                            if REQUIRE_VERIFY_FOR_PERSON and final_detection["has_person"]:
                                if should_keep_person_without_verify(final_detection, frame.shape):
                                    verification["kept_unverified_person"] = True
                                else:
                                    final_detection = drop_label_from_result(final_detection, "person")
                                    final_frame = frame
                            if VERIFY_REQUIRED and not SAVE_PRIMARY_ON_VERIFY_MISS:
                                final_detection = None

                    if final_detection is not None and not final_detection["detections"]:
                        final_detection = None

                    if final_detection is not None:
                        save_ready_detections = filter_detections_for_save(final_detection["detections"], now)
                        final_detection = summarize_detections(save_ready_detections)
                        if not final_detection["detections"]:
                            final_detection = None

                    if final_detection is not None:
                        if SAVE_BEST_ONLY:
                            staged_payload = stage_best_event_candidate(
                                now=now,
                                detection=final_detection,
                                frame=final_frame,
                                motion_ratio=motion["motion_ratio"],
                                verification=verification,
                            )
                            if staged_payload is not None:
                                device_state["last_event_at"] = now
                                event_payload = staged_payload
                        else:
                            event_gap_s = SNAPSHOT_INTERVAL_S if SAVE_ALL_DETECTIONS else EVENT_COOLDOWN_S
                            if (now - float(device_state.get("last_event_at", 0.0))) >= event_gap_s:
                                device_state["last_event_at"] = now
                                event_payload = create_event_payload(
                                    detection=final_detection,
                                    frame=final_frame,
                                    motion_ratio=motion["motion_ratio"],
                                    verification=verification,
                                )
                    elif SAVE_BEST_ONLY:
                        staged_payload = flush_pending_best_event(now, force=False)
                        if staged_payload is not None:
                            device_state["last_event_at"] = now
                            event_payload = staged_payload
                elif SAVE_BEST_ONLY:
                    staged_payload = flush_pending_best_event(now, force=False)
                    if staged_payload is not None:
                        device_state["last_event_at"] = now
                        event_payload = staged_payload

                with state_lock:
                    state["last_infer_at"] = now_iso()
                    state["last_detection"] = {
                        "timestamp": now_iso(),
                        **motion,
                        **detection,
                        "save_candidates": save_ready_detections if detection["detections"] else [],
                    }
                    if latest_jpeg is not None:
                        state["latest_jpeg"] = latest_jpeg
                    if event_payload is not None:
                        state["last_event_at"] = event_payload["timestamp"]
                        state["last_event"] = event_payload
        except Exception as error:
            flushed_payload = flush_pending_best_event(time.time(), force=True)
            if flushed_payload is not None:
                with state_lock:
                    state["last_event_at"] = flushed_payload["timestamp"]
                    state["last_event"] = flushed_payload
            set_error(str(error))
            time.sleep(RECONNECT_DELAY_S)
        finally:
            capture.release()


@app.get("/health")
def health() -> Response:
    require_auth()
    payload = snapshot_state()
    payload["ok"] = True
    payload["ready"] = bool(payload.get("model_ready"))
    return jsonify(payload)


@app.get("/status")
def status() -> Response:
    require_auth()
    payload = snapshot_state()
    payload["ok"] = True
    payload["events"] = [enrich_event_payload(item) for item in list(events_cache)[:20]]
    return jsonify(payload)


@app.get("/events")
def events() -> Response:
    require_auth()
    limit = max(1, min(100, int(request.args.get("limit", "20"))))
    return jsonify({"ok": True, "items": [enrich_event_payload(item) for item in list(events_cache)[:limit]]})


@app.get("/display-event")
def display_event() -> Response:
    require_auth()
    latest_event = get_latest_event()
    return jsonify(build_display_event_payload(latest_event))


@app.get("/display-event-bitmap")
def display_event_bitmap() -> Response:
    require_auth()
    latest_event = get_latest_event()
    bitmap = render_event_bitmap_bytes(latest_event)
    response = Response(bitmap, mimetype="application/octet-stream")
    response.headers["X-Display-Width"] = str(DISPLAY_BITMAP_WIDTH)
    response.headers["X-Display-Height"] = str(DISPLAY_BITMAP_HEIGHT)
    response.headers["X-Event-Id"] = build_display_event_id(latest_event)
    response.headers["X-Has-Event"] = "1" if latest_event else "0"
    return response


@app.get("/event-image/<path:relpath>")
def event_image(relpath: str) -> Response:
    require_auth()
    image_path = resolve_event_image_path(relpath)
    if image_path is None:
        abort(404)
    return send_file(image_path, mimetype="image/jpeg", conditional=True, max_age=5)


@app.get("/latest.jpg")
def latest_jpg() -> Response:
    require_auth()
    with state_lock:
        jpeg = state.get("latest_jpeg")

    if not jpeg:
        abort(404)
    return Response(jpeg, mimetype="image/jpeg")


@app.get("/")
def home() -> str:
    require_auth()
    query_suffix = f"?k={quote_plus(API_KEY)}" if API_KEY else ""
    return f"""<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Detector RTSP {CAMERA_NAME}</title>
    <style>
      body {{
        margin: 0;
        font-family: system-ui, sans-serif;
        background: #10171a;
        color: #edf3f5;
      }}
      main {{
        max-width: 1100px;
        margin: 0 auto;
        padding: 20px;
        display: grid;
        gap: 16px;
      }}
      .card {{
        background: #172126;
        border: 1px solid #2a3a41;
        border-radius: 18px;
        padding: 16px;
      }}
      img {{
        width: 100%;
        border-radius: 12px;
        display: block;
        background: #0b1114;
      }}
      pre {{
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 13px;
      }}
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Detector RTSP {CAMERA_NAME}</h1>
        <p>Origem: {masked_rtsp_url(RTSP_URL)}</p>
      </section>
      <section class="card">
        <img id="frame" src="/latest.jpg{query_suffix}" alt="ultimo frame" />
      </section>
      <section class="card">
        <pre id="status">Carregando...</pre>
      </section>
    </main>
    <script>
      const frame = document.getElementById('frame');
      const statusNode = document.getElementById('status');
      const suffix = "{query_suffix}";
      const separator = suffix ? '&' : '?';

      async function refresh() {{
        frame.src = `/latest.jpg${{suffix}}${{separator}}_ts=${{Date.now()}}`;
        const response = await fetch(`/status${{suffix}}`);
        const data = await response.json();
        statusNode.textContent = JSON.stringify(data, null, 2);
      }}

      refresh().catch(console.error);
      setInterval(() => refresh().catch(console.error), 3000);
    </script>
  </body>
</html>"""


def main() -> None:
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    EVENT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=capture_loop, daemon=True, name="rtsp-capture").start()
    app.run(host="0.0.0.0", port=PORT, debug=False)


if __name__ == "__main__":
    main()
