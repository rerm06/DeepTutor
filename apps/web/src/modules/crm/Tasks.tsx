import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon, type IconName } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, type Tone } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { ROUTES } from "../../lib/roles";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { CRM_ROUTES, Stat } from "./LeadsBoard";
import { type StaffOption, type Task, type TaskStatus, crmApi, isManager, taskBucket } from "./api";
import { useCrmT } from "./dict";
import { CRM_D, CountPill, CrmSection } from "./parts";
import "./crm.css";

const BUCKETS = ["overdue", "today", "upcoming", "closed"] as const;
type Bucket = (typeof BUCKETS)[number];
const statusTone = (s: TaskStatus): Tone =>
  s === "done" ? "ok" : s === "cancelled" ? "neutral" : "warn";
const dueTone: Record<Exclude<Bucket, "closed">, Tone> = {
  overdue: "blocked",
  today: "warn",
  upcoming: "neutral",
};
const BUCKET_ICON: Record<Bucket, { icon?: IconName; d?: string }> = {
  overdue: { d: CRM_D.clock },
  today: { icon: "calendar" },
  upcoming: { icon: "calendarPlus" },
  closed: { icon: "checkCircle" },
};

/** "Tareas": my tasks grouped by due state. Managers can widen to every task of their locations. */
export function TasksScreen() {
  const { t } = useCrmT();
  const { role } = useSession();
  const manager = isManager(role);
  const [mine, setMine] = useState(true);
  const mineId = useId();
  return (
    <div className="page crm">
      <div className="crm-head">
        <h1 className="page__title">{t("tasks.title")}</h1>
        <p className="lede">{t("tasks.lede")}</p>
      </div>
      {manager ? (
        <div className="toolbar">
          <div className="field field--inline crm-check">
            <input
              id={mineId}
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
              data-tour-id="crm-tasks-mine"
            />
            <label htmlFor={mineId}>{t("tasks.mine")}</label>
          </div>
        </div>
      ) : null}
      <TaskList
        filter={{ mine: manager ? mine : true }}
        grouped
        stats
        level={2}
        create={manager ? {} : undefined}
      />
    </div>
  );
}

/** Member record tab: follow-up tasks related to this member (RLS: trainers only see their own). */
export function MemberTasksTab({ memberId }: { memberId: string }) {
  const { t } = useCrmT();
  const { role } = useSession();
  return (
    <TaskList
      title={t("tasks.memberTab")}
      filter={{ memberId }}
      create={isManager(role) ? { memberId } : undefined}
      level={2}
    />
  );
}

