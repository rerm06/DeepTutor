# Production (since 2026-11-05)

gym-saas-f1.netlify.app runs in **production mode**, authorised by the owner:
* **Demo off**: `netlify/server.mts` reads `GYM_DEMO_MODE` (unset on Netlify → production); the web build sets
  `VITE_DEMO_MODE=false` (netlify.toml). No demo personas, no demo banner, `/v1/demo/*` not mounted. The synthetic
  demo organisations remain in the database but are unreachable. To bring the demo back, set both flags to demo.
* **Real organisation**: "Fitness R Us" (`f1000000-…-0001`), one location **Fitness R Us Toa Baja** (Toa Baja), online
  sign-up open. No plans, prices or members were created: the owner configures the catalogue.
* **PII guard off** (`app_private.setting.pii_guard = false`): sign-up accepts real e-mails and NANP phones.
* **Accounts**: `rerm06@gmail.com` is the **protected account** (every staff role; nobody else can change,
  deactivate, re-role or delete it through the app; role switcher in the account menu). `nmaysonet1811@gmail.com`
  is owner. Both keep the password they were given, with no forced change, until they change it themselves in
  *Cambiar mi contraseña*. Owners can require a change per account in *Equipo y accesos* (not for the protected one).

## Known gaps [VERIFICAR before real customers]
1. **Members cannot sign in yet**: code sign-in needs an e-mail/SMS provider (`/v1/public/login/start` → 503). New
   members can sign up (202) and use the door QR only after a sign-in channel exists.
2. **Payments**: Stripe is TEST mode only by design (AGENTS.md rule 3); no real charges.
3. **Legal texts** (terms, waiver, SMS consents, photo and biometric consents) are drafts for a licensed attorney.
4. **Weak initial passwords**: "Password" on owner accounts of a public site; change them in *Cambiar mi contraseña*.
5. Self-service password reset needs the same e-mail provider.
