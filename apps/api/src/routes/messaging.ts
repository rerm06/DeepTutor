import {
  CONSENT_SOURCES,
  MESSAGE_CHANNELS,
  MESSAGE_LOCALES,
  MESSAGE_PURPOSES,
  TemplateError,
  renderTemplate,
} from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// E8 · Messaging and consent. Consent rules, location scope and auditing live in the SQL definer functions
// (migration 0004); this layer validates input and renders bodies server-side from the template catalogue.

const IdParams = z.object({ id: z.string().uuid() });
const Channel = z.enum(MESSAGE_CHANNELS);
const Purpose = z.enum(MESSAGE_PURPOSES);
const Source = z.enum(CONSENT_SOURCES);

const ConsentBody = z
  .object({
    brand_id: z.string().uuid(),
    channel: Channel,
    purpose: Purpose,
    granted: z.boolean(),
    source: Source,
    evidence: z.string().max(2000).optional(),
  })
  .strict();

const OptOutBody = z.object({ brand_id: z.string().uuid(), source: Source }).strict();

// `.strict()`: a client that tries to send `purpose` or `body` gets 400 instead of being silently ignored.
const MessageBody = z
  .object({
    member_id: z.string().uuid(),
    brand_id: z.string().uuid(),
    channel: Channel,
    template_key: z.string().min(1).max(64),
    locale: z.enum(MESSAGE_LOCALES),
    vars: z
      .record(z.string().max(64), z.string().max(200))
      .refine((v) => Object.keys(v).length <= 20, { message: "too many variables" })
      .default({}),
  })
  .strict();

const InboxQuery = z.object({ location_id: z.string().uuid().optional() });

export async function messagingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/members/:id/consents", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, member_id, brand_id, channel, purpose, status, source, evidence, recorded_by,
                granted_at, revoked_at, updated_at
           FROM app.consent WHERE member_id = $1
          ORDER BY brand_id, channel, purpose`,
        [id],
      );
      return { data: rows };
    });
  });

  app.put("/members/:id/consents", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = ConsentBody.parse(req.body);
    const consentId = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.set_consent($1, $2, $3, $4, $5, $6, $7) AS id",
        [id, b.brand_id, b.channel, b.purpose, b.granted, b.source, b.evidence ?? null],
      );
      return rows[0]?.id;
    });
    return { id: consentId };
  });

  app.post("/members/:id/opt-out", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = OptOutBody.parse(req.body);
    const revoked = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ revoked: number }>(
        "SELECT app.opt_out($1, $2, $3) AS revoked",
        [id, b.brand_id, b.source],
      );
      return rows[0]?.revoked ?? 0;
    });
    return { revoked };
  });

  app.post("/messages", async (req, reply) => {
    const b = MessageBody.parse(req.body);
    let rendered: ReturnType<typeof renderTemplate>;
    try {
      // Purpose and body come from the catalogue only, never from the client.
      rendered = renderTemplate(b.template_key, b.locale, b.vars);
    } catch (err) {
      if (err instanceof TemplateError) return reply.code(400).send({ error: err.code });
      throw err;
    }
    const row = await app.asCaller(req, async (tx) => {
      const { rows: ids } = await tx.query<{ id: string }>(
        "SELECT app.enqueue_message($1, $2, $3, $4, $5, $6, $7) AS id",
        [
          b.member_id,
          b.brand_id,
          b.channel,
          rendered.purpose,
          rendered.templateKey,
          rendered.locale,
          rendered.body,
        ],
      );
      const { rows } = await tx.query<{
        id: string;
        status: string;
        block_reason: string | null;
        scheduled_for: Date;
      }>("SELECT id, status, block_reason, scheduled_for FROM app.outbound_message WHERE id = $1", [
        ids[0]?.id,
      ]);
      return rows[0];
    });
    if (!row) return reply.code(500).send({ error: "internal" });
    return reply.code(201).send(row);
  });

  app.get("/inbox", async (req) => {
    const q = InboxQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, brand_id, location_id, member_id, channel, from_address, body, received_at, handled
           FROM app.inbound_message
          WHERE ($1::uuid IS NULL OR location_id = $1)
          ORDER BY received_at DESC LIMIT 200`,
        [q.location_id ?? null],
      );
      return { data: rows };
    });
  });
}
