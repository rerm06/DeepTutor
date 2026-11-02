# Gym SaaS (working name)

White-label, multi-tenant SaaS for gyms and multi-site chains — spec v0.5. Status: **F1 in progress** (see `docs/backlog.md`).

```bash
pnpm install
bash scripts/pg-local.sh start   # Postgres 16 on :54329, no Docker needed
pnpm gate                        # secrets scan + lint + build + typecheck + tests
```

Layout: `packages/db` (migrations, RLS, fixtures) · `packages/shared` (roles, claims, fees) · `apps/api` (Fastify).
Coming: `apps/web` (Next.js PWA), `services/agents` (Python). Stripe runs in TEST mode only.
