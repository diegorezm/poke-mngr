import { useEffect, useState } from "react";

interface AtlasData {
  version?: string | number;
  cols: number;
  rows: number;
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

let cachedAtlasPort = 0;
let cachedAtlasPromise: Promise<AtlasData | null> | null = null;
const outfitCache = new Map<number, Promise<OutfitSprite | null>>();

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

  useEffect(() => {
    if (!looktype || !bridgePort) return;
    let alive = true;
    loadAtlas(bridgePort).then((a) => {
      if (!alive) return;
      setAtlas(a);
      const map = a?.entries || a?.markers || {};
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

  const map = atlas?.entries || atlas?.markers || {};
  const entry = looktype ? map[String(looktype)] : undefined;

  if (atlas && entry) {
    const col = Array.isArray(entry) ? entry[0] : entry.col;
    const row = Array.isArray(entry) ? entry[1] : entry.row;
    const v = atlas.version ? `?v=${atlas.version}` : "";
    return (
      <div
        className={`relative shrink-0 pixelated ${className}`}
        style={{
          width: size,
          height: size,
          backgroundImage: `url("https://pokeidle.io/assets/site/assets/maps/marker-atlas.png${v}")`,
          backgroundSize: `${atlas.cols * size}px ${atlas.rows * size}px`,
          backgroundPosition: `${-col * size}px ${-row * size}px`,
          backgroundRepeat: "no-repeat",
        }}
      >
        {shiny && (
          <span className="absolute -top-1 -right-1 text-[10px] leading-none drop-shadow">
            ✨
          </span>
        )}
      </div>
    );
  }

  if (outfit && outfit.w > 0 && outfit.h > 0) {
    const scale = Math.min(size / outfit.w, size / outfit.h);
    const drawW = outfit.w * scale;
    const drawH = outfit.h * scale;
    return (
      <div
        className={`relative flex items-center justify-center shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <div
          className="pixelated"
          style={{
            width: drawW,
            height: drawH,
            backgroundImage: `url("${outfit.image}")`,
            backgroundSize: `${outfit.pageW * scale}px ${outfit.pageH * scale}px`,
            backgroundPosition: `${-outfit.x * scale}px ${-outfit.y * scale}px`,
            backgroundRepeat: "no-repeat",
          }}
        />
        {shiny && (
          <span className="absolute -top-1 -right-1 text-[10px] leading-none drop-shadow">
            ✨
          </span>
        )}
      </div>
    );
  }

  // Crisp fallback Pokéball icon
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
