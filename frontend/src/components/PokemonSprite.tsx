import { useEffect, useState } from "react";

const SITE = "https://pokeidle.io";

interface AtlasData {
  cell?: number;
  version?: string | number;
  cols: number;
  rows: number;
  image?: string;
  slots?: Record<string, [number, number] | { col: number; row: number }>;
  entries?: Record<string, [number, number] | { col: number; row: number }>;
  markers?: Record<string, [number, number] | { col: number; row: number }>;
}

interface OutfitSprite {
  image: string;
  pageW: number;
  pageH: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SpriteBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

let cachedAtlasPort = 0;
let cachedAtlasPromise: Promise<AtlasData | null> | null = null;
const outfitCache = new Map<number, Promise<OutfitSprite | null>>();
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
const boundsCache = new Map<string, SpriteBounds>();
let scratchCanvas: HTMLCanvasElement | null = null;

function toBridgeImageURL(rawUrl: string, bridgePort: number): string {
  if (!bridgePort) {
    if (rawUrl.startsWith("http")) return rawUrl;
    return `${SITE}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
  }
  if (rawUrl.startsWith(SITE)) {
    return `http://127.0.0.1:${bridgePort}${rawUrl.slice(SITE.length)}`;
  }
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    return rawUrl;
  }
  return `http://127.0.0.1:${bridgePort}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
}

function resolveAtlasURL(atlas: AtlasData, bridgePort: number): string {
  const path = atlas.image
    ? atlas.image
    : `/assets/site/assets/maps/marker-atlas.webp${atlas.version ? `?v=${atlas.version}` : ""}`;
  return toBridgeImageURL(path, bridgePort);
}

function loadCorsImage(url: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

function scanOpaqueBounds(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): SpriteBounds {
  const fallback: SpriteBounds = { x: 0, y: 0, w: sw, h: sh };
  if (sw <= 0 || sh <= 0) return fallback;
  try {
    if (!scratchCanvas) {
      scratchCanvas = document.createElement("canvas");
    }
    if (scratchCanvas.width !== sw) scratchCanvas.width = sw;
    if (scratchCanvas.height !== sh) scratchCanvas.height = sh;
    const ctx = scratchCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    let minX = sw;
    let minY = sh;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < sh; y++) {
      const rowOff = y * sw * 4;
      for (let x = 0; x < sw; x++) {
        if (data[rowOff + x * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return fallback;
    return {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    };
  } catch {
    return fallback;
  }
}

function measureRegionBounds(
  cacheKey: string,
  url: string,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): Promise<SpriteBounds> {
  const existing = boundsCache.get(cacheKey);
  if (existing) return Promise.resolve(existing);
  return loadCorsImage(url).then((img) => {
    const measured = img ? scanOpaqueBounds(img, sx, sy, sw, sh) : { x: 0, y: 0, w: sw, h: sh };
    boundsCache.set(cacheKey, measured);
    return measured;
  });
}

function computeFittedScale(size: number, bw: number, bh: number): number {
  const maxDim = Math.max(bw, bh, 1);
  const target = size * 0.86;
  const maxScale = Math.max(2.6, size / 22);
  return Math.min(target / maxDim, maxScale);
}

function loadAtlas(bridgePort: number): Promise<AtlasData | null> {
  if (!bridgePort) return Promise.resolve(null);
  if (cachedAtlasPromise && cachedAtlasPort === bridgePort) return cachedAtlasPromise;
  cachedAtlasPort = bridgePort;
  cachedAtlasPromise = fetch(`http://127.0.0.1:${bridgePort}/api/sprite-atlas`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return cachedAtlasPromise;
}

