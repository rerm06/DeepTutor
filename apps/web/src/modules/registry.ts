import { module as billing } from "./billing";
import { module as crm } from "./crm";
import { module as engagement } from "./engagement";
import { module as finance } from "./finance";
import { module as floor } from "./floor";
import { module as health } from "./health";
import { module as reports } from "./reports";
import { module as schedule } from "./schedule";
import { module as store } from "./store";
import type { AppModule } from "./types";

/** Every UI module, in navigation order. */
export const MODULES: readonly AppModule[] = [
  billing,
  schedule,
  crm,
  store,
  health,
  floor,
  engagement,
  finance,
  reports,
];
