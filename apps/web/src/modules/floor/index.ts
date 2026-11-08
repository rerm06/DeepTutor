import type { AppModule } from "../types";
import { CircuitsScreen } from "./CircuitsScreen";
import { EquipmentScreen } from "./EquipmentScreen";
import { ExercisesScreen } from "./ExercisesScreen";
import { LiveScreen } from "./LiveScreen";
import { MemberTraining as TrainingTab } from "./MemberTraining";
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
    { path: "/staff/floor/live", audience: FLOOR_MANAGERS, Component: LiveScreen },
    // Runs and set logs are the member's own; guardians have no write path (the API refuses them).
    { path: "/me/circuits", audience: ["member"], Component: MyCircuitsScreen },
    { path: "/me/station", audience: ["member"], Component: StationScreen },
  ],
  nav: [
    { to: "/staff/floor/equipment", label: label("nav.equipment"), audience: FLOOR_ISSUE_STAFF },
    { to: "/staff/floor/live", label: label("nav.live"), audience: FLOOR_MANAGERS },
    { to: "/staff/floor/exercises", label: label("nav.exercises"), audience: FLOOR_MANAGERS },
    { to: "/staff/floor/circuits", label: label("nav.circuits"), audience: FLOOR_MANAGERS },
    { to: "/me/circuits", label: label("nav.myCircuits"), audience: ["member"] },
    { to: "/me/station", label: label("nav.station"), audience: ["member"] },
  ],
  // Staff member profile: routines and equipment use (owner, location manager, trainer; RLS scopes the rows).
  memberTabs: [
    {
      id: "training",
      label: label("training.title"),
      audience: FLOOR_MANAGERS,
      Component: TrainingTab,
    },
  ],
};

export { StationUseScreen } from "./StationUseScreen";
export { MemberTraining } from "./MemberTraining";
