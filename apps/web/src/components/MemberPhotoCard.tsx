import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import { type Photo, photoApi, photoUrl } from "../lib/photo";
import { useModuleT } from "../modules/i18n";
import { useSession } from "../session/SessionContext";
import { PhotoCapture } from "./PhotoCapture";

const dict = {
  es: {
    saved: "Foto guardada.",
    removed: "Foto eliminada.",
    error: "No se pudo guardar la foto.",
    forbidden: "Tu rol no puede cambiar la foto de este socio.",
    loading: "Cargando foto…",
  },
  en: {
    saved: "Photo saved.",
    removed: "Photo removed.",
    error: "The photo couldn't be saved.",
    forbidden: "Your role can't change this member's photo.",
    loading: "Loading photo…",
  },
};

/** Loads, shows and saves a member photo. memberId null = the signed-in member's own photo. */
export function MemberPhotoCard({
  memberId,
  canEdit = true,
}: { memberId: string | null; canEdit?: boolean }) {
  const { t } = useModuleT(dict);
  const { api } = useSession();
  const pa = useMemo(() => photoApi((m, p, b) => api.request(m, p, b)), [api]);
  const [url, setUrl] = useState<string | null>(null);
  const [had, setHad] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    pa.get(memberId)
      .then((p) => {
        if (!alive) return;
        setUrl(photoUrl(p));
        setHad(true);
      })
      .catch(() => {
        if (alive) setUrl(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pa, memberId]);

  const change = async (p: Photo | null) => {
    setBusy(true);
    setMsg(null);
    try {
      if (p) {
        await pa.put(memberId, p);
        setUrl(p.url);
        setHad(true);
        if (memberId) forgetAvatar(memberId);
        setMsg(t("saved"));
      } else {
        await pa.remove(memberId);
        setUrl(null);
        setHad(false);
        if (memberId) forgetAvatar(memberId);
        setMsg(t("removed"));
      }
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === "forbidden" ? t("forbidden") : t("error"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <output className="muted">{t("loading")}</output>;
  if (!canEdit)
    return url ? (
      <img className="photo__img photo__img--static" src={url} alt="" width={120} height={120} />
    ) : null;
  return (
    <div className="photo-card">
      <PhotoCapture
        value={url}
        onChange={(p) => void change(p)}
        mode={memberId ? "staff" : "self"}
        busy={busy}
        consented={had}
      />
      <output className="photo-card__msg" aria-live="polite">
        {msg}
      </output>
    </div>
  );
}

// Small per-session cache so lists (check-in matches) do not refetch the same photo.
const avatarCache = new Map<string, Promise<string | null>>();
const avatarListeners = new Set<(id: string) => void>();
/** Drop the cached photo and refresh every avatar of that member on screen. */
export function forgetAvatar(memberId: string) {
  avatarCache.delete(memberId);
  for (const l of avatarListeners) l(memberId);
}

/** Round avatar: the member's photo when one exists and the caller may see it, else their initials. */
export function MemberAvatar({
  memberId,
  name,
  size = 48,
  className,
}: {
  memberId: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const { api } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const l = (id: string) => {
      if (id === memberId) setRev((n) => n + 1);
    };
    avatarListeners.add(l);
    return () => {
      avatarListeners.delete(l);
    };
  }, [memberId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rev refetches after a change
  useEffect(() => {
    let alive = true;
    let p = avatarCache.get(memberId);
    if (!p) {
      p = photoApi((m, path, b) => api.request(m, path, b))
        .get(memberId)
        .then(photoUrl)
        .catch(() => null);
      avatarCache.set(memberId, p);
    }
    void p.then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [api, memberId, rev]);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return url ? (
    <img
      className={`avatar avatar--photo${className ? ` ${className}` : ""}`}
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className={`avatar${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}
