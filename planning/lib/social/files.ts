// Preparar archivos antes de subirlos: fotos a JPG (Instagram por API solo acepta JPG), medidas y duración.
// Solo navegador.

export interface Prepared {
  file: Blob;
  name: string;
  kind: "image" | "video" | "document";
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
}

const MAX_SIDE = 2160;

export const kindOf = (f: File): Prepared["kind"] | null =>
  f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type === "application/pdf" ? "document" : null;

async function toJpeg(f: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(f);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  // Si ya es un JPG de tamaño razonable, va tal cual
  if (/jpe?g/.test(f.type) && scale === 1) return { blob: f, width: w, height: h };
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // las transparencias del PNG quedan en blanco
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("No se pudo convertir la imagen"))), "image/jpeg", 0.92));
  return { blob, width: w, height: h };
}

function videoMeta(f: File): Promise<{ width: number | null; height: number | null; duration: number | null }> {
  return new Promise((ok) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(f);
    const done = (r: { width: number | null; height: number | null; duration: number | null }) => {
      URL.revokeObjectURL(url);
      ok(r);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () => done({ width: v.videoWidth || null, height: v.videoHeight || null, duration: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null });
    v.onerror = () => done({ width: null, height: null, duration: null });
    v.src = url;
  });
}

export async function prepare(f: File): Promise<Prepared> {
  const kind = kindOf(f);
  if (!kind) throw new Error(`«${f.name}» no es una foto, un video ni un PDF.`);
  const base = f.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 60) || "archivo";
  if (kind === "image") {
    const j = await toJpeg(f);
    return { file: j.blob, name: `${base}.jpg`, kind, mime: "image/jpeg", width: j.width, height: j.height, duration: null };
  }
  if (kind === "video") {
    const m = await videoMeta(f);
    const ext = f.name.split(".").pop()?.toLowerCase() || "mp4";
    return { file: f, name: `${base}.${ext}`, kind, mime: f.type || "video/mp4", ...m };
  }
  return { file: f, name: `${base}.pdf`, kind, mime: "application/pdf", width: null, height: null, duration: null };
}

/** Avisos de medidas para cada red (no bloquean: Instagram recorta o rechaza) */
export function sizeHints(m: { kind: string; width: number | null; height: number | null; duration: number | null }, format: string): string[] {
  const out: string[] = [];
  if (m.width && m.height) {
    const r = m.width / m.height;
    if (format === "historia" || format === "reel" || format === "video") {
      if (Math.abs(r - 9 / 16) > 0.05) out.push("Para reels, stories y TikTok conviene vertical 9:16 (1080×1920).");
    } else if (r < 0.79 || r > 1.92) out.push("Instagram acepta entre 4:5 (vertical) y 1.91:1 (horizontal).");
  }
  if (m.kind === "video" && m.duration && m.duration > 900) out.push("Instagram admite reels de hasta 15 minutos.");
  return out;
}
