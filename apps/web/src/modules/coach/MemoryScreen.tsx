import { type FormEvent, useEffect, useId, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { Empty, HICON, IconSection, Stat } from "../health/components";
import { MEMORY_CATEGORIES, type MemoryCategory, type MemoryFact } from "./api";
import type { CoachKey } from "./dict";
import { MemberPick, useCoachApi, useCoachT, useMyMembers } from "./shared";

/** Only what the server will accept (no markup, braces, links or line breaks); the server re-checks. */
const safe = (s: string) =>
  s.trim().length > 0 && s.length <= 280 && !/[<>{}`\\]/.test(s) && !/(https?:|www\.)/i.test(s);

/** Member/guardian "Mi memoria": list, add, edit and delete facts. */
export function MemoryScreen() {
  const { t } = useCoachT();
  const c = useCoachApi();
  const { list } = useMyMembers();
  const [memberId, setMemberId] = useState("");
  useEffect(() => {
    if (!memberId && list[0]) setMemberId(list[0].id);
  }, [list, memberId]);
  const facts = useAsync(() => c.memory(memberId || undefined), [c, memberId]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);

  async function run(fn: () => Promise<string>) {
    setMsg("");
    setError(null);
    try {
      setMsg(await fn());
      facts.reload();
    } catch (err) {
      setError(toErrorCode(err));
    }
  }

  const rows = facts.data?.data ?? [];

  return (
    <div className="page coach">
      <div>
        <h1 className="page__title">{t("mem.title")}</h1>
        <p className="lede">{t("mem.lede")}</p>
      </div>
      <MemberPick list={list} value={memberId} onChange={setMemberId} />
      {facts.data && rows.length > 0 ? (
        <div className="ds-stats">
          <Stat icon="layers" label={t("mem.stat.total")} value={rows.length} />
          <Stat
            icon="users"
            label={t("mem.stat.mine")}
            value={rows.filter((f) => f.source === "member").length}
          />
          <Stat
            d={HICON.alert}
            label={t("mem.stat.injury")}
            value={rows.filter((f) => f.category === "injury").length}
          />
        </div>
      ) : null}
      <AddFact
        onAdd={(content, category) =>
          run(async () => {
            const r = await c.addFact(content, category, memberId || undefined);
            return t(
              r.operation === "NOOP"
                ? "mem.noop"
                : r.operation === "UPDATE"
                  ? "mem.updated"
                  : "mem.saved",
            );
          })
        }
      />
      {error ? <ErrorNote code={error} /> : null}
      <LiveResult>{msg}</LiveResult>
      {facts.loading && !facts.data ? <Loading /> : null}
      {facts.error ? <ErrorNote code={facts.error} onRetry={facts.reload} /> : null}
      {facts.data && rows.length === 0 ? <Empty icon="layers">{t("mem.empty")}</Empty> : null}
      <ul className="coach-facts ds-grid" data-tour-id="coach-memory-list">
        {rows.map((f) => (
          <FactItem
            key={f.id}
            fact={f}
            onSave={(content, category) =>
              run(async () => {
                await c.editFact(f.id, content, category);
                return t("mem.saved");
              })
            }
            onDelete={() =>
              run(async () => {
                await c.deleteFact(f.id);
                return t("mem.deleted");
              })
            }
          />
        ))}
      </ul>
    </div>
  );
}

function CategorySelect({
  id,
  value,
  onChange,
  allowAuto,
}: {
  id: string;
  value: MemoryCategory | "";
  onChange: (v: MemoryCategory | "") => void;
  allowAuto?: boolean;
}) {
  const { t } = useCoachT();
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as MemoryCategory | "")}>
      {allowAuto ? <option value="">{t("mem.auto")}</option> : null}
      {MEMORY_CATEGORIES.map((cat) => (
        <option key={cat} value={cat}>
          {t(`cat.${cat}` as CoachKey)}
        </option>
      ))}
    </select>
  );
}

function AddFact({ onAdd }: { onAdd: (content: string, category?: MemoryCategory) => void }) {
  const { t } = useCoachT();
  const id = useId();
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory | "">("");
  const valid = safe(content);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onAdd(content.trim(), category || undefined);
    setContent("");
  }
  return (
    <IconSection title={t("mem.add")} d={HICON.plus}>
      <form className="form" onSubmit={submit}>
        <div className="form__grid">
          <div className="field field--wide">
            <label htmlFor={`${id}-c`}>{t("mem.content")}</label>
            <input
              id={`${id}-c`}
              value={content}
              maxLength={280}
              onChange={(e) => setContent(e.target.value.replace(/[\r\n]/g, " "))}
              aria-invalid={content.length > 0 && !valid}
              data-tour-id="coach-memory-input"
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-k`}>{t("mem.category")}</label>
            <CategorySelect id={`${id}-k`} value={category} onChange={setCategory} allowAuto />
          </div>
        </div>
        {category === "injury" ? <p className="help">{t("mem.injuryNote")}</p> : null}
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!valid}
            data-tour-id="coach-memory-save"
          >
            {t("mem.save")}
          </button>
        </div>
      </form>
    </IconSection>
  );
}

