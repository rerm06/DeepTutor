import {
  APPOINTMENT_KINDS,
  ATTENDANCE_STATUSES,
  CLASS_NAME_PATTERN,
  QR_WINDOW_SECONDS,
} from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// Module schedule (E6 · spec §3.2). Capacity, waitlist, late cancellation, staff overlap, the access rule and the QR
// credential live in the SQL definer functions of migration 0007; this layer only validates shape and runs every
// query through app.asCaller (RLS + signed claims).

const Uuid = z.string().uuid();
const IdParams = z.object({ id: Uuid }).strict();
const Instant = z.string().datetime({ offset: true });
const MAX_RANGE_MS = 62 * 24 * 3600 * 1000;

const Range = z
  .object({
    location_id: Uuid.optional(),
    member_id: Uuid.optional(),
    from: Instant.optional(),
    to: Instant.optional(),
  })
  .strict()
  .transform((q) => {
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 24 * 3600 * 1000);
    const to = q.to ? new Date(q.to) : new Date(from.getTime() + 15 * 24 * 3600 * 1000);
    return { ...q, from, to };
  })
  .refine((q) => q.to > q.from && q.to.getTime() - q.from.getTime() <= MAX_RANGE_MS, {
    message: "invalid_range",
  });

const ClassTypeBody = z
  .object({
    name: z.string().trim().regex(CLASS_NAME_PATTERN),
    description: z
      .string()
      .max(500)
      .regex(/^[^\r\n{}<>]*$/)
      .optional(),
    duration_min: z.number().int().min(5).max(480).optional(),
    default_capacity: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const SessionBody = z
  .object({
    location_id: Uuid,
    class_type_id: Uuid,
    instructor_id: Uuid.nullable().optional(),
    room: z
      .string()
      .max(60)
      .regex(/^[^\r\n{}<>]*$/)
      .optional(),
    starts_at: Instant,
    ends_at: Instant,
    capacity: z.number().int().min(1).max(500),
  })
  .strict();

const BookingBody = z.object({ session_id: Uuid, member_id: Uuid }).strict();
const AttendanceBody = z.object({ status: z.enum(ATTENDANCE_STATUSES) }).strict();
const PolicyParams = z.object({ location_id: Uuid }).strict();
const PolicyBody = z
  .object({
    cancel_window_hours: z.number().int().min(0).max(72),
    no_show_penalty: z.boolean(),
    deny_past_due: z.boolean(),
  })
  .strict();
const AppointmentBody = z
  .object({
    kind: z.enum(APPOINTMENT_KINDS),
    staff_member_id: Uuid,
    member_id: Uuid,
    location_id: Uuid,
    starts_at: Instant,
    ends_at: Instant,
  })
  .strict();
// A scanned token is printable ASCII; the database decides whether it is valid (and records the attempt).
const Token = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);
const CheckInBody = z.union([
  z.object({ location_id: Uuid, member_id: Uuid }).strict(),
  z.object({ location_id: Uuid, token: Token }).strict(),
]);
const MemberQuery = z.object({ member_id: Uuid }).strict();
const StaffQuery = z.object({ location_id: Uuid.optional() }).strict();
const CheckInQuery = z
  .object({
    location_id: Uuid.optional(),
    member_id: Uuid.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export async function routes(app: FastifyInstance): Promise<void> {
  // ── Catalogue
  app.get("/schedule/class-types", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, name, description, duration_min, default_capacity, active
           FROM app.class_type ORDER BY active DESC, name`,
      );
      return { data: rows };
    }),
  );

  app.post("/schedule/class-types", async (req, reply) => {
    const b = ClassTypeBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.class_type (name, description, duration_min, default_capacity)
         VALUES ($1, $2, coalesce($3, 60), coalesce($4, 20)) RETURNING id`,
        [b.name, b.description ?? null, b.duration_min ?? null, b.default_capacity ?? null],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  // ── Sessions
  app.get("/schedule/sessions", async (req) => {
    const q = Range.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.location_id, s.class_type_id, c.name AS class_name, s.instructor_id,
                st.display_name AS instructor_name, s.room, s.starts_at, s.ends_at, s.capacity, s.cancelled,
                coalesce(o.booked, 0) AS booked, coalesce(o.waitlisted, 0) AS waitlisted
           FROM app.class_session s
           JOIN app.class_type c ON c.id = s.class_type_id
           LEFT JOIN app.staff_member st ON st.id = s.instructor_id
           LEFT JOIN LATERAL app.session_occupancy(ARRAY[s.id]) o ON true
          WHERE s.starts_at >= $1 AND s.starts_at < $2 AND ($3::uuid IS NULL OR s.location_id = $3)
          ORDER BY s.starts_at, s.id
          LIMIT 500`,
        [q.from, q.to, q.location_id ?? null],
      );
      return { data: rows };
    });
  });

  app.post("/schedule/sessions", async (req, reply) => {
    const b = SessionBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.create_class_session($1, $2, $3, $4, $5, $6, $7) AS id",
        [
          b.location_id,
          b.class_type_id,
          b.instructor_id ?? null,
          b.room?.trim() || null,
          b.starts_at,
          b.ends_at,
          b.capacity,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.post("/schedule/sessions/:id/cancel", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ n: number }>("SELECT app.cancel_class_session($1) AS n", [
        id,
      ]);
      return { bookings_cancelled: rows[0]?.n ?? 0 };
    });
  });

  app.get("/schedule/sessions/:id/roster", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT booking_id, member_id, full_name, member_no, status, waitlist_position, late_cancel, created_at
           FROM app.session_roster($1)`,
        [id],
      );
      return { data: rows };
    });
  });

  // ── Bookings
  app.post("/schedule/bookings", async (req, reply) => {
    const b = BookingBody.parse(req.body);
    const row = await app.asCaller(req, async (tx) => {
      const { rows: ids } = await tx.query<{ id: string }>("SELECT app.book_class($1, $2) AS id", [
        b.session_id,
        b.member_id,
      ]);
      // Second statement: rows written by the function are visible only to later statements.
      const { rows } = await tx.query(
        "SELECT id, status, waitlist_position FROM app.booking WHERE id = $1",
        [ids[0]?.id],
      );
      return rows[0];
    });
    if (!row) return reply.code(500).send({ error: "internal" });
    return reply.code(201).send(row);
  });

  app.get("/schedule/bookings", async (req) => {
    const q = MemberQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT b.id, b.session_id, b.member_id, b.status, b.waitlist_position, b.late_cancel, b.created_at,
                b.cancelled_at, s.starts_at, s.ends_at, s.location_id, s.room, s.cancelled AS session_cancelled,
                c.name AS class_name
           FROM app.booking b
           JOIN app.class_session s ON s.id = b.session_id
           JOIN app.class_type c ON c.id = s.class_type_id
          WHERE b.member_id = $1
          ORDER BY s.starts_at DESC
          LIMIT 200`,
        [q.member_id],
      );
      return { data: rows };
    });
  });

  app.post("/schedule/bookings/:id/cancel", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT status, late_cancel, promoted_booking_id FROM app.cancel_booking($1)",
        [id],
      );
      return { id, ...rows[0] };
    });
  });

  app.post("/schedule/bookings/:id/attendance", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = AttendanceBody.parse(req.body);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        "SELECT app.mark_attendance($1, $2) AS status",
        [id, b.status],
      );
      return { id, status: rows[0]?.status };
    });
  });

  // ── Location policy
  app.get("/schedule/location-policies", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT location_id, cancel_window_hours, no_show_penalty, deny_past_due, updated_at
           FROM app.location_policy ORDER BY location_id`,
      );
      return { data: rows };
    }),
  );

  app.put("/schedule/location-policies/:location_id", async (req) => {
    const { location_id } = PolicyParams.parse(req.params);
    const b = PolicyBody.parse(req.body);
    await app.asCaller(req, (tx) =>
      tx.query("SELECT app.set_location_policy($1, $2, $3, $4)", [
        location_id,
        b.cancel_window_hours,
        b.no_show_penalty,
        b.deny_past_due,
      ]),
    );
    return { location_id, ...b };
  });

  // ── Appointments
  app.get("/schedule/appointments", async (req) => {
    const q = Range.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT a.id, a.location_id, a.kind, a.staff_member_id, st.display_name AS staff_name, a.member_id,
                m.full_name AS member_name, a.starts_at, a.ends_at, a.status
           FROM app.appointment a
           LEFT JOIN app.staff_member st ON st.id = a.staff_member_id
           LEFT JOIN app.member m ON m.id = a.member_id
          WHERE a.starts_at >= $1 AND a.starts_at < $2
            AND ($3::uuid IS NULL OR a.location_id = $3) AND ($4::uuid IS NULL OR a.member_id = $4)
          ORDER BY a.starts_at
          LIMIT 500`,
        [q.from, q.to, q.location_id ?? null, q.member_id ?? null],
      );
      return { data: rows };
    });
  });

  app.post("/schedule/appointments", async (req, reply) => {
    const b = AppointmentBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.create_appointment($1, $2, $3, $4, $5, $6) AS id",
        [b.kind, b.staff_member_id, b.member_id, b.location_id, b.starts_at, b.ends_at],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.post("/schedule/appointments/:id/cancel", async (req) => {
    const { id } = IdParams.parse(req.params);
    await app.asCaller(req, (tx) => tx.query("SELECT app.cancel_appointment($1)", [id]));
    return { id, status: "cancelled" };
  });

  // ── Staff list (instructor / appointment pickers), scoped by RLS.
  app.get("/schedule/staff", async (req) => {
    const q = StaffQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.display_name, s.role, sl.location_id
           FROM app.staff_member s JOIN app.staff_location sl ON sl.staff_member_id = s.id
          WHERE s.active AND s.role IN ('trainer', 'nutritionist', 'clinician')
            AND ($1::uuid IS NULL OR sl.location_id = $1)
          ORDER BY s.display_name`,
        [q.location_id ?? null],
      );
      return { data: rows };
    });
  });

  // ── Member side: whom the caller acts for (themself, or a guardian's wards).
  app.get("/schedule/my-members", async (req, reply) => {
    if (req.claims.app_role !== "member" && req.claims.app_role !== "guardian")
      return reply.code(403).send({ error: "forbidden" });
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT id, full_name, member_no, status, home_location_id FROM app.member ORDER BY full_name",
      );
      return { data: rows };
    });
  });

  // ── Rotating QR credential and check-in
  app.get("/schedule/qr-token", async (req) => {
    const q = MemberQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ token: string; expires_at: Date }>(
        "SELECT token, expires_at FROM app.my_qr_token($1)",
        [q.member_id],
      );
      return { ...rows[0], window_seconds: QR_WINDOW_SECONDS };
    });
  });

  app.post("/schedule/check-ins", async (req, reply) => {
    const b = CheckInBody.parse(req.body);
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, result, reason, member_id, full_name, member_no, member_status
           FROM app.check_in($1, $2, $3)`,
        [b.location_id, "member_id" in b ? b.member_id : null, "token" in b ? b.token : null],
      );
      return rows[0];
    });
    if (!row) return reply.code(500).send({ error: "internal" });
    return reply.code(201).send(row);
  });

  app.get("/schedule/check-ins", async (req) => {
    const q = CheckInQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT c.id, c.location_id, c.member_id, m.full_name, c.source, c.result, c.reason, c.at
           FROM app.check_in c LEFT JOIN app.member m ON m.id = c.member_id
          WHERE ($1::uuid IS NULL OR c.location_id = $1) AND ($2::uuid IS NULL OR c.member_id = $2)
          ORDER BY c.at DESC
          LIMIT $3`,
        [q.location_id ?? null, q.member_id ?? null, q.limit],
      );
      return { data: rows };
    });
  });
}
