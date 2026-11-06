#!/usr/bin/env python3
"""
Door camera agent (reference implementation) — runs on a small computer at the gym, next to the CCTV recorder.

What it does
  1. Every SYNC_SECONDS it downloads, from the gym system, the photos of the members of ITS location who opted in
     to face access (GET /api/v1/public/device/enrolment). Members who withdraw consent disappear at the next sync
     and their templates are dropped from memory.
  2. It computes one face template per photo ON THIS MACHINE and keeps them in memory only (never on disk).
  3. It reads the camera stream (RTSP/ONVIF URL of the CCTV channel that films the door), finds faces, compares them
     with the templates and, when the SAME member is the best match in at least CONFIRM_FRAMES frames within
     CONFIRM_WINDOW seconds, reports (member_id, score, direction) to POST /api/v1/public/device/recognitions.
  4. Faces that match nobody are discarded immediately: no image, template or log line about them leaves the machine.
  The server decides: score >= 0.62 automatic entry/exit, 0.45-0.62 front-desk review, lower refused
  [VERIFICAR: calibrate with the model actually deployed, on the gym's own camera and lighting].

Requirements (only for the real camera mode)
  pip install opencv-python-headless numpy insightface onnxruntime requests
  IMPORTANT [VERIFICAR · licence]: InsightFace's pretrained models (e.g. "buffalo_l") are published for
  NON-COMMERCIAL research use. A commercial deployment needs a commercially licensed face model or service.
  The Embedder class below is the only place to swap it.

Configuration (environment variables)
  GYM_API          https://your-site/api/v1
  DEVICE_KEY       "<device id>:<secret>" exactly as shown once in "Puerta y acceso → Cámaras de la puerta"
  CAMERA_URL       rtsp://user:pass@192.168.1.20:554/Streaming/Channels/101   (never commit this)
  DIRECTION        in | out   (only used when the device was registered as "Entrada y salida")
  CAMERA_PROFILE   wyze | generic   (default generic). "wyze": RTSP over TCP, analyse 1 frame in 3, reconnect fast.
  FRAME_STRIDE     analyse 1 of every N frames (default 1; wyze 3)

Wyze cameras (Cam v3 / Pan v3 with RTSP in the Wyze app: Settings → Advanced Settings → RTSP)
  * Copy the URL the Wyze app generates EXACTLY (the path differs between firmwares: /live or /stream0).
  * Give the camera a fixed IP (DHCP reservation in the router). Never expose RTSP to the internet.
  * Wyze has no liveness detection: register the camera with "Siempre confirmar en recepción" (default ON).
  * Run `python3 agent.py --probe` first: it reports resolution, FPS, dropped frames and face sizes in pixels.
    ArcFace-style models work on 112×112 face crops; faces under ~80 px wide are unreliable [INFERENCIA].

Self-test (no camera, no model): python3 agent.py --selftest
  Uses a deterministic fake embedder and the real API: syncs enrolment, "recognises" the first enrolled member and
  prints the server's answer. Run it against the demo or a staging site, never against production members.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

SYNC_SECONDS = 300
CONFIRM_FRAMES = 3
CONFIRM_WINDOW = 2.0
MIN_SCORE_TO_REPORT = 0.45  # below this the server refuses anyway; do not even send it
COOLDOWN_SECONDS = 60  # the server also folds repeats within 60 s into one event


# ── API client ─────────────────────────────────────────────────────────────────────────────────────────────
class Api:
    def __init__(self, base: str, device_key: str):
        if ":" not in device_key:
            raise SystemExit("DEVICE_KEY must be '<device id>:<secret>'")
        self.base = base.rstrip("/")
        self.auth = f"Device {device_key.strip()}"

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(
            f"{self.base}{path}",
            data=data,
            method=method,
            headers={"Authorization": self.auth, "Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return {"error": e.code, "body": e.read().decode(errors="replace")[:200]}

    def enrolment(self) -> dict:
        return self._call("GET", "/public/device/enrolment")

    def recognition(self, member_id: str, score: float, direction: str | None) -> dict:
        body = {"member_id": member_id, "score": round(max(0.0, min(1.0, score)), 4)}
        if direction:
            body["direction"] = direction
        return self._call("POST", "/public/device/recognitions", body)


# ── Face model (swap here for a commercially licensed one) ─────────────────────────────────────────────────
class Embedder:
    """Detects faces and returns L2-normalised embeddings. Reference: InsightFace (research licence)."""

    def __init__(self) -> None:
        from insightface.app import FaceAnalysis  # imported lazily: not needed for --selftest

        self.app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=0, det_size=(640, 640))

    def faces(self, bgr_image) -> list:
        """List of (embedding, face_box_area) for every face found."""
        import numpy as np

        out = []
        for f in self.app.get(bgr_image):
            e = f.normed_embedding.astype(np.float32)
            x1, y1, x2, y2 = f.bbox
            out.append((e, float((x2 - x1) * (y2 - y1))))
        return out

    def from_photo(self, jpeg: bytes):
        import cv2
        import numpy as np

        img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        found = self.faces(img) if img is not None else []
        if not found:
            return None
        return max(found, key=lambda x: x[1])[0]  # the largest face in the enrolment photo


class FakeEmbedder:
    """Deterministic stand-in for --selftest: the 'template' is derived from the photo bytes."""

    def from_photo(self, jpeg: bytes):
        import hashlib

        h = hashlib.sha256(jpeg).digest()
        v = [b / 255.0 - 0.5 for b in h]
        n = sum(x * x for x in v) ** 0.5 or 1.0
        return [x / n for x in v]


def cosine(a, b) -> float:
    return float(sum(x * y for x, y in zip(a, b)))


# ── Gallery and confirmation ───────────────────────────────────────────────────────────────────────────────
@dataclass
class Gallery:
    templates: dict = field(default_factory=dict)  # member_id -> (template, photo updated_at)
    names: dict = field(default_factory=dict)
    enabled: bool = False
    refused: bool = False
    requires_review: bool = False
    direction: str = "in"

    def sync(self, api: Api, embedder) -> None:
        r = api.enrolment()
        if "error" in r:
            print(f"[sync] refused: {r}", file=sys.stderr)
            self.enabled = False
            self.refused = True
            self.templates.clear()  # fail closed: no access decisions without a valid enrolment
            return
        self.refused = False
        self.enabled = bool(r.get("enabled"))
        self.direction = r.get("direction", "in")
        members = r.get("members", []) if self.enabled else []
        seen = set()
        for m in members:
            mid = m["member_id"]
            seen.add(mid)
            cached = self.templates.get(mid)
            if cached and cached[1] == m.get("updated_at"):
                continue
            tpl = embedder.from_photo(base64.b64decode(m["photo"]))
            if tpl is None:
                self.templates.pop(mid, None)
                continue
            self.templates[mid] = (tpl, m.get("updated_at"))
            self.names[mid] = m.get("full_name", "")
        for gone in set(self.templates) - seen:  # consent withdrawn, photo removed or face access off
            self.templates.pop(gone, None)
            self.names.pop(gone, None)
        self.requires_review = bool(r.get("requires_review"))
        print(
            f"[sync] face access {'ON' if self.enabled else 'OFF'} · {len(self.templates)} members enrolled"
            f" · {'front desk confirms every match' if self.requires_review else 'automatic above 0.62'}"
        )

    def best(self, emb) -> tuple[str | None, float]:
        best_id, best = None, -1.0
        for mid, (tpl, _) in self.templates.items():
            s = cosine(emb, tpl)
            if s > best:
                best_id, best = mid, s
        return best_id, best


class Confirmer:
    """Only report a member seen as best match in CONFIRM_FRAMES frames within CONFIRM_WINDOW seconds."""

    def __init__(self) -> None:
        self.hits: dict[str, list[tuple[float, float]]] = {}
        self.last_report: dict[str, float] = {}

    def add(self, member: str, score: float, now: float) -> float | None:
        h = [x for x in self.hits.get(member, []) if now - x[0] <= CONFIRM_WINDOW] + [(now, score)]
        self.hits[member] = h
        if len(h) < CONFIRM_FRAMES or now - self.last_report.get(member, 0) < COOLDOWN_SECONDS:
            return None
        self.last_report[member] = now
        self.hits[member] = []
        return sorted(s for _, s in h)[len(h) // 2]  # median score of the confirming frames


def open_capture(camera_url: str):
    """OpenCV capture; RTSP over TCP (UDP drops packets on Wi-Fi cameras such as Wyze)."""
    os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;5000000")
    import cv2

    return cv2.VideoCapture(camera_url, cv2.CAP_FFMPEG)


def profile_stride() -> int:
    if os.environ.get("FRAME_STRIDE"):
        return max(1, int(os.environ["FRAME_STRIDE"]))
    return 3 if os.environ.get("CAMERA_PROFILE", "").lower() == "wyze" else 1


def probe(camera_url: str, seconds: float = 10.0) -> int:
    """Check the stream before going live: resolution, FPS, read failures and (if a model is installed) face sizes."""
    cap = open_capture(camera_url)
    if not cap.isOpened():
        print("probe: cannot open the stream (URL, credentials, network, RTSP enabled in the camera app?)")
        return 2
    try:
        embedder = Embedder()
    except Exception as e:  # model not installed: still report the stream
        embedder = None
        print(f"probe: no face model ({type(e).__name__}); reporting the stream only")
    start, frames, fails, widths, shape = time.time(), 0, 0, [], None
    streak, stopped = 0, False
    while time.time() - start < seconds:
        ok, frame = cap.read()
        if not ok:
            fails += 1
            streak += 1
            if streak >= 50:  # ~2.5 s without a frame: the stream ended or dropped
                stopped = True
                break
            time.sleep(0.05)
            continue
        streak = 0
        frames += 1
        shape = frame.shape
        if embedder is not None and frames % 5 == 0:
            for f in embedder.app.get(frame):
                x1, _y1, x2, _y2 = f.bbox
                widths.append(int(x2 - x1))
        del frame
    cap.release()
    elapsed = max(0.001, time.time() - start - (2.5 if stopped else 0))
    fps = frames / elapsed
    print(f"probe: {shape[1] if shape else '?'}x{shape[0] if shape else '?'} · {fps:.1f} fps · {frames} frames"
          f" · {fails} failed reads")
    if stopped:
        print("probe: the stream stopped sending frames (Wi-Fi drop, camera reboot or end of a test file)")
    if widths:
        widths.sort()
        med = widths[len(widths) // 2]
        print(f"probe: {len(widths)} faces · median width {med}px · min {widths[0]}px · max {widths[-1]}px")
        if med < 80:
            print("probe: faces are small — move the camera closer to the door or use a narrower view")
    elif embedder is not None:
        print("probe: no faces seen — stand in front of the door during the probe")
    return 0


# ── Main loops ────────────────────────────────────────────────────────────────────────────────────────────
def run_camera(api: Api, camera_url: str, direction: str | None) -> None:
    embedder = Embedder()
    gallery = Gallery()
    confirmer = Confirmer()
    gallery.sync(api, embedder)
    next_sync = time.time() + SYNC_SECONDS
    cap = open_capture(camera_url)
    if not cap.isOpened():
        raise SystemExit("cannot open CAMERA_URL")
    stride = profile_stride()
    n = 0
    while True:
        ok, frame = cap.read()
        now = time.time()
        n += 1
        if now >= next_sync:
            gallery.sync(api, embedder)
            next_sync = now + SYNC_SECONDS
        if not ok:
            time.sleep(1)
            cap.release()
            cap = open_capture(camera_url)  # Wi-Fi cameras drop the stream now and then
            continue
        if n % stride:
            continue
        if not gallery.enabled or not gallery.templates:
            time.sleep(0.5)
            continue
        for emb, _area in embedder.faces(frame):
            member, score = gallery.best(emb)
            if member is None or score < MIN_SCORE_TO_REPORT:
                continue  # an unknown face: dropped here, never stored or sent
            confirmed = confirmer.add(member, score, now)
            if confirmed is not None:
                r = api.recognition(member, confirmed, direction)
                print(f"[door] {gallery.names.get(member, member)} score={confirmed:.2f} → {r.get('outcome', r)}")
        del frame  # frames live only in memory


def selftest(api: Api) -> int:
    gallery = Gallery()
    gallery.sync(api, FakeEmbedder())
    if gallery.refused:
        print("selftest: the server refused DEVICE_KEY (wrong, revoked or from another site).")
        return 4
    if not gallery.enabled:
        print("selftest: face access is OFF for this device's location (owner enables it in 'Puerta y acceso').")
        return 2
    if not gallery.templates:
        print("selftest: nobody enrolled (members must opt in and have a photo).")
        return 3
    member = next(iter(gallery.templates))
    tpl = gallery.templates[member][0]
    found, score = gallery.best(tpl)  # the same template: a perfect match
    assert found == member and score > 0.99, (found, score)
    c = Confirmer()
    t0 = time.time()
    results = [c.add(member, 0.9, t0 + i * 0.3) for i in range(CONFIRM_FRAMES)]
    assert results[:-1] == [None] * (CONFIRM_FRAMES - 1) and results[-1] is not None
    r = api.recognition(member, 0.9, None)
    print(f"selftest: reported {gallery.names.get(member)} → {r}")
    return 0 if r.get("outcome") in {"checked_in", "already_in", "checked_out", "not_in", "duplicate", "denied"} else 1


def main() -> int:
    p = argparse.ArgumentParser(description="Gym door camera agent (reference).")
    p.add_argument("--selftest", action="store_true", help="exercise the protocol without camera or model")
    p.add_argument("--probe", action="store_true", help="check the camera stream (needs CAMERA_URL only)")
    a = p.parse_args()
    if a.probe:
        cam = os.environ.get("CAMERA_URL")
        if not cam:
            print("Set CAMERA_URL to the door camera stream.", file=sys.stderr)
            return 64
        return probe(cam)
    base = os.environ.get("GYM_API")
    key = os.environ.get("DEVICE_KEY")
    if not base or not key:
        print("Set GYM_API and DEVICE_KEY (see the header of this file).", file=sys.stderr)
        return 64
    api = Api(base, key)
    if a.selftest:
        return selftest(api)
    cam = os.environ.get("CAMERA_URL")
    if not cam:
        print("Set CAMERA_URL to the door camera stream.", file=sys.stderr)
        return 64
    run_camera(api, cam, os.environ.get("DIRECTION"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
