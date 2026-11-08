import { FLOOR_MANAGERS } from "./api";

export { isMemberRole } from "../../lib/roles";
/** Roles that run the floor and read members' training (owner, location manager, trainer). */
export const FLOOR_MANAGERS_SET = new Set(FLOOR_MANAGERS);
