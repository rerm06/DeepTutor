# Live agent (Gemini Live) · field assistant · member photo

## What it does
* **Asistente IA** (floating button on every screen, and "Registrarme con el asistente IA" / "Alta con IA" on the
  sign-up forms). "Preguntar todo" interviews the person field by field, writes each answer, reads back the
  validation and re-asks when a value is invalid. It can also navigate to any module and press buttons.
* **Two engines.** With `GEMINI_API_KEY` set: Gemini Live (voice in/out, function calling). Without it, or if Gemini
  is unreachable: a local guided interviewer in the browser (Web Speech API for voice where supported, typed answers
  everywhere). The panel always says which one is running.
* **Field assistant** on every form: live state per field and a chip that quotes what is being typed and whether it
  is valid. The person can edit anything by hand at any time; a manual edit replaces the "IA" tag with "Editado a mano".
* **Member photo**: camera capture (face guide, square crop, JPEG ≤ 140 KB) or file upload, on the public join page
  (optional), in Mi cuenta (member) and on the member record (front desk / manager / owner). Shown next to the member
  at check-in.

## Safety rules (enforced in code, `apps/web/src/lib/agent/bridge.ts`)
1. Consent boxes (terms, waiver, SMS, photo consent), passwords and anything marked `data-agent="manual"` are never
   ticked by the agent — the person does it.
2. Money, deletion, cancellation, sending and signing buttons are never pressed by the agent: it highlights them.
3. A form submit is pressed only with `user_confirmed=true` after the person says yes.
4. The Gemini API key never reaches the browser: `POST /v1/live/token` (signed in) and `POST /v1/public/live/token`
   (open join page, 6 per 10 min per address) mint a one-session ephemeral token (60 s to start, 15 min max).
5. Photos: stored in `app.member_photo` (0023), 1–150 KiB JPEG/WebP checked by magic bytes, consent version required,
   audited without the image. Read: member, guardian, owner/manager/front desk/trainer of the home location.

## Configuration (Netlify → Site configuration → Environment variables; never in the repo or in chat)
| Variable | Required | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes, to enable Gemini Live | — (local assistant) |
| `GEMINI_LIVE_MODEL` | no | `gemini-3.8-live` [VERIFICAR · current Live model id at ai.google.dev] |
| `GEMINI_LIVE_API_VERSION` | no | `v1beta` (`v1alpha` if Google's SDK note still applies) |

The site header `Permissions-Policy` allows `camera=(self), microphone=(self)` (netlify.toml).

## Open items [VERIFICAR]
* Legal copy of the photo consent and of the voice-processing notice (Ley 81-2019, Google as processor; whether a
  photo kept for identification needs a separate privacy-policy clause).
* Retention: photos are kept until removed by the member or staff; define a retention rule for cancelled members.
* Gemini Live model id and API version against the live docs before enabling the key in production.
