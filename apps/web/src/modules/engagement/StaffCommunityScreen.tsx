import { type ReactNode, useState } from "react";
import type { ErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Section } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import type { Post } from "./api";
import { useEngT } from "./dict";
import { act, useEng } from "./shared";

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
    <div className="page">
      <h1 className="page__title">{t("community.title")}</h1>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
      <Section title={t("community.queue")}>
        {pending.loading && !pending.data ? <Loading /> : null}
        {pending.error ? <ErrorNote code={pending.error} onRetry={pending.reload} /> : null}
        {pending.data && pending.data.data.length === 0 ? (
          <p className="muted">{t("community.queueEmpty")}</p>
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
      </Section>
      <Section title={t("community.published")}>
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
      </Section>
    </div>
  );
}

export function PostList({ posts, actions }: { posts: Post[]; actions?: (p: Post) => ReactNode }) {
  const { lang } = useEngT();
  return (
    <ul className="eng-posts">
      {posts.map((p) => (
        <li key={p.id} className="eng-post">
          <p className="eng-post__meta">
            <strong>{p.author_label}</strong> ·{" "}
            <span className="muted">{formatDateTime(p.created_at, lang)}</span>
          </p>
          <p className="eng-post__body">{p.body}</p>
          {actions ? actions(p) : null}
        </li>
      ))}
    </ul>
  );
}
