/**
 * DEMO MODE personas. Synthetic only: every org, person and email is fictitious and marked "Demo".
 * Must match packages/db/seed/demo.sql (UUIDs below are the seed's primary keys).
 */
export interface DemoPersona {
  id: string;
  org: "A" | "B";
  org_name: string;
  org_id: string;
  person_id: string;
  role:
    | "owner"
    | "location_manager"
    | "front_desk"
    | "trainer"
    | "accountant"
    | "member"
    | "guardian";
  display_name: string;
  location_ids: string[];
  home: string | null;
}

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000001";
export const DEMO_IDS = {
  orgA: A,
  orgB: B,
  brandA: "a0000000-0000-4000-8000-000000000003",
  brandB: "b0000000-0000-4000-8000-000000000003",
  locA1: "a0000000-0000-4000-8000-000000000011",
  locA2: "a0000000-0000-4000-8000-000000000012",
  locB1: "b0000000-0000-4000-8000-000000000011",
} as const;

const p = (n: number, org: "a" | "b") =>
  `${org}0000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    id: "A-owner",
    org: "A",
    org_name: "Demo Gym Norte",
    org_id: A,
    person_id: p(1, "a"),
    role: "owner",
    display_name: "Carmen Ortiz",
    location_ids: [],
    home: null,
  },
  {
    id: "A-manager",
    org: "A",
    org_name: "Demo Gym Norte",
    org_id: A,
    person_id: p(2, "a"),
    role: "location_manager",
    display_name: "Luis Vega",
    location_ids: [DEMO_IDS.locA1],
    home: "Demo Sede San Juan",
  },
  {
    id: "A-front",
    org: "A",
    org_name: "Demo Gym Norte",
    org_id: A,
    person_id: p(3, "a"),
    role: "front_desk",
    display_name: "Marisol Cruz",
    location_ids: [DEMO_IDS.locA1],
    home: "Demo Sede San Juan",
  },
  {
    id: "A-front2",
    org: "A",
    org_name: "Demo Gym Norte",
    org_id: A,
    person_id: p(4, "a"),
    role: "front_desk",
    display_name: "Javier Colón",
    location_ids: [DEMO_IDS.locA2],
    home: "Demo Sede Bayamón",
  },
  {
    id: "A-trainer",
    org: "A",
    org_name: "Demo Gym Norte",
    org_id: A,
    person_id: p(5, "a"),
    role: "trainer",
    display_name: "Ricardo Santos",
    location_ids: [DEMO_IDS.locA1],
    home: "Demo Sede San Juan",
  },
  {
    id: "A-accountant",
    org: "A",
    org_name: "Demo Gym Norte",
    org_id: A,
    person_id: p(6, "a"),
    role: "accountant",
    display_name: "Elena Pagán",
    location_ids: [],
    home: null,
  },
  {
    id: "A-member",
    org: "A",
    org_name: "Demo Gym Norte",
    org_id: A,
    person_id: p(10, "a"),
    role: "member",
    display_name: "Ana Rivera",
    location_ids: [],
    home: "Demo Sede San Juan",
  },
  {
    id: "A-guardian",
    org: "A",
    org_name: "Demo Gym Norte",
    org_id: A,
    person_id: p(20, "a"),
    role: "guardian",
    display_name: "Rosa Méndez",
    location_ids: [],
    home: null,
  },
  {
    id: "B-owner",
    org: "B",
    org_name: "Demo Club Sur",
    org_id: B,
    person_id: p(1, "b"),
    role: "owner",
    display_name: "Héctor Ramos",
    location_ids: [],
    home: null,
  },
  {
    id: "B-front",
    org: "B",
    org_name: "Demo Club Sur",
    org_id: B,
    person_id: p(3, "b"),
    role: "front_desk",
    display_name: "Nilda Torres",
    location_ids: [DEMO_IDS.locB1],
    home: "Demo Sede Ponce",
  },
];
