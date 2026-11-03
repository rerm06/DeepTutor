import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

/**
 * Member photo · HTTP routes under /v1. Storage and every rule live in the database (0023): who may write
 * (member self; owner / location manager / front desk of the home location), size (1–150 KiB), type (JPEG/WebP
 * magic bytes) and the consent version. These routes only decode base64 and run the definer functions as the caller.
 *   GET    /members/:id/photo   staff (RLS decides) → { mime, data, updated_at } | 404
 *   PUT    /members/:id/photo   staff writer        → { updated_at }
 *   DELETE /members/:id/photo   staff writer        → { removed }
 *   GET|PUT|DELETE /me/photo    the signed-in member, same shapes
 * The image travels as base64 in JSON (≤ 150 KiB → ≤ 200 KiB of text, under the 256 KiB body limit) so the web
 * app can show it as a data: URL without an authenticated <img> request.
 */
export const PHOTO_CONSENT_VERSION = "photo-v1";
const MAX_BYTES = 153_600;

const IdParams = z.object({ id: z.string().uuid() });
const PhotoBody = z
  .object({
    mime: z.enum(["image/jpeg", "image/webp"]),
    // Standard base64, no data: prefix. Length bound before decoding: 4/3 of the byte limit.
    data: z
      .string()
      .min(16)
      .max(Math.ceil((MAX_BYTES * 4) / 3) + 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    consent_version: z.string().regex(/^photo-v[0-9]{1,3}$/),
  })
  .strict();

const SQL_REFUSALS = new Set(["invalid_photo", "photo_consent_required"]);

interface Row {
  mime: string;
  data: Buffer;
  updated_at: string;
}

function refusal(err: unknown, reply: FastifyReply): FastifyReply | null {
  const e = err as { code?: string; message?: string };
  if (e?.code === "22023" && e.message && SQL_REFUSALS.has(e.message))
    return reply.code(400).send({ error: e.message });
  return null;
}

export async function routes(app: FastifyInstance): Promise<void> {
  const read = async (req: Parameters<typeof app.asCaller>[0], member: string | null) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<Row>(
        member
          ? "SELECT mime, data, updated_at FROM app.member_photo WHERE member_id = $1"
          : `SELECT p.mime, p.data, p.updated_at FROM app.member_photo p
               JOIN app.member m ON m.id = p.member_id
              WHERE m.person_id = app.person_id() AND app.role() = 'member'`,
        member ? [member] : [],
      );
      return rows[0];
    });

  const write = async (
    req: Parameters<typeof app.asCaller>[0],
    reply: FastifyReply,
    member: string | null,
  ) => {
    const b = PhotoBody.parse(req.body);
    const bytes = Buffer.from(b.data, "base64");
    if (bytes.length < 1024 || bytes.length > MAX_BYTES)
      return reply.code(400).send({ error: "invalid_photo" });
    try {
      const at = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ at: string }>(
          "SELECT app.set_member_photo($1, $2, $3, $4) AS at",
          [member, b.mime, bytes, b.consent_version],
        );
        return rows[0]?.at;
      });
      return { updated_at: at };
    } catch (err) {
      const r = refusal(err, reply);
      if (r) return r;
      throw err;
    }
  };

  const clear = async (req: Parameters<typeof app.asCaller>[0], member: string | null) => {
    const removed = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ ok: boolean }>("SELECT app.clear_member_photo($1) AS ok", [
        member,
      ]);
      return rows[0]?.ok ?? false;
    });
    return { removed };
  };

  const shape = (r: Row) => ({
    mime: r.mime,
    data: r.data.toString("base64"),
    updated_at: r.updated_at,
  });

  app.get("/members/:id/photo", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const r = await read(req, id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    return shape(r);
  });
  app.put("/members/:id/photo", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    return write(req, reply, id);
  });
  app.delete("/members/:id/photo", async (req) => {
    const { id } = IdParams.parse(req.params);
    return clear(req, id);
  });

  app.get("/me/photo", async (req, reply) => {
    const r = await read(req, null);
    if (!r) return reply.code(404).send({ error: "not_found" });
    return shape(r);
  });
  app.put("/me/photo", async (req, reply) => write(req, reply, null));
  app.delete("/me/photo", async (req) => clear(req, null));
}
