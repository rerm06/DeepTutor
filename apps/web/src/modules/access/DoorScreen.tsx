import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { MemberAvatar } from "../../components/MemberPhotoCard";
import { Icon } from "../../components/icons";
import { DEMO, PRODUCTION_GYMS } from "../../lib/mode";
import { isMemberRole } from "../../lib/roles";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { DEMO_JOIN_ORGS } from "../signup/demoOrgs";
import { CodeSignIn, DoorScanner, type GymChoice } from "./SignIn";
import { type DoorPass, useAccessApi } from "./api";
import { type AccessKey, dict } from "./dict";

const clock = (iso: string, lang: string) =>
  new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-PR", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Puerto_Rico",
  }).format(new Date(iso));

/** What a phone opens when it scans a door code: records the entry/exit, or asks the person to sign in first. */
export function DoorScreen() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const { persona, role } = useSession();
  const { t } = useModuleT(dict);
  const orgHint = params.get("o") ?? undefined;
  const gyms = useGyms();

  return (
    <div className="acc-door" data-direction={token.split(".")[2] === "o" ? "out" : "in"}>
      {!persona ? (
        <section className="section acc-door__card" aria-labelledby="door-signin">
          <Icon name="qr" size={44} className="acc-door__icon" />
          <h1 id="door-signin" className="page__title acc-door__title">
            {t("door.signin")}
          </h1>
          <p className="lede">{t("door.signinSub")}</p>
          <CodeSignIn gyms={gyms} defaultGym={orgHint} next="/me/access?scan=1" />
          {orgHint ? (
            <Link className="btn btn--ghost" to={`/join/${orgHint}`}>
              {t("signin.join")}
            </Link>
          ) : null}
        </section>
      ) : isMemberRole(role) ? (
        <DoorResult token={token} />
      ) : (
        <section className="section acc-door__card">
          <Icon name="users" size={44} className="acc-door__icon" />
          <p className="lede">{t("door.staff")}</p>
        </section>
      )}
    </div>
  );
}