export function TaskList({
  title,
  filter,
  grouped = false,
  stats = false,
  create,
  level = 2,
}: {
  title?: string;
  filter: { mine?: boolean; memberId?: string; leadId?: string };
  grouped?: boolean;
  /** Show the overdue / today / upcoming counts as `.ds-stats` (real counts of the loaded tasks). */
  stats?: boolean;
  /** When set, managers get a "new task" form prefilled with these targets. */
  create?: { locationId?: string; leadId?: string; memberId?: string };
  level?: 2 | 3;
}) {
  const { t } = useCrmT();
  const { api } = useSession();
  const crm = useMemo(() => crmApi(api), [api]);
  const [announce, setAnnounce] = useState<string | null>(null);
  const tasks = useAsync(
    () => crm.tasks(filter),
    [crm, filter.mine, filter.memberId, filter.leadId],
  );
  const rows = tasks.data?.data ?? [];
  const now = new Date();
  const count = (b: Bucket) => rows.filter((r) => taskBucket(r, now) === b).length;
  const body = (
    <>
      <LiveResult>{announce}</LiveResult>
      {stats && tasks.data ? (
        <div className="ds-stats">
          {(["overdue", "today", "upcoming"] as const).map((b) => (
            <Stat
              key={b}
              icon={<Icon name={BUCKET_ICON[b].icon} d={BUCKET_ICON[b].d} size={34} />}
              label={t(`tasks.${b}`)}
              value={count(b)}
            />
          ))}
        </div>
      ) : null}
      {create ? (
        <NewTaskForm
          target={create}
          onCreated={(msg) => {
            setAnnounce(msg);
            tasks.reload();
          }}
        />
      ) : null}
      {tasks.loading ? <Loading /> : null}
      {tasks.error ? <ErrorNote code={tasks.error} onRetry={tasks.reload} /> : null}
      {tasks.data && rows.length === 0 ? (
        <div className="ds-empty">
          <Icon name="checkCircle" size={36} />
          <strong>{t("tasks.empty")}</strong>
        </div>
      ) : null}
      {grouped
        ? BUCKETS.map((b) => {
            const inBucket = rows.filter((r) => taskBucket(r, now) === b);
            return inBucket.length ? (
              <CrmSection
                key={b}
                title={
                  <>
                    {t(`tasks.${b}`)}
                    <CountPill n={inBucket.length} />
                  </>
                }
                icon={BUCKET_ICON[b].icon}
                d={BUCKET_ICON[b].d}
                level={3}
                className={`crm-bucket crm-bucket--${b}`}
              >
                <Items
                  rows={inBucket}
                  now={now}
                  onChanged={(m) => {
                    setAnnounce(m);
                    tasks.reload();
                  }}
                />
              </CrmSection>
            ) : null;
          })
        : rows.length > 0 && (
            <Items
              rows={rows}
              now={now}
              onChanged={(m) => {
                setAnnounce(m);
                tasks.reload();
              }}
            />
          )}
    </>
  );
  return title ? (
    <CrmSection title={title} icon="checkCircle" level={level} className="crm">
      {body}
    </CrmSection>
  ) : (
    body
  );
}

function Items({
  rows,
  now,
  onChanged,
}: {
  rows: Task[];
  now: Date;
  onChanged: (msg: string) => void;
}) {
  return (
    <ul className="crm-tasks">
      {rows.map((task) => (
        <li key={task.id}>
          <TaskItem task={task} bucket={taskBucket(task, now)} onChanged={onChanged} />
        </li>
      ))}
    </ul>
  );
}

function TaskItem({
  task,
  bucket,
  onChanged,
}: {
  task: Task;
  bucket: Bucket;
  onChanged: (msg: string) => void;
}) {
  const { t, lang } = useCrmT();
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);

  async function set(status: TaskStatus) {
    setBusy(true);
    setError(null);
    try {
      await crmApi(api).setTaskStatus(task.id, status);
      onChanged(t("tasks.updated", { title: task.title }));
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="crm-task">
      <div className="crm-task__body">
        <p className="crm-task__title">
          <strong>{task.title}</strong>{" "}
          {bucket === "closed" ? (
            <Plate tone={statusTone(task.status)}>{t(`status.${task.status}`)}</Plate>
          ) : (
            <Plate tone={dueTone[bucket]}>{t(`due.${bucket}`)}</Plate>
          )}
        </p>
        <p className="crm-task__meta">
          <span>
            <Icon d={CRM_D.clock} size={16} />
            {t("tasks.due", { when: formatDateTime(task.due_at, lang) })}
          </span>
          {task.assignee_name ? (
            <span>
              <Icon name="users" size={16} />
              {t("tasks.assignee", { name: task.assignee_name })}
            </span>
          ) : null}
          {task.lead_id && task.lead_name ? (
            <span>
              <Link to={CRM_ROUTES.lead(task.lead_id)}>
                {t("tasks.lead", { name: task.lead_name })}
              </Link>
            </span>
          ) : null}
          {task.member_id && task.member_name ? (
            <span>
              <Link to={ROUTES.member(task.member_id)}>
                {t("tasks.member", { name: task.member_name })}
              </Link>
            </span>
          ) : null}
        </p>
      </div>
      <div className="row-actions">
        {task.status === "open" ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => set("done")}
              data-tour-id="crm-task-done"
              aria-label={`${t("tasks.done")}: ${task.title}`}
            >
              {t("tasks.done")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => set("cancelled")}
              aria-label={`${t("tasks.cancel")}: ${task.title}`}
            >
              {t("tasks.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => set("open")}
            aria-label={`${t("tasks.reopen")}: ${task.title}`}
          >
            {t("tasks.reopen")}
          </button>
        )}
      </div>
      {error ? <ErrorNote code={error} /> : null}
    </article>
  );
}

