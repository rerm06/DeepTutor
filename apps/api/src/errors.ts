/** Map Postgres error codes to HTTP without leaking SQL details to clients. */
export function httpFromPg(err: unknown): { status: number; code: string } | null {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case "42501": // insufficient_privilege, raised by RLS WITH CHECK and by definer functions
      return { status: 403, code: "forbidden" };
    case "23505":
      return { status: 409, code: "conflict" };
    case "23503":
    case "22023":
    case "22P02":
    case "23514":
      return { status: 400, code: "invalid_input" };
    default:
      return null;
  }
}
