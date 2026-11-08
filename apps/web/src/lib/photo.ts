/** Member photo helpers: square crop + JPEG compression in the browser, and the /photo API calls. */

export const PHOTO_CONSENT_VERSION = "photo-v1";
export const PHOTO_SIDE = 480;
export const PHOTO_MAX_BYTES = 140_000; // the database accepts ≤ 150 KiB; keep a margin

export interface Photo {
  mime: "image/jpeg";
  /** base64 without the data: prefix (what the API stores). */
  data: string;
  /** data: URL for <img>. */
  url: string;
  bytes: number;
}

/** Draw `source` center-cropped to a square of PHOTO_SIDE px; mirror for the selfie camera so it matches the preview. */
export function cropSquare(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  mirror: boolean,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = PHOTO_SIDE;
  c.height = PHOTO_SIDE;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no_canvas");
  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2;
  const sy = (sh - side) / 2;
  if (mirror) {
    ctx.translate(PHOTO_SIDE, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, sx, sy, side, side, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
  return c;
}

const blobOf = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob | null>((r) => c.toBlob((b) => r(b), "image/jpeg", q));

/** JPEG under PHOTO_MAX_BYTES, stepping the quality down. */
export async function compress(c: HTMLCanvasElement): Promise<Photo> {
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    const b = await blobOf(c, q);
    if (b && b.size <= PHOTO_MAX_BYTES) {
      const buf = new Uint8Array(await b.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000)
        s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const data = btoa(s);
      return { mime: "image/jpeg", data, url: `data:image/jpeg;base64,${data}`, bytes: b.size };
    }
  }
  throw new Error("photo_too_large");
}

export async function fromFile(file: File): Promise<Photo> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) throw new Error("photo_type");
  if (file.size > 15 * 1024 * 1024) throw new Error("photo_too_large");
  const bmp = await createImageBitmap(file);
  try {
    return await compress(cropSquare(bmp, bmp.width, bmp.height, false));
  } finally {
    bmp.close();
  }
}

export interface StoredPhoto {
  mime: string;
  data: string;
  updated_at: string;
}
export const photoUrl = (p: StoredPhoto) => `data:${p.mime};base64,${p.data}`;

type Req = <T>(method: string, path: string, body?: unknown) => Promise<T>;
export function photoApi(request: Req) {
  const path = (memberId: string | null) =>
    memberId ? `/members/${encodeURIComponent(memberId)}/photo` : "/me/photo";
  return {
    get: (memberId: string | null) => request<StoredPhoto>("GET", path(memberId)),
    put: (memberId: string | null, p: Photo) =>
      request<{ updated_at: string }>("PUT", path(memberId), {
        mime: p.mime,
        data: p.data,
        consent_version: PHOTO_CONSENT_VERSION,
      }),
    remove: (memberId: string | null) => request<{ removed: boolean }>("DELETE", path(memberId)),
  };
}
