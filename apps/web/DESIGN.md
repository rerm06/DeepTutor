# Design system: gym console

Source of truth: `src/styles.css` (tokens + base components) and `src/modules/*/*.css` (module-only additions).
Register: product (see `PRODUCT.md`). Tenant branding arrives at runtime from `GET /v1/brand` and is sanitised by
`src/lib/brandTheme.ts` before it touches CSS.

## Scene
Owner and staff under bright gym/office light, on laptop or counter tablet, interrupted often → light content
surface by default, system dark mode respected. Members on a phone mid-workout → bottom quick bar, 56 px targets.

## Colour strategy
Restrained content, Committed chrome. The tenant colour carries the sidebar (`--header-bg` / `--header-text`,
default `--chrome-bg` #14171c) and the current-selection pill (`--accent` with `--accent-text`). Everything else is
neutral so numbers and states read first.

| Token | Role |
| --- | --- |
| `--bg`, `--surface`, `--surface-2` | page, raised surface, sunken/table head |
| `--text`, `--text-muted` | ink (≥ 4.5:1 on every surface) |
| `--accent`, `--accent-hover`, `--accent-text` | primary action fill, selected nav item (tenant-overridable) |
| `--accent-fg` | accent used as text/line on the page; lifted toward white in dark mode so a dark tenant gold stays legible |
| `--ok-*`, `--warn-*`, `--blocked-*`, `--neutral-*` | state backgrounds, text and lines (each pair AA) |
| `--chrome-*` | sidebar text, muted, divider, hover, focus derived from the header text colour |

## Typography
Barlow for all UI, labels, data and tables (tabular numerals on numbers). Barlow Condensed only for page titles
(`.page__title`, 2.25 rem) and the check-in verdict. JetBrains Mono only for identifiers (member numbers,
emails, codes). No uppercase-tracked labels.

## Shape, elevation, layers
Radius 8 px containers, 6 px controls, pills for status plates. One elevation (`--shadow-raised`) for surfaces,
one for overlays (`--shadow-overlay`). Z scale: `--z-sticky` 20 → `--z-modal-backdrop` 40 → `--z-modal` 50 →
`--z-toast` 60.

## Navigation
One `<nav>` landmark. ≥ 1024 px: 256 px sticky sidebar grouped by job (Operación de hoy, Socios y prospectos,
Cobros y tienda, Entrenamiento y salud, Fidelización, Administración; members: Mi cuenta, Entrenar, Comunidad,
Tienda). Grouping is derived from the route path in `components/Layout.tsx` (`groupOf`). < 1024 px: the same
panel is a drawer (menu button, Escape, scrim, page behind is `inert`); members also get a bottom quick bar
(Mi cuenta, Clases, Mi credencial, Mis circuitos, Menú).

## Components
- KPI group: one surface, tiles as cells of a hairline grid; tone = dot beside the label + detail link.
- Status plate: pill with a leading dot, state colour pair, sentence case.
- Notes/alerts: full 1 px border + tinted background. Side-stripe borders are banned.
- Tables: sentence-case header on `--surface-2`, middle-aligned rows, hover tint, identifiers never wrap.

## Motion
150 ms colour/border transitions, 240 ms drawer slide, ease-out-quint. `prefers-reduced-motion` collapses all of
it. No page-load choreography.