function FactItem({
  fact,
  onSave,
  onDelete,
}: {
  fact: MemoryFact;
  onSave: (content: string, category: MemoryCategory) => void;
  onDelete: () => void;
}) {
  const { t } = useCoachT();
  const id = useId();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [content, setContent] = useState(fact.content);
  const [category, setCategory] = useState<MemoryCategory | "">(fact.category);
  return (
    <li className="coach-card coach-fact">
      <p className="coach-fact__meta">
        <Plate tone={fact.category === "injury" ? "warn" : "neutral"}>
          {t(`cat.${fact.category}` as CoachKey)}
        </Plate>
        <span className="muted">{t(`mem.from.${fact.source}` as CoachKey)}</span>
      </p>
      {mode === "edit" ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (safe(content) && category) {
              onSave(content.trim(), category);
              setMode("view");
            }
          }}
        >
          <div className="field">
            <label htmlFor={`${id}-c`}>{t("mem.content")}</label>
            <input
              id={`${id}-c`}
              value={content}
              maxLength={280}
              onChange={(e) => setContent(e.target.value.replace(/[\r\n]/g, " "))}
              aria-invalid={!safe(content)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-k`}>{t("mem.category")}</label>
            <CategorySelect id={`${id}-k`} value={category} onChange={setCategory} />
          </div>
          <div className="row-actions">
            <button type="submit" className="btn btn--primary" disabled={!safe(content)}>
              {t("mem.save")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setMode("view")}>
              {t("mem.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <p className="coach-fact__text">{fact.content}</p>
      )}
      {mode === "delete" ? (
        <div className="note note--warn" role="alertdialog" aria-labelledby={`${id}-d`}>
          <span id={`${id}-d`}>{t("mem.confirmDelete", { text: fact.content })}</span>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn--danger"
              onClick={onDelete}
              data-tour-id="coach-memory-delete-confirm"
            >
              {t("mem.delete")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setMode("view")}>
              {t("mem.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {mode === "view" ? (
        <div className="row-actions coach-fact__actions">
          <button
            type="button"
            className="btn"
            onClick={() => setMode("edit")}
            data-tour-id="coach-memory-edit"
          >
            <Icon d={HICON.pen} size={18} />
            {t("mem.edit")}
            <span className="sr-only">: {fact.content}</span>
          </button>
          <button
            type="button"
            className="btn btn--danger-outline"
            onClick={() => setMode("delete")}
            data-tour-id="coach-memory-delete"
          >
            {t("mem.delete")}
            <span className="sr-only">: {fact.content}</span>
          </button>
        </div>
      ) : null}
    </li>
  );
}
