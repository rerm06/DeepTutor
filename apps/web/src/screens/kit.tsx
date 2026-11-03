import { type ReactNode, useId } from "react";
import { Icon, type IconName } from "../components/icons";
import { useI18n } from "../i18n/I18nContext";
import "./screens.css";

/* Extra stroke icons for the core screens (24-unit grid, same style as components/icons.tsx). */
export const CORE_ICON = {
  inbox: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6l2-8Z",
  shield: "M12 3 5 6v5c0 4.6 3 8.6 7 10 4-1.4 7-5.4 7-10V6l-7-3ZM9 12l2 2 4-4",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  idCard: "M3 5h18v14H3zM7 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM5.5 16a3.5 3.5 0 0 1 7 0M14 9h4M14 13h4",
  alert: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
  send: "M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
} as const;

type IconRef = { name: IconName; d?: undefined } | { name?: undefined; d: string };
export function GoldIcon({ icon, size = 22 }: { icon: IconName | string; size?: number }) {
  const ref: IconRef =
    icon in CORE_ICON
      ? { d: CORE_ICON[icon as keyof typeof CORE_ICON] }
      : { name: icon as IconName };
  return <Icon {...ref} size={size} />;
}

/** `.section` card whose title starts with a gold icon (design system v2). */
export function Card({
  icon,
  title,
  actions,
  children,
  level = 2,
  className,
  tourId,
}: {
  icon: IconName | keyof typeof CORE_ICON;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  level?: 2 | 3;
  className?: string;
  tourId?: string;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section
      className={className ? `section ${className}` : "section"}
      aria-labelledby={id}
      data-tour-id={tourId}
    >
      <div className="section__head">
        <Heading id={id} className="section__title">
          <GoldIcon icon={icon} size={24} />
          {title}
        </Heading>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One `.ds-stat` (gold icon · label · value · hint); put several inside a `<div className="ds-stats">`. */
export function Stat({
  icon,
  label,
  value,
  hint,
  mono,
}: {
  icon: IconName | keyof typeof CORE_ICON;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="ds-stat">
      <GoldIcon icon={icon} size={32} />
      <dl className="ds-stat__text core-stat">
        <dt className="ds-stat__label">{label}</dt>
        <dd className={`ds-stat__value${mono ? " core-stat__mono" : ""}`}>{value}</dd>
        {hint ? <dd className="ds-stat__hint">{hint}</dd> : null}
      </dl>
    </div>
  );
}

export function Empty({
  icon,
  title,
  action,
}: {
  icon: IconName | keyof typeof CORE_ICON;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="ds-empty">
      <GoldIcon icon={icon} size={40} />
      <strong>{title}</strong>
      {action ?? null}
    </div>
  );
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* Copy that only the restyled core screens use (kept here so the shared dictionary stays untouched). */
const COPY = {
  es: {
    "entry.orgs": "Organizaciones",
    "entry.personas": "Personas demo",
    "entry.personasHint": "Cada una con sus permisos",
    "members.lede": "Busca, filtra y abre la ficha de cada socio.",
    "members.directory": "Directorio de socios",
    "members.shown": "Socios en la lista",
    "members.active": "Activos",
    "members.attention": "Requieren atención",
    "members.attentionHint": "Pago atrasado o congelados",
    "member.tabs": "Secciones de la ficha",
    "member.tab.consents": "Consentimientos",
    "member.tab.messages": "Mensajes",
    "inbox.lede": "Mensajes entrantes de los socios por canal y sede.",
    "inbox.total": "Mensajes",
    "inbox.messages": "Mensajes recibidos",
    "inbox.toMembers": "Ver socios",
    "audit.lede": "Registro de cambios hechos en la consola: quién, qué y dónde.",
    "audit.entries": "Entradas",
    "audit.latest": "Último cambio",
    "audit.log": "Registro",
    "org.lede": "Tu organización, tu rol y las sedes a las que tienes acceso.",
    "org.profile": "Tu perfil",
    "org.shortcuts": "Accesos",
    "account.lede": "Tus datos, tus membresías y tus preferencias de contacto.",
    "account.profile": "Mis datos",
    "account.shortcuts": "Accesos rápidos",
    "account.home": "Mi Panel",
    "account.classes": "Mis clases",
    "account.credential": "Mi credencial",
    "myConsents.channels": "Canales y propósitos",
    "messages.send": "Enviar mensaje",
    "consent.granted": "Autorizados",
    "consent.revoked": "Revocados",
  },
  en: {
    "entry.orgs": "Organizations",
    "entry.personas": "Demo personas",
    "entry.personasHint": "Each with its own permissions",
    "members.lede": "Search, filter and open each member's record.",
    "members.directory": "Member directory",
    "members.shown": "Members listed",
    "members.active": "Active",
    "members.attention": "Need attention",
    "members.attentionHint": "Past due or frozen",
    "member.tabs": "Record sections",
    "member.tab.consents": "Consents",
    "member.tab.messages": "Messages",
    "inbox.lede": "Inbound member messages by channel and location.",
    "inbox.total": "Messages",
    "inbox.messages": "Messages received",
    "inbox.toMembers": "See members",
    "audit.lede": "Log of changes made in the console: who, what and where.",
    "audit.entries": "Entries",
    "audit.latest": "Latest change",
    "audit.log": "Log",
    "org.lede": "Your organization, your role and the locations you can access.",
    "org.profile": "Your profile",
    "org.shortcuts": "Shortcuts",
    "account.lede": "Your details, your memberships and your contact preferences.",
    "account.profile": "My details",
    "account.shortcuts": "Shortcuts",
    "account.home": "My Panel",
    "account.classes": "My classes",
    "account.credential": "My credential",
    "myConsents.channels": "Channels and purposes",
    "messages.send": "Send a message",
    "consent.granted": "Granted",
    "consent.revoked": "Revoked",
  },
} as const;
export type CoreKey = keyof (typeof COPY)["es"];

export function useCoreCopy() {
  const { lang } = useI18n();
  return (key: CoreKey) => COPY[lang === "en" ? "en" : "es"][key];
}
