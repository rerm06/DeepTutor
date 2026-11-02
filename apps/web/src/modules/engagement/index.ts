import type { AppModule } from "../types";
import "./engagement.css";
import { MemberPointsTab } from "./MemberPointsTab";
import {
  MyChallengesScreen,
  MyPointsScreen,
  RedeemScreen,
  ReferScreen,
  WallScreen,
} from "./MemberScreens";
import { StaffChallengesScreen } from "./StaffChallengesScreen";
import { StaffCommunityScreen } from "./StaffCommunityScreen";
import { StaffPointsScreen } from "./StaffPointsScreen";
import { StaffRewardsScreen } from "./StaffRewardsScreen";

const FRONT = ["owner", "location_manager", "front_desk"] as const;

/** Paths of module engagement (spec §9 · Comunidad, retos y fidelización). */
export const ENGAGEMENT_ROUTES = {
  challenges: "/staff/engagement/challenges",
  points: "/staff/engagement/points",
  rewards: "/staff/engagement/rewards",
  community: "/staff/engagement/community",
  myPoints: "/me/points",
  myChallenges: "/me/challenges",
  wall: "/me/wall",
  refer: "/me/refer",
  redeem: "/me/redeem",
} as const;

/**
 * Web UI for module engagement. Audiences mirror the database rules (migration 0012): front of house runs points,
 * rewards and moderation; the trainer views challenges; the accountant sees only the points liability; members act
 * for themselves; guardians view their ward's points and challenges (no wall, referrals or redemptions).
 */
export const module: AppModule = {
  id: "engagement",
  routes: [
    {
      path: ENGAGEMENT_ROUTES.challenges,
      audience: [...FRONT, "trainer"],
      Component: StaffChallengesScreen,
    },
    {
      path: ENGAGEMENT_ROUTES.points,
      audience: [...FRONT, "accountant"],
      Component: StaffPointsScreen,
    },
    { path: ENGAGEMENT_ROUTES.rewards, audience: FRONT, Component: StaffRewardsScreen },
    { path: ENGAGEMENT_ROUTES.community, audience: FRONT, Component: StaffCommunityScreen },
    { path: ENGAGEMENT_ROUTES.myPoints, audience: "member", Component: MyPointsScreen },
    { path: ENGAGEMENT_ROUTES.myChallenges, audience: "member", Component: MyChallengesScreen },
    { path: ENGAGEMENT_ROUTES.wall, audience: ["member"], Component: WallScreen },
    { path: ENGAGEMENT_ROUTES.refer, audience: ["member"], Component: ReferScreen },
    { path: ENGAGEMENT_ROUTES.redeem, audience: ["member"], Component: RedeemScreen },
  ],
  nav: [
    {
      to: ENGAGEMENT_ROUTES.challenges,
      label: { es: "Retos", en: "Challenges" },
      audience: [...FRONT, "trainer"],
    },
    {
      to: ENGAGEMENT_ROUTES.points,
      label: { es: "Puntos", en: "Points" },
      audience: [...FRONT, "accountant"],
    },
    { to: ENGAGEMENT_ROUTES.rewards, label: { es: "Recompensas", en: "Rewards" }, audience: FRONT },
    {
      to: ENGAGEMENT_ROUTES.community,
      label: { es: "Comunidad", en: "Community" },
      audience: FRONT,
    },
    {
      to: ENGAGEMENT_ROUTES.myPoints,
      label: { es: "Mis puntos", en: "My points" },
      audience: "member",
    },
    {
      to: ENGAGEMENT_ROUTES.myChallenges,
      label: { es: "Retos", en: "Challenges" },
      audience: "member",
    },
    { to: ENGAGEMENT_ROUTES.wall, label: { es: "Muro", en: "Wall" }, audience: ["member"] },
    { to: ENGAGEMENT_ROUTES.refer, label: { es: "Referir", en: "Refer" }, audience: ["member"] },
    { to: ENGAGEMENT_ROUTES.redeem, label: { es: "Canjear", en: "Redeem" }, audience: ["member"] },
  ],
  memberTabs: [
    {
      id: "engagement-points",
      label: { es: "Puntos", en: "Points" },
      audience: FRONT,
      Component: MemberPointsTab,
    },
  ],
};
