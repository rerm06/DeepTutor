# Wyze cameras (RTSP) for door face check-in

## What is verified and what is not
* Wyze's own help centre treats RTSP as a feature it is still assessing; a 2026 third-party guide reports native RTSP
  on production firmware for **Cam v3 (4.36.16.5654)** and **Cam Pan v3**, and unclear status for **Cam v4**;
  users report the menu missing on some newer builds. [VERIFICAR on your camera: Settings → Advanced Settings → RTSP]
* The URL path differs by firmware (`/live` or `/stream0`). **Copy the URL the Wyze app shows, exactly.**
* Without native RTSP, the community `docker-wyze-bridge` re-publishes Wyze streams as RTSP on port 8554 (needs your
  Wyze account credentials/API key; review Wyze's terms first). [VERIFICAR]
* Wyze cameras have **no liveness / anti-spoofing**: a printed photo or a phone screen could match. That is why a
  camera is registered with **"Siempre confirmar en recepción"** ON by default: every match goes to the review queue
  on the door tablet and the front desk confirms with one tap. Turn it off only for cameras with liveness detection.
* The agent's RTSP path is tested here only with a local 1080p file (same OpenCV/FFmpeg code); it has NOT been run
  against a physical Wyze camera.

## Setup (≈ 30 minutes)
1. **Camera placement:** facing the inside of the entrance at face height (1.5–1.8 m), 1.5–2.5 m from where people
   stop, with front light (no strong backlight from the door glass). Night IR images degrade recognition.
2. **Wyze app:** update firmware → Settings → Advanced Settings → RTSP → on → set user/password → copy the URL.
3. **Router:** reserve a fixed IP for the camera. Do **not** port-forward RTSP to the internet.
4. **Gym system:** owner → Agenda / Clases → **Puerta y acceso** → Reconocimiento facial → *Activar en esta sede* →
   *Registrar cámara* (name, direction, "Siempre confirmar en recepción" ON) → copy the key (shown once).
5. **Mini PC on the same network** (Intel N100-class or Raspberry Pi 5; 8 GB RAM recommended) [INFERENCIA]:
   ```bash
   pip install opencv-python-headless numpy insightface onnxruntime   # research-licence model, see README
   export GYM_API=https://gym-saas-f1.netlify.app/api/v1
   export DEVICE_KEY='<id>:<secret>'                     # from step 4, never committed
   export CAMERA_URL='rtsp://USER:PASS@192.168.1.50/live'  # from step 2, never committed
   export CAMERA_PROFILE=wyze                            # RTSP over TCP, 1 frame in 3, fast reconnect
   python3 tools/door-agent/agent.py --probe             # resolution, fps, dropped frames, face sizes
   python3 tools/door-agent/agent.py --selftest          # talks to the gym system
   python3 tools/door-agent/agent.py                     # run (use systemd to keep it running)
   ```
6. **Members** opt in from **Cómo entro** (and need a photo in **Mi cuenta**). Nobody else is recognised.

## Before turning it on for real [VERIFICAR]
Legal review of the biometric consent and door notice (licensed attorney), a commercially licensed face model,
on-site calibration (false accepts/rejects) with your lighting, and a written retention/deletion rule.