function loadOutfit(bridgePort: number, looktype: number): Promise<OutfitSprite | null> {
  if (!bridgePort || !looktype) return Promise.resolve(null);
  const existing = outfitCache.get(looktype);
  if (existing) return existing;
  const p = fetch(`http://127.0.0.1:${bridgePort}/api/sprite/${looktype}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  outfitCache.set(looktype, p);
  return p;
}

export function PokemonSprite({
  looktype,
  bridgePort,
  size = 48,
  shiny = false,
  className = "",
}: {
  looktype?: number;
  bridgePort: number;
  size?: number;
  shiny?: boolean;
  className?: string;
}) {
  const [atlas, setAtlas] = useState<AtlasData | null>(null);
  const [outfit, setOutfit] = useState<OutfitSprite | null>(null);
  const [measuredKey, setMeasuredKey] = useState<string>("");
  const [measuredBounds, setMeasuredBounds] = useState<SpriteBounds | null>(null);

  useEffect(() => {
    setOutfit(null);
    if (!looktype || !bridgePort) return;
    let alive = true;
    loadAtlas(bridgePort).then((a) => {
      if (!alive) return;
      setAtlas(a);
      const map = a?.slots || a?.entries || a?.markers || {};
      if (!map[String(looktype)]) {
        loadOutfit(bridgePort, looktype).then((o) => {
          if (alive) setOutfit(o);
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [looktype, bridgePort]);

  const map = atlas?.slots || atlas?.entries || atlas?.markers || {};
  const entry = looktype ? map[String(looktype)] : undefined;
  const cell = atlas?.cell && atlas.cell > 0 ? atlas.cell : 64;

  let activeKey = "";
  let activeImgUrl = "";
  let activeSx = 0;
  let activeSy = 0;
  let activeSw = 0;
  let activeSh = 0;

  if (atlas && entry) {
    const col = Array.isArray(entry) ? entry[0] : entry.col;
    const row = Array.isArray(entry) ? entry[1] : entry.row;
    activeImgUrl = resolveAtlasURL(atlas, bridgePort);
    activeSx = col * cell;
    activeSy = row * cell;
    activeSw = cell;
    activeSh = cell;
    activeKey = `atlas:${atlas.version || "v"}:${col}:${row}:${cell}`;
  } else if (outfit && outfit.w > 0 && outfit.h > 0) {
    activeImgUrl = toBridgeImageURL(outfit.image, bridgePort);
    activeSx = outfit.x;
    activeSy = outfit.y;
    activeSw = outfit.w;
    activeSh = outfit.h;
    activeKey = `outfit:${outfit.image}:${outfit.x}:${outfit.y}:${outfit.w}:${outfit.h}`;
  }

  const cachedBounds = activeKey ? boundsCache.get(activeKey) : undefined;
  const resolvedBounds =
    cachedBounds || (measuredKey === activeKey ? measuredBounds : null);

  useEffect(() => {
    if (!activeKey || !activeImgUrl || activeSw <= 0 || activeSh <= 0) return;
    if (boundsCache.has(activeKey)) return;
    let alive = true;
    measureRegionBounds(activeKey, activeImgUrl, activeSx, activeSy, activeSw, activeSh).then(
      (b) => {
        if (!alive) return;
        setMeasuredKey(activeKey);
        setMeasuredBounds(b);
      }
    );
    return () => {
      alive = false;
    };
  }, [activeKey, activeImgUrl, activeSx, activeSy, activeSw, activeSh]);

  if (atlas && entry) {
    const col = Array.isArray(entry) ? entry[0] : entry.col;
    const row = Array.isArray(entry) ? entry[1] : entry.row;
    const totalW = atlas.cols * cell;
    const totalH = atlas.rows * cell;

    if (resolvedBounds) {
      const scale = computeFittedScale(size, resolvedBounds.w, resolvedBounds.h);
      const drawW = resolvedBounds.w * scale;
      const drawH = resolvedBounds.h * scale;
      return (
        <div
          className={`relative flex items-center justify-center overflow-hidden shrink-0 ${className}`}
          style={{ width: size, height: size }}
        >
          <div
            className="pixelated shrink-0"
            style={{
              width: drawW,
              height: drawH,
              backgroundImage: `url("${activeImgUrl}")`,
              backgroundSize: `${totalW * scale}px ${totalH * scale}px`,
              backgroundPosition: `${-(col * cell + resolvedBounds.x) * scale}px ${-(row * cell + resolvedBounds.y) * scale}px`,
              backgroundRepeat: "no-repeat",
            }}
          />
          {shiny && (
            <span className="absolute top-0.5 right-0.5 text-[10px] leading-none drop-shadow pointer-events-none">
              ✨
            </span>
          )}
        </div>
      );
    }

    // Brief fallback before tight bounds finish scanning (~1 frame): bottom-anchored zoom
    const zoomCell = size * 1.45;
    return (
      <div
        className={`relative flex items-end justify-center overflow-hidden shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <div
          className="pixelated shrink-0"
          style={{
            width: zoomCell,
            height: zoomCell,
            backgroundImage: `url("${activeImgUrl}")`,
            backgroundSize: `${atlas.cols * zoomCell}px ${atlas.rows * zoomCell}px`,
            backgroundPosition: `${-col * zoomCell}px ${-row * zoomCell}px`,
            backgroundRepeat: "no-repeat",
          }}
        />
        {shiny && (
          <span className="absolute top-0.5 right-0.5 text-[10px] leading-none drop-shadow pointer-events-none">
            ✨
          </span>
        )}
      </div>
    );
  }

  if (outfit && outfit.w > 0 && outfit.h > 0) {
    const bx = resolvedBounds ? resolvedBounds.x : 0;
    const by = resolvedBounds ? resolvedBounds.y : 0;
    const bw = resolvedBounds ? resolvedBounds.w : outfit.w;
    const bh = resolvedBounds ? resolvedBounds.h : outfit.h;
    const scale = resolvedBounds
      ? computeFittedScale(size, bw, bh)
      : Math.min((size * 1.3) / outfit.w, (size * 1.3) / outfit.h);
    const drawW = bw * scale;
    const drawH = bh * scale;
    return (
      <div
        className={`relative flex items-center justify-center overflow-hidden shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <div
          className="pixelated shrink-0"
          style={{
            width: drawW,
            height: drawH,
            backgroundImage: `url("${activeImgUrl}")`,
            backgroundSize: `${outfit.pageW * scale}px ${outfit.pageH * scale}px`,
            backgroundPosition: `${-(outfit.x + bx) * scale}px ${-(outfit.y + by) * scale}px`,
            backgroundRepeat: "no-repeat",
          }}
        />
        {shiny && (
          <span className="absolute top-0.5 right-0.5 text-[10px] leading-none drop-shadow pointer-events-none">
            ✨
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative flex items-center justify-center rounded-full bg-slate-800/80 border border-slate-700 shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" className="w-3/5 h-3/5 text-slate-500">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <line x1="3" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.8" />
        <line x1="15" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    </div>
  );
}

export function ItemSprite({
  icon,
  size = 24,
  alt = "",
  className = "",
}: {
  icon?: string | null;
  size?: number;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [icon]);

  if (!icon || failed) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded bg-slate-800/80 border border-slate-700/70 text-[10px] text-slate-500 shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        ?
      </span>
    );
  }

  const src = icon.startsWith("http") ? icon : `${SITE}${icon.startsWith("/") ? "" : "/assets/"}${icon}`;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`pixelated object-contain shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
