import type { FastifyInstance } from "fastify";

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.get("/me", async (req) =>
    app.asCaller(req, async (tx) => {
      const org = await tx.query("SELECT id, name, saas_plan FROM app.organization");
      const person = await tx.query(
        "SELECT id, email, full_name FROM app.person WHERE id = app.person_id()",
      );
      return {
        organization: org.rows[0] ?? null,
        person: person.rows[0] ?? null,
        role: req.claims.app_role,
        location_ids: req.claims.location_ids,
      };
    }),
  );

  app.get("/locations", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT id, name, brand_id, timezone, municipality FROM app.location ORDER BY name",
      );
      return { data: rows };
    }),
  );

  app.get("/audit-log", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT id, actor_person_id, actor_role, action, entity, entity_id, location_id, at FROM app.audit_log ORDER BY at DESC LIMIT 200",
      );
      return { data: rows };
    }),
  );
}
