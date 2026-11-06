import { type ReactNode, useState } from "react";
import type { ErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import type { Post } from "./api";
import { useEngT } from "./dict";
import { Card, Empty, PageHead, Stat, act, useEng } from "./shared";

/** Staff "Comunidad": moderation queue (pending) and published posts (take-down). Location-scoped by the API. */
export function StaffCommunityScreen() {
  const { t } = useEngT();
  const eng = useEng();
  const pending = useAsync(() => eng.posts("pending"), [eng]);
  const approved = useAsync(() => eng.posts("approved"), [eng]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);

  const decide = (p: Post, decision: "approve" | "reject") =>
    act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
      await eng.moderate(p.id, decision);
      pending.reload();
      approved.reload();
      return t("community.done");
    });

  return (
    <div className="page eng-page">
      <PageHead title={t("community.title")} lede={t("community.lede")} />
      {pending.data && approved.data ? (
        <div className="ds-stats">
          <Stat
            icon={{ name: "bell" }}
            label={t("community.queue")}
            value={pending.data.data.length}
          />
          <Stat
            icon={{ name: "chat" }}
            label={t("community.published")}
            value={approved.data.data.length}
          />
        </div>
      ) : null}
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
      <Card title={t("community.queue")} icon={{ name: "bell" }}>
        {pending.loading && !pending.data ? <Loading /> : null}
        {pending.error ? <ErrorNote code={pending.error} onRetry={pending.reload} /> : null}
        {pending.data && pending.data.data.length === 0 ? (
          <Empty icon={{ name: "checkCircle" }} text={t("community.queueEmpty")} />
        ) : null}
        <PostList
          posts={pending.data?.data ?? []}
          actions={(p) => (
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                data-tour-id="eng-post-approve"
                onClick={() => decide(p, "approve")}
              >
                <Icon name="check" size={18} />
                {t("community.approve")}
                <span className="sr-only">: {p.author_label}</span>
              </button>
              <button
                type="button"
                className="btn btn--danger-outline"
                disabled={busy}
                data-tour-id="eng-post-reject"
                onClick={() => decide(p, "reject")}
              >
                {t("community.reject")}
                <span className="sr-only">: {p.author_label}</span>
              </button>
            </div>
          )}
        />
      </Card>
      <Card title={t("community.published")} icon={{ name: "chat" }}>
        {approved.error ? <ErrorNote code={approved.error} onRetry={approved.reload} /> : null}
        <PostList
          posts={approved.data?.data ?? []}
          actions={(p) => (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => decide(p, "reject")}
            >
              {t("community.takeDown")}
              <span className="sr-only">: {p.author_label}</span>
            </button>
          )}
        />
      </Card>
    </div>
  );
}

export function PostList({ posts, actions }: { posts: Post[]; actions?: (p: Post) => ReactNode }) {
  const { lang } = useEngT();
  return (
    <ul className="eng-posts">
      {posts.map((p) => (
        <li key={p.id} className="eng-post">
          <span className="eng-post__avatar" aria-hidden="true">
            {initials(p.author_label)}
          </span>
          <div className="eng-post__main">
            <p className="eng-post__meta">
              <strong>{p.author_label}</strong> ·{" "}
              <span className="muted">{formatDateTime(p.created_at, lang)}</span>
            </p>
            <p className="eng-post__body">{p.body}</p>
            {actions ? actions(p) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
