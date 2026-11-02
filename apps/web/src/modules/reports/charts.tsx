/**
 * Small SVG charts for the executive dashboard. No chart library: thin marks (2px lines, ≤24px columns with a
 * 4px rounded data-end), hairline grid, one y-axis, legend for ≥2 series, crosshair/tooltip on hover AND keyboard,
 * and every chart ships a data table (<details>) so no value is reachable only by hover or colour.
 * Colours come from the validated --viz-* tokens in styles.css. Labels are inserted as React text (never HTML).
 */
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

export interface Series {
  key: string;
  label: string;
  /** CSS colour, normally var(--viz-1) … */
  color: string;
  values: number[];
}

/** Clean ticks: 0 and 3–4 round steps covering max. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw && Math.abs(cw - w) > 1) setW(Math.round(cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return [ref, w] as const;
}

/* ── Sparkline (decorative; the tile states the value and delta in text) ── */
export function Sparkline({
  values,
  color = "var(--viz-1)",
}: { values: number[]; color?: string }) {
  const W = 120;
  const H = 36;
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (W - 6) + 3,
    H - 4 - ((v - min) / span) * (H - 10),
  ]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x?.toFixed(1)},${y?.toFixed(1)}`).join("");
  const last = pts[pts.length - 1] ?? [0, 0];
  return (
    <svg
      className="viz-spark"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      aria-hidden="true"
      focusable="false"
    >
      <path d={`${d}L${last[0]},${H}L3,${H}Z`} fill={color} opacity="0.12" />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r="4"
        fill={color}
        stroke="var(--surface)"
        strokeWidth="2"
      />
    </svg>
  );
}

/* ── Shared frame: title, legend, chart, data table ── */
export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  tableLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: Array<{ label: string; color: string; shape?: "line" | "box" }>;
  table: ReactNode;
  tableLabel: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="viz-card" aria-labelledby={id}>
      <header className="viz-card__head">
        <h3 className="viz-card__title" id={id}>
          {title}
        </h3>
        {subtitle ? <p className="viz-card__sub">{subtitle}</p> : null}
      </header>
      {legend && legend.length > 1 ? (
        <ul className="viz-legend">
          {legend.map((l) => (
            <li key={l.label}>
              <span
                className={`viz-key viz-key--${l.shape ?? "line"}`}
                style={{ background: l.color }}
                aria-hidden="true"
              />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      {children}
      <details className="viz-table">
        <summary>{tableLabel}</summary>
        {table}
      </details>
    </section>
  );
}

/* ── Line / area chart over categories (months), one y-axis ── */
export function LineChart({
  categories,
  series,
  format,
  formatAxis,
  area = false,
  height = 220,
  label,
}: {
  categories: string[];
  series: Series[];
  format: (n: number) => string;
  formatAxis: (n: number) => string;
  area?: boolean;
  height?: number;
  /** Accessible name of the plot (the frame title). */
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 52, r: 16, t: 12, b: 26 };
  const n = categories.length;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const step = n > 8 && iw < 520 ? 2 : 1;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.l;
    const i = Math.round((px / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setHover((h) => {
        const cur = h ?? n - 1;
        return Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowRight" ? 1 : -1)));
      });
    }
    if (e.key === "Escape") setHover(null);
  };
  const tipX = hover === null ? 0 : x(hover);

  return (
    <div className="viz-plot" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus moves the crosshair readout with the arrow keys; every value is also in the data table
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? n - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={pad.l - 8} y={y(t)} className="viz-axis" textAnchor="end" dy="0.32em">
              {formatAxis(t)}
            </text>
          </g>
        ))}
        {categories.map((c, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={c} x={x(i)} y={height - 6} className="viz-axis" textAnchor="middle">
              {c}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const d = s.values
            .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
            .join("");
          return (
            <g key={s.key}>
              {area ? (
                <path
                  d={`${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`}
                  fill={s.color}
                  opacity="0.12"
                />
              ) : null}
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle
                cx={x(n - 1)}
                cy={y(s.values[n - 1] ?? 0)}
                r="4"
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            </g>
          );
        })}
        {hover !== null ? (
          <g pointerEvents="none">
            <line x1={tipX} x2={tipX} y1={pad.t} y2={pad.t + ih} className="viz-crosshair" />
            {series.map((s) => (
              <circle
                key={s.key}
                cx={tipX}
                cy={y(s.values[hover] ?? 0)}
                r="5"
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            ))}
          </g>
        ) : null}
      </svg>
      {hover !== null ? (
        <output
          className="viz-tip"
          style={{
            left: Math.min(Math.max(tipX, 80), width - 80),
          }}
        >
          <strong className="viz-tip__head">{categories[hover]}</strong>
          {series.map((s) => (
            <span key={s.key} className="viz-tip__row">
              <span className="viz-key viz-key--line" style={{ background: s.color }} />
              <b>{format(s.values[hover] ?? 0)}</b> {s.label}
            </span>
          ))}
        </output>
      ) : null}
    </div>
  );
}

/* ── Grouped columns (≤24px, rounded data-end, 2px gap between neighbours) ── */
export function ColumnChart({
  categories,
  series,
  format,
  height = 200,
  label,
}: {
  categories: string[];
  series: Series[];
  format: (n: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(360);
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 36, r: 8, t: 12, b: 26 };
  const n = categories.length;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] || 1;
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const band = iw / Math.max(1, n);
  const barW = Math.min(24, Math.max(3, (band * 0.7 - 2 * (series.length - 1)) / series.length));
  const groupW = barW * series.length + 2 * (series.length - 1);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const step = n > 8 && iw < 420 ? 2 : 1;

  const bar = (x0: number, v: number) => {
    const h = Math.max(0, y(0) - y(v));
    if (h <= 0) return "";
    const r = Math.min(4, h, barW / 2);
    const yt = y(v);
    return `M${x0},${y(0)}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x0 + barW - r}Q${x0 + barW},${yt} ${x0 + barW},${yt + r}V${y(0)}Z`;
  };

  return (
    <div className="viz-plot" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus moves the crosshair readout with the arrow keys; every value is also in the data table
        tabIndex={0}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? n - 1)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            setHover((h) =>
              Math.max(0, Math.min(n - 1, (h ?? n - 1) + (e.key === "ArrowRight" ? 1 : -1))),
            );
          }
          if (e.key === "Escape") setHover(null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={pad.l - 6} y={y(t)} className="viz-axis" textAnchor="end" dy="0.32em">
              {format(t)}
            </text>
          </g>
        ))}
        {categories.map((c, i) => {
          const gx = pad.l + i * band + (band - groupW) / 2;
          return (
            <g
              key={c}
              onPointerEnter={() => setHover(i)}
              className={hover === i ? "viz-col is-hover" : "viz-col"}
            >
              <rect x={pad.l + i * band} y={pad.t} width={band} height={ih} fill="transparent" />
              {series.map((s, si) => (
                <path key={s.key} d={bar(gx + si * (barW + 2), s.values[i] ?? 0)} fill={s.color} />
              ))}
              {i % step === 0 || i === n - 1 ? (
                <text
                  x={pad.l + i * band + band / 2}
                  y={height - 6}
                  className="viz-axis"
                  textAnchor="middle"
                >
                  {c}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <output
          className="viz-tip"
          style={{ left: Math.min(Math.max(pad.l + hover * band + band / 2, 70), width - 70) }}
        >
          <strong className="viz-tip__head">{categories[hover]}</strong>
          {series.map((s) => (
            <span key={s.key} className="viz-tip__row">
              <span className="viz-key viz-key--box" style={{ background: s.color }} />
              <b>{format(s.values[hover] ?? 0)}</b> {s.label}
            </span>
          ))}
        </output>
      ) : null}
    </div>
  );
}

/* ── Donut (part-to-whole, ≤4 slices + centre total; legend carries label, count and share) ── */
export function Donut({
  slices,
  total,
  centerLabel,
  format,
  label,
}: {
  slices: Array<{ key: string; label: string; value: number; color: string }>;
  total: number;
  centerLabel: string;
  format: (n: number) => string;
  label: string;
}) {
  const S = 168;
  const r = 66;
  const w = 18;
  const C = 2 * Math.PI * r;
  const sum = slices.reduce((a, s) => a + s.value, 0);
  const gap = sum > 0 && slices.filter((s) => s.value > 0).length > 1 ? 2 : 0;
  const arcs = useMemo(() => {
    let acc = 0;
    return slices.map((s) => {
      const len = sum ? (s.value / sum) * C : 0;
      const a = { ...s, len: Math.max(0, len - gap), off: acc };
      acc += len;
      return a;
    });
  }, [slices, sum, C, gap]);
  return (
    <div className="viz-donut">
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} role="img" aria-label={label}>
        <circle cx={S / 2} cy={S / 2} r={r} fill="none" stroke="var(--viz-grid)" strokeWidth={w} />
        {arcs.map((a) =>
          a.len > 0 ? (
            <circle
              key={a.key}
              cx={S / 2}
              cy={S / 2}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={w}
              strokeDasharray={`${a.len} ${C - a.len}`}
              strokeDashoffset={-a.off}
              transform={`rotate(-90 ${S / 2} ${S / 2})`}
            >
              <title>{`${a.label}: ${format(a.value)}`}</title>
            </circle>
          ) : null,
        )}
        <text x={S / 2} y={S / 2 - 4} textAnchor="middle" className="viz-donut__total">
          {format(total)}
        </text>
        <text x={S / 2} y={S / 2 + 16} textAnchor="middle" className="viz-axis">
          {centerLabel}
        </text>
      </svg>
      <ul className="viz-donut__legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span
              className="viz-key viz-key--box"
              style={{ background: s.color }}
              aria-hidden="true"
            />
            <span className="viz-donut__name">{s.label}</span>
            <b>{format(s.value)}</b>
            <span className="viz-donut__pct">
              {sum ? `${Math.round((s.value / sum) * 100)} %` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Horizontal bars (ranked share; value at the tip) ── */
export function BarList({
  rows,
  format,
  color = "var(--viz-1)",
}: {
  rows: Array<{ key: string; label: string; value: number; note?: string }>;
  format: (n: number) => string;
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="viz-bars">
      {rows.map((r) => (
        <li key={r.key} className="viz-bars__row">
          <span className="viz-bars__label">{r.label}</span>
          <span className="viz-bars__track" aria-hidden="true">
            <span
              className="viz-bars__fill"
              style={{ width: `${(r.value / max) * 100}%`, background: color }}
            />
          </span>
          <span className="viz-bars__value">
            {format(r.value)}
            {r.note ? <span className="viz-bars__note"> · {r.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
