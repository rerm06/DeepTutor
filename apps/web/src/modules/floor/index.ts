import type { AppModule } from "../types";
import { CircuitsScreen } from "./CircuitsScreen";
import { EquipmentScreen } from "./EquipmentScreen";
import { ExercisesScreen } from "./ExercisesScreen";
import { MyCircuitsScreen } from "./MyCircuitsScreen";
import { StationScreen } from "./StationScreen";
import { FLOOR_ISSUE_STAFF, FLOOR_MANAGERS } from "./api";
import { floorDict } from "./dict";

const label = (key: keyof typeof floorDict.es) => ({
  es: floorDict.es[key],
  en: floorDict.en[key],
});

/** Web UI for module floor (Sala, equipos y circuitos, spec §6.4). */
export const module: AppModule = {
  id: "floor",
  routes: [
    { path: "/staff/floor/equipment", audience: FLOOR_ISSUE_STAFF, Component: EquipmentScreen },
    { path: "/staff/floor/exercises", audience: FLOOR_MANAGERS, Component: ExercisesScreen },
    { path: "/staff/floor/circuits", audience: FLOOR_MANAGERS, Component: CircuitsScreen },
    // Runs and set logs are the member's own; guardians have no write path (the API refuses them).
    { path: "/me/circuits", audience: ["member"], Component: MyCircuitsScreen },
    { path: "/me/station", audience: ["member"], Component: StationScreen },
  ],
  nav: [
    { to: "/staff/floor/equipment", label: label("nav.equipment"), audience: FLOOR_ISSUE_STAFF },
    { to: "/staff/floor/exercises", label: label("nav.exercises"), audience: FLOOR_MANAGERS },
    { to: "/staff/floor/circuits", label: label("nav.circuits"), audience: FLOOR_MANAGERS },
    { to: "/me/circuits", label: label("nav.myCircuits"), audience: ["member"] },
    { to: "/me/station", label: label("nav.station"), audience: ["member"] },
  ],
  memberTabs: [],
};
