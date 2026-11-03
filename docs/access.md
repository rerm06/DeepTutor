# Access: sign-in, door QR entry/exit, face recognition with cameras

## Ways in for a member
| Way | How | Where in the app |
| --- | --- | --- |
| Sign in with a code | E-mail → 6-digit code (10 min, 5 tries, 5 codes / 15 min) → member portal with today's routine | Entry screen → "Soy socio" → "Entrar con mi correo" |
| Sign up | Public join page (AI-assisted or manual) | "Registrarme" |
| Door QR — entry | The door tablet shows ENTRADA; the phone camera opens `/door/<code>`; entry recorded with the location's access rule | Staff: **Agenda / Clases → Puerta y acceso** (full screen on a tablet) |
| Door QR — exit | Same with SALIDA; closes the open visit | same |
| Personal credential | Front desk scans the member's rotating QR (existing) | Check-in rápido |
| Face recognition (opt-in) | CCTV door camera + on-site agent recognises consenting members | Member: "Cómo entro"; staff: Puerta y acceso |

Door codes rotate every 30 s (HMAC, current + previous window accepted), so a photo of the tablet stops working
within a minute. A member scanning ENTRADA while already inside gets "Ya estabas dentro"; SALIDA without an open
visit gets "No tienes una entrada abierta". The tablet shows who is inside now and the recent activity, and the front
desk can register an exit by hand.

## Face recognition (third option) — design
* **Off by default**; only the **owner** switches it on per location, after legal review.
* **Consent only from the member themself** (`face-v1`), separate from the photo consent; withdrawable at any time.
  Staff can never consent on a member's behalf.
* **No face templates in the cloud.** The on-site agent (`tools/door-agent`) downloads the photos of consenting
  members of its location, builds templates in memory, matches locally, and sends only `(member, score, direction)`.
  Faces that match nobody never leave the device.
* **Decisions:** score ≥ 0.62 → automatic entry/exit; 0.45–0.62 → front-desk review queue on the door tablet;
  lower → refused and not stored. One event per member per device per 60 s. Agent needs 3 matching frames in 2 s.
* **Devices** authenticate with a secret shown once (stored as HMAC); revocable; last connection shown.
* **Fail closed:** wrong/revoked key, face access off, or consent withdrawn → no recognition is accepted.

## Production blockers [VERIFICAR]
1. Legal review (licensed attorney) of the biometric consent text, the notice at the door and retention, under the
   laws that apply in Puerto Rico and federal FTC guidance on biometric information.
2. A commercially licensed face model or service (InsightFace's pretrained models are non-commercial research only).
3. Liveness / anti-spoofing hardware or model (a printed photo must not open the door).
4. On-site threshold calibration (false accept / false reject) with the actual cameras and lighting.
5. Code delivery outside the demo needs an e-mail/SMS provider (`POST /v1/public/login/start` answers 503 until then).
6. Member sessions last 15 minutes (API token limit); a refresh-token flow is pending for a long-lived portal session.
