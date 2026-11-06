/* Stroke icons drawn for this console (24-unit grid, round caps). Decorative unless a label is passed. */
export const ICON = {
  home: "M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-6h3v6h5V9.5",
  users:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 10v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M21 21v-1a6 6 0 0 0-3.5-5.4",
  doc: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7M9 8h3",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0M8 17h2M12 17h2",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  bag: "M5 8h14l-1 13H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2",
  crm: "M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20v-1a5 5 0 0 1 9-3M13 16a5 5 0 0 1 9 3v1M12 21v-1a4 4 0 0 1 8 0",
  sparkle:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z",
  chart: "M4 20V10M9 20V6M14 20v-8M19 20V4M2 20h20",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2.1-1.6Z",
  academy: "M2 9l10-5 10 5-10 5L2 9Zm4 2.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5M22 9v6",
  building: "M4 21V5l8-2v18M12 8h8v13M2 21h20M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2",
  bell: "M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  dumbbell: "M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11",
  userPlus: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 10v-1a6 6 0 0 1 10-4.5M19 14v6M16 17h6",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6M9 16h3",
  calendarPlus: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M12 13v5M9.5 15.5h5",
  cart: "M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15 8.5c-.6-.9-1.7-1.5-3-1.5-1.7 0-3 .9-3 2.3 0 3.2 6 1.7 6 4.9 0 1.4-1.3 2.3-3 2.3-1.3 0-2.5-.6-3-1.6M12 5.5v13",
  refresh: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2",
  chat: "M21 12a8 8 0 0 1-11.8 7L3 21l2-6.2A8 8 0 1 1 21 12Z",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z",
  flame:
    "M12 22c4 0 7-2.8 7-7 0-3.5-2.3-5.6-4-8-.5 2.2-1.6 3.4-3 4 .2-3.3-1.2-6.3-4-9 .3 3.8-3 6.3-3 11 0 4.6 3 9 7 9Z",
  check: "m5 12.5 4.5 4.5L19 7.5",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12.5l2.7 2.7L16 9.8",
  layers: "m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5",
  trophy:
    "M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13v4M8.5 21h7M10 17h4l.5 4h-5l.5-4Z",
  apple:
    "M12 7c-1-1.5-3.5-2-5-.5C5 8.5 5 12 6.5 15.5 7.6 18 9.2 21 11 20.5c.6-.2.6-.5 1-.5s.4.3 1 .5c1.8.5 3.4-2.5 4.5-5 1.5-3.5 1.5-7-.5-9-1.5-1.5-4-1-5 .5ZM12 7c0-2 1-3.5 3-4",
  headset:
    "M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2v1ZM20 15a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2v1ZM17 17v1a3 3 0 0 1-3 3h-2",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  folder:
    "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-12Z",
  mail: "M3 6h18v12H3zM3.5 6.5 12 13l8.5-6.5",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01",
} as const;
export type IconName = keyof typeof ICON;

export function Icon({
  name,
  d,
  size = 20,
  className,
}: {
  name?: IconName;
  d?: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d ?? (name ? ICON[name] : "")} />
    </svg>
  );
}
