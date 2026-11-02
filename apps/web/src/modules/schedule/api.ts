import type { ApiClient } from "../../api/client";
import type { ListOf } from "../../api/types";

/** Shapes of the schedule endpoints (apps/api/src/modules/schedule.ts, docs/modules/schedule.md). */
export type BookingStatus = "booked" | "waitlisted" | "cancelled" | "attended" | "no_show";
export type AppointmentKind = "personal_training" | "assessment" | "nutrition" | "clinical";
export type CheckinReason =
  | "active"
  | "trial"
  | "past_due"
  | "past_due_denied"
  | "frozen"
  | "cancelled"
  | "lead"
  | "invalid_token"
  | "expired_token";

export interface ClassType {
  id: string;
  name: string;
  description: string | null;
  duration_min: number;
  default_capacity: number;
  active: boolean;
}
export interface ClassSession {
  id: string;
  location_id: string;
  class_type_id: string;
  class_name: string;
  instructor_id: string | null;
  instructor_name: string | null;
  room: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  cancelled: boolean;
  booked: number;
  waitlisted: number;
}
export interface NewSession {
  location_id: string;
  class_type_id: string;
  instructor_id: string | null;
  room?: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
}
export interface RosterEntry {
  booking_id: string;
  member_id: string;
  full_name: string;
  member_no: string | null;
  status: BookingStatus;
  waitlist_position: number | null;
  late_cancel: boolean;
}
export interface Booking {
  id: string;
  session_id: string;
  member_id: string;
  status: BookingStatus;
  waitlist_position: number | null;
  late_cancel: boolean;
  starts_at: string;
  ends_at: string;
  location_id: string;
  room: string | null;
  session_cancelled: boolean;
  class_name: string;
}
export interface LocationPolicy {
  location_id: string;
  cancel_window_hours: number;
  no_show_penalty: boolean;
  deny_past_due: boolean;
}
export interface Appointment {
  id: string;
  location_id: string;
  kind: AppointmentKind;
  staff_member_id: string;
  staff_name: string | null;
  member_id: string;
  member_name: string | null;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "cancelled";
}
export interface NewAppointment {
  kind: AppointmentKind;
  staff_member_id: string;
  member_id: string;
  location_id: string;
  starts_at: string;
  ends_at: string;
}
export interface StaffOption {
  id: string;
  display_name: string;
  role: string;
  location_id: string;
}
export interface MyMember {
  id: string;
  full_name: string;
  member_no: string | null;
  status: string;
  home_location_id: string;
}
export interface CheckInResult {
  id: string;
  result: "allowed" | "denied";
  reason: CheckinReason;
  member_id: string | null;
  full_name: string | null;
  member_no: string | null;
  member_status: string | null;
}
export interface CheckInRow {
  id: string;
  location_id: string;
  member_id: string | null;
  full_name: string | null;
  source: string;
  result: "allowed" | "denied";
  reason: CheckinReason;
  at: string;
}
export interface QrToken {
  token: string;
  expires_at: string;
  window_seconds: number;
}

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
const id = (v: string) => encodeURIComponent(v);

export function scheduleApi(api: ApiClient) {
  const r = api.request;
  return {
    classTypes: () => r<ListOf<ClassType>>("GET", "/schedule/class-types"),
    sessions: (p: { location_id?: string; from?: string; to?: string }) =>
      r<ListOf<ClassSession>>("GET", `/schedule/sessions${qs(p)}`),
    createSession: (s: NewSession) => r<{ id: string }>("POST", "/schedule/sessions", s),
    cancelSession: (sessionId: string) =>
      r<{ bookings_cancelled: number }>("POST", `/schedule/sessions/${id(sessionId)}/cancel`),
    roster: (sessionId: string) =>
      r<ListOf<RosterEntry>>("GET", `/schedule/sessions/${id(sessionId)}/roster`),
    book: (sessionId: string, memberId: string) =>
      r<{ id: string; status: BookingStatus; waitlist_position: number | null }>(
        "POST",
        "/schedule/bookings",
        { session_id: sessionId, member_id: memberId },
      ),
    bookings: (memberId: string) =>
      r<ListOf<Booking>>("GET", `/schedule/bookings${qs({ member_id: memberId })}`),
    cancelBooking: (bookingId: string) =>
      r<{ status: BookingStatus; late_cancel: boolean; promoted_booking_id: string | null }>(
        "POST",
        `/schedule/bookings/${id(bookingId)}/cancel`,
      ),
    markAttendance: (bookingId: string, status: "attended" | "no_show") =>
      r<{ id: string; status: BookingStatus }>(
        "POST",
        `/schedule/bookings/${id(bookingId)}/attendance`,
        { status },
      ),
    policies: () => r<ListOf<LocationPolicy>>("GET", "/schedule/location-policies"),
    appointments: (p: { location_id?: string; member_id?: string; from?: string; to?: string }) =>
      r<ListOf<Appointment>>("GET", `/schedule/appointments${qs(p)}`),
    createAppointment: (a: NewAppointment) =>
      r<{ id: string }>("POST", "/schedule/appointments", a),
    cancelAppointment: (appointmentId: string) =>
      r<{ id: string }>("POST", `/schedule/appointments/${id(appointmentId)}/cancel`),
    staff: (locationId?: string) =>
      r<ListOf<StaffOption>>("GET", `/schedule/staff${qs({ location_id: locationId })}`),
    myMembers: () => r<ListOf<MyMember>>("GET", "/schedule/my-members"),
    qrToken: (memberId: string) =>
      r<QrToken>("GET", `/schedule/qr-token${qs({ member_id: memberId })}`),
    checkInMember: (locationId: string, memberId: string) =>
      r<CheckInResult>("POST", "/schedule/check-ins", {
        location_id: locationId,
        member_id: memberId,
      }),
    checkInToken: (locationId: string, token: string) =>
      r<CheckInResult>("POST", "/schedule/check-ins", { location_id: locationId, token }),
    checkIns: (p: { location_id?: string; member_id?: string; limit?: string }) =>
      r<ListOf<CheckInRow>>("GET", `/schedule/check-ins${qs(p)}`),
  };
}
export type ScheduleApi = ReturnType<typeof scheduleApi>;