function DoorResult({ token }: { token: string }) {
  const { t, lang } = useModuleT(dict);
  const acc = useAccessApi();
  const [r, setR] = useState<DoorPass | null>(null);
  const [failed, setFailed] = useState(false);
  const [scan, setScan] = useState(false);
  const sent = useRef(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  // Move focus to the verdict so screen readers announce it as soon as it appears.
  useEffect(() => {
    if (r || failed) headRef.current?.focus();
  }, [r, failed]);

  useEffect(() => {
    if (sent.current) return; // StrictMode double effect: one pass per scan
    sent.current = true;
    acc
      .pass(token)
      .then(setR)
      .catch(() => setFailed(true));
  }, [acc, token]);

  if (scan) return <DoorScanner onClose={() => setScan(false)} />;
  if (!r && !failed)
    return (
      <output className="acc-door__card acc-door__card--wait" aria-live="polite">
        <span className="acc-spinner" aria-hidden="true" />
        {t("door.checking")}
      </output>
    );

  const time = r ? clock(r.at, lang) : "";
  const loc = r?.location_name ?? "";
  const first = (r?.full_name ?? "").split(/\s+/)[0] ?? "";
  let tone: "ok" | "bye" | "warn" | "bad" = "warn";
  let title: AccessKey = "door.invalid";
  let sub = "";
  if (!r || r.result === "invalid") {
    tone = "bad";
    title = "door.invalid";
    sub = t("door.invalidSub");
  } else if (r.result === "allowed") {
    tone = "ok";
    title = "door.allowed";
    sub = t("door.allowedSub", { location: loc, time });
  } else if (r.result === "denied") {
    tone = "bad";
    title = "door.denied";
    sub = t(`reason.${r.reason}` as AccessKey);
  } else if (r.result === "already_in") {
    title = "door.already";
    sub = t("door.alreadySub", { location: loc });
  } else if (r.result === "checked_out") {
    tone = "bye";
    title = "door.out";
    sub = t("door.outSub", { location: loc, time });
  } else if (r.result === "not_in") {
    title = "door.notIn";
    sub = t("door.notInSub", { location: loc });
  } else if (r.result === "expired") {
    title = "door.expired";
    sub = t("door.expiredSub");
  }
  const icon = tone === "ok" || tone === "bye" ? "checkCircle" : tone === "bad" ? "close" : "help";

  return (
    <section
      className={`section acc-door__card acc-door__card--${tone}`}
      aria-labelledby="door-result"
    >
      <div className="acc-door__who">
        {r ? <MemberAvatar memberId={r.member_id} name={r.full_name} size={96} /> : null}
        <span className="acc-door__badge" aria-hidden="true">
          <Icon name={icon} size={30} />
        </span>
      </div>
      <h1 id="door-result" ref={headRef} tabIndex={-1} className="page__title acc-door__title">
        {t(title, { name: first })}
      </h1>
      <p className="lede acc-door__sub">{sub}</p>
      <div className="acc-door__actions">
        {r?.result === "allowed" ? (
          <Link className="btn btn--primary" to="/me/programs">
            <Icon name="dumbbell" size={20} />
            {t("door.routine")}
          </Link>
        ) : null}
        {r?.result === "expired" || r?.result === "invalid" || r?.result === "already_in" ? (
          <button type="button" className="btn btn--primary" onClick={() => setScan(true)}>
            <Icon name="qr" size={20} />
            {t("door.scanAgain")}
          </button>
        ) : null}
        <Link className="btn" to="/me/home">
          {t("door.portal")}
        </Link>
      </div>
    </section>
  );
}

/** "Soy socio" on the entry screen: sign in with a code, scan the door, or sign up. */
export function MemberEntry({ gyms }: { gyms: GymChoice[] }) {
  const { t } = useModuleT(dict);
  const [mode, setMode] = useState<"menu" | "code" | "scan">("menu");
  return (
    <section className="section acc-entry" aria-labelledby="acc-entry">
      <div className="section__head">
        <h2 id="acc-entry" className="section__title">
          <Icon name="users" size={24} />
          {t("signin.title")}
        </h2>
      </div>
      <p className="lede">{t("signin.lede")}</p>
      {mode === "menu" ? (
        <div className="acc-ways">
          <button
            type="button"
            className="acc-way"
            onClick={() => setMode("code")}
            data-tour-id="entry-code"
          >
            <span className="acc-way__icon" aria-hidden="true">
              <Icon name="mail" size={26} />
            </span>
            <strong>{t("signin.code")}</strong>
            <span>{t("signin.codeHelp")}</span>
          </button>
          <button
            type="button"
            className="acc-way"
            onClick={() => setMode("scan")}
            data-tour-id="entry-scan"
          >
            <span className="acc-way__icon" aria-hidden="true">
              <Icon name="qr" size={26} />
            </span>
            <strong>{t("signin.scan")}</strong>
            <span>{t("signin.scanHelp")}</span>
          </button>
          {gyms[0] ? (
            <Link className="acc-way" to={`/join/${gyms[0].id}`} data-tour-id="entry-register">
              <span className="acc-way__icon" aria-hidden="true">
                <Icon name="userPlus" size={26} />
              </span>
              <strong>{t("signin.join")}</strong>
              <span>{t("signin.joinHelp")}</span>
            </Link>
          ) : null}
        </div>
      ) : mode === "code" ? (
        <CodeSignIn gyms={gyms} onBack={() => setMode("menu")} />
      ) : (
        <DoorScanner onClose={() => setMode("menu")} />
      )}
    </section>
  );
}

/** The gyms a visitor can sign in to (demo organisations, named from the demo personas). */
export function useGyms(): GymChoice[] {
  const { api } = useSession();
  const personas = useAsync(() => (DEMO ? api.personas() : Promise.resolve({ data: [] })), [api]);
  if (!DEMO) return [...PRODUCTION_GYMS];
  const names = new Map<string, string>(
    (personas.data?.data ?? []).map((p) => [p.org, p.org_name]),
  );
  return Object.entries(DEMO_JOIN_ORGS).map(([k, id]) => ({ id, name: names.get(k) ?? k }));
}
