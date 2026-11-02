import { audit } from "@gym/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const RegisterBody = z.object({
  email: z.string().email().max(254),
  full_name: z.string().min(1).max(200),
  phone: z.string().max(32).optional(),
  home_location_id: z.string().uuid(),
});
const ListQuery = z.object({ location_id: z.string().uuid().optional() });
const IdParams = z.object({ id: z.string().uuid() });
const PatchBody = z.object({
  status: z.enum(["lead", "trial", "active", "frozen", "past_due", "cancelled"]),
});

export async function memberRoutes(app: FastifyInstance): Promise<void> {
  app.get("/members", async (req) => {
    const q = ListQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT m.id, m.status, m.member_no, m.home_location_id, m.full_name, p.email
           FROM app.member m JOIN app.person p ON p.id = m.person_id
          WHERE ($1::uuid IS NULL OR m.home_location_id = $1)
          ORDER BY m.full_name LIMIT 500`,
        [q.location_id ?? null],
      );
      return { data: rows };
    });
  });

  app.post("/members", async (req, reply) => {
    const b = RegisterBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.register_member($1, $2, $3, $4) AS id",
        [b.email, b.full_name, b.phone ?? null, b.home_location_id],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch("/members/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = PatchBody.parse(req.body);
    const updated = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string; home_location_id: string }>(
        "UPDATE app.member SET status = $2 WHERE id = $1 RETURNING id, home_location_id",
        [id, b.status],
      );
      const row = rows[0];
      if (row) {
        await audit(tx, {
          action: "member.status",
          entity: "member",
          entityId: row.id,
          locationId: row.home_location_id,
          meta: b,
        });
      }
      return row;
    });
    // RLS makes another org's (or another location's) member indistinguishable from a missing one.
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return { id: updated.id, status: b.status };
  });
}