/** datetime-local value (PR time, no offset) → ISO with the fixed PR offset (AST, no DST). [VERIFICAR] other TZs. */
function prLocalToIso(v: string): string {
  return `${v}:00-04:00`;
}

function NewTaskForm({
  target,
  onCreated,
}: {
  target: { locationId?: string; leadId?: string; memberId?: string };
  onCreated: (msg: string) => void;
}) {
  const { t } = useCrmT();
  const { api } = useSession();
  const crm = useMemo(() => crmApi(api), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const members = useAsync(
    () => (target.memberId ? api.members() : Promise.resolve(null)),
    [api, target.memberId],
  );
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState(target.locationId ?? "");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const base = useId();
  const id = (s: string) => `${base}-${s}`;

  // A member task lives at the member's home location; a lead task at the lead's.
  const memberHome = members.data?.data.find((m) => m.id === target.memberId)?.home_location_id;
  const fixedLocation = target.locationId ?? memberHome;
  useEffect(() => {
    if (fixedLocation) setLocationId(fixedLocation);
    else if (!locationId && locations.data?.data[0]) setLocationId(locations.data.data[0].id);
  }, [fixedLocation, locationId, locations.data]);
  useEffect(() => {
    if (!open || !locationId) return;
    let alive = true;
    crm
      .staff(locationId, "task")
      .then((r) => {
        if (!alive) return;
        setStaff(r.data);
        setAssignee((a) => a || r.data[0]?.id || "");
      })
      .catch(() => alive && setStaff([]));
    return () => {
      alive = false;
    };
  }, [crm, locationId, open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await crm.createTask({
        location_id: locationId,
        title: title.trim(),
        due_at: prLocalToIso(due),
        assigned_staff_id: assignee,
        ...(target.leadId ? { lead_id: target.leadId } : {}),
        ...(target.memberId ? { member_id: target.memberId } : {}),
      });
      setTitle("");
      setDue("");
      onCreated(t("tasks.created"));
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="crm-newtask">
      <button
        type="button"
        className="btn btn--ghost"
        aria-expanded={open}
        aria-controls={id("form")}
        onClick={() => setOpen((v) => !v)}
        data-tour-id="crm-task-new"
      >
        <Icon name="calendarPlus" size={20} />
        {t("tasks.new")}
      </button>
      {open ? (
        <form id={id("form")} className="form crm-subform" onSubmit={submit}>
          <div className="form__grid">
            {!fixedLocation ? (
              <div className="field">
                <label htmlFor={id("loc")}>{t("tasks.form.location")}</label>
                <select
                  id={id("loc")}
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  {(locations.data?.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field field--wide">
              <label htmlFor={id("title")}>{t("tasks.form.title")}</label>
              <input
                id={id("title")}
                type="text"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={id("due")}>{t("tasks.form.due")}</label>
              <input
                id={id("due")}
                type="datetime-local"
                required
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={id("who")}>{t("tasks.form.assignee")}</label>
              <select
                id={id("who")}
                value={assignee}
                required
                onChange={(e) => setAssignee(e.target.value)}
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !title.trim() || !due || !assignee || !locationId}
              data-tour-id="crm-task-save"
            >
              {t("tasks.form.submit")}
            </button>
          </div>
          {error ? <ErrorNote code={error} /> : null}
        </form>
      ) : null}
    </div>
  );
}
