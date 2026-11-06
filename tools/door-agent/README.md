# Door camera agent (reference)

Connects the gym's CCTV door camera to the access system for **opt-in** face check-in/out. See the header of
`agent.py` for the full behaviour. Summary:

* Runs on a small computer on the gym's network (it reads the camera's RTSP/ONVIF stream). Netlify and the browser
  cannot read CCTV streams; this agent is the bridge.
* Authenticates with the device key shown once in **Puerta y acceso → Cámaras de la puerta**.
* Downloads only the photos of members of its location who allowed face recognition; templates stay in memory.
* Unknown faces are discarded on the device. Only `(member, score, direction)` is sent.
* Fails closed: wrong key, revoked device or face access switched off → it stops reporting.

```bash
export GYM_API=https://gym-saas-f1.netlify.app/api/v1
export DEVICE_KEY='<device id>:<secret>'          # never commit it
python3 agent.py --selftest                        # protocol check, no camera/model needed
export CAMERA_URL='rtsp://user:pass@CAMERA_IP:554/…'  # never commit it
pip install opencv-python-headless numpy insightface onnxruntime
python3 agent.py
```

**Wyze cameras:** see `docs/wyze.md` (`CAMERA_PROFILE=wyze`, `--probe`, register the camera with
"Siempre confirmar en recepción").

**Before production [VERIFICAR]:** a commercially licensed face model (InsightFace's pretrained models are
non-commercial), liveness/anti-spoofing (a printed photo must not open the door — prefer cameras with IR/depth),
threshold calibration on site, and legal review of the biometric consent and notice.
