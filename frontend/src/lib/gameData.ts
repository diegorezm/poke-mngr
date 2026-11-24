export const TYPES = [
  "NORMAL", "FIRE", "WATER", "ELECTRIC", "GRASS", "ICE", "FIGHTING", "POISON", "GROUND",
  "FLYING", "PSYCHIC", "BUG", "ROCK", "GHOST", "DRAGON", "DARK", "STEEL", "FAIRY",
] as const;
export type PType = (typeof TYPES)[number];

const CHART: Record<PType, [PType[], PType[], PType[]]> = {
  NORMAL: [[], ["ROCK", "STEEL"], ["GHOST"]],
  FIRE: [["GRASS", "ICE", "BUG", "STEEL"], ["FIRE", "WATER", "ROCK", "DRAGON"], []],
  WATER: [["FIRE", "GROUND", "ROCK"], ["WATER", "GRASS", "DRAGON"], []],
  ELECTRIC: [["WATER", "FLYING"], ["ELECTRIC", "GRASS", "DRAGON"], ["GROUND"]],
  GRASS: [["WATER", "GROUND", "ROCK"], ["FIRE", "GRASS", "POISON", "FLYING", "BUG", "DRAGON", "STEEL"], []],
  ICE: [["GRASS", "GROUND", "FLYING", "DRAGON"], ["FIRE", "WATER", "ICE", "STEEL"], []],
  FIGHTING: [["NORMAL", "ICE", "ROCK", "DARK", "STEEL"], ["POISON", "FLYING", "PSYCHIC", "BUG", "FAIRY"], ["GHOST"]],
  POISON: [["GRASS", "FAIRY"], ["POISON", "GROUND", "ROCK", "GHOST"], ["STEEL"]],
  GROUND: [["FIRE", "ELECTRIC", "POISON", "ROCK", "STEEL"], ["GRASS", "BUG"], ["FLYING"]],
  FLYING: [["GRASS", "FIGHTING", "BUG"], ["ELECTRIC", "ROCK", "STEEL"], []],
  PSYCHIC: [["FIGHTING", "POISON"], ["PSYCHIC", "STEEL"], ["DARK"]],
  BUG: [["GRASS", "PSYCHIC", "DARK"], ["FIRE", "FIGHTING", "POISON", "FLYING", "GHOST", "STEEL", "FAIRY"], []],
  ROCK: [["FIRE", "ICE", "FLYING", "BUG"], ["FIGHTING", "GROUND", "STEEL"], []],
  GHOST: [["PSYCHIC", "GHOST"], ["DARK"], ["NORMAL"]],
  DRAGON: [["DRAGON"], ["STEEL"], ["FAIRY"]],
  DARK: [["PSYCHIC", "GHOST"], ["FIGHTING", "DARK", "FAIRY"], []],
  STEEL: [["ICE", "ROCK", "FAIRY"], ["FIRE", "WATER", "ELECTRIC", "STEEL"], []],
  FAIRY: [["FIGHTING", "DRAGON", "DARK"], ["FIRE", "POISON", "STEEL"], []],
};

export function effectiveness(atk: string, defTypes: string[]): number {
  const row = CHART[atk.toUpperCase() as PType];
  if (!row) return 1;
  let m = 1;
  for (const d of defTypes) {
    const u = d.toUpperCase() as PType;
    if (row[2].includes(u)) return 0;
    if (row[0].includes(u)) m *= 2;
    else if (row[1].includes(u)) m *= 0.5;
  }
  return m;
}

export function matchup(defTypes: string[]) {
  const weak: { type: PType; mult: number }[] = [];
  const resist: { type: PType; mult: number }[] = [];
  for (const t of TYPES) {
    const m = effectiveness(t, defTypes);
    if (m > 1) weak.push({ type: t, mult: m });
    else if (m < 1) resist.push({ type: t, mult: m });
  }
  return { weak, resist };
}

export const TYPE_COLOR: Record<string, string> = {
  NORMAL: "#8a8a6a", FIRE: "#e8622a", WATER: "#4a7fd6", ELECTRIC: "#d8b21a", GRASS: "#5aa83a", ICE: "#4fb4c2",
  FIGHTING: "#a8321e", POISON: "#8e3d9a", GROUND: "#b89a3e", FLYING: "#7d96dc", PSYCHIC: "#d8426a", BUG: "#8fa81c",
  ROCK: "#a08a3a", GHOST: "#5a4a8c", DRAGON: "#5a3ad0", DARK: "#4a3d36", STEEL: "#7a7a8e", FAIRY: "#d884b8",
};

export const REGION_ORDER = [
  { id: "kanto", label: "Kanto" },
  { id: "johto", label: "Johto" },
  { id: "hoenn", label: "Hoenn" },
  { id: "sinnoh", label: "Sinnoh" },
  { id: "unova", label: "Unova" },
  { id: "kalos", label: "Kalos" },
  { id: "alola", label: "Alola" },
  { id: "galar", label: "Galar" },
  { id: "paldea", label: "Paldea" },
  { id: "orre", label: "Orre" },
  { id: "outland", label: "Outland" },
];

// --- Battle Pass 30-day track (from pokeidle-manager-online) ---
export const PASSE_DIAS = 30;
const FUSO_MS = 3 * 60 * 60_000;
const DIA_MS = 24 * 60 * 60_000;

export type BoostKind = "xp" | "pokexp" | "loot" | "captura" | "shiny";
export type Prize =
  | { tipo: "coins"; qtd: number }
  | { tipo: "bola"; id: number; qtd: number }
  | { tipo: "item"; id: number; qtd: number }
  | { tipo: "boost"; boost: BoostKind; horas: number }
  | { tipo: "vip"; dias: number };
export type PassTier = "comum" | "incomum" | "rara" | "mitica" | "lendaria";
export interface PassStep {
  dia: number;
  tier: PassTier;
  bau?: boolean;
  free: Prize[];
  vip: Prize[];
}

const coins = (qtd: number): Prize => ({ tipo: "coins", qtd });
const ultra = (qtd: number): Prize => ({ tipo: "bola", id: 4, qtd });
const beast = (qtd: number): Prize => ({ tipo: "bola", id: 5, qtd });
const item = (id: number, qtd: number): Prize => ({ tipo: "item", id, qtd });
const boost = (b: BoostKind, horas: number): Prize => ({ tipo: "boost", boost: b, horas });
const vip = (dias: number): Prize => ({ tipo: "vip", dias });
const REVIVE = 205, MAX_REVIVE = 206, GOLDEN = 70070, ROPE = 70010, BOSS = 70000;

export const PASS_TRACK: PassStep[] = [
  { dia: 1, tier: "comum", free: [coins(250_000)], vip: [vip(3), coins(500_000)] },
  { dia: 2, tier: "comum", free: [ultra(30)], vip: [ultra(60), beast(10)] },
  { dia: 3, tier: "incomum", free: [boost("xp", 1)], vip: [boost("xp", 3)] },
  { dia: 4, tier: "comum", free: [item(REVIVE, 50)], vip: [item(REVIVE, 100), item(MAX_REVIVE, 10)] },
  { dia: 5, tier: "comum", free: [coins(500_000)], vip: [coins(1_000_000), boost("loot", 1)] },
  { dia: 6, tier: "incomum", free: [beast(10)], vip: [beast(25)] },
  { dia: 7, tier: "rara", bau: true, free: [coins(1_000_000), boost("loot", 1)], vip: [coins(3_000_000), boost("xp", 6), boost("pokexp", 6), boost("loot", 6)] },
  { dia: 8, tier: "comum", free: [ultra(50)], vip: [ultra(100), boost("captura", 1)] },
  { dia: 9, tier: "incomum", free: [boost("pokexp", 1)], vip: [boost("pokexp", 3)] },
  { dia: 10, tier: "incomum", free: [coins(750_000)], vip: [vip(3), coins(1_500_000)] },
  { dia: 11, tier: "incomum", free: [item(MAX_REVIVE, 10)], vip: [item(MAX_REVIVE, 30)] },
  { dia: 12, tier: "incomum", free: [beast(15)], vip: [beast(40)] },
  { dia: 13, tier: "rara", free: [boost("captura", 1)], vip: [boost("captura", 3), boost("shiny", 3)] },
  { dia: 14, tier: "rara", bau: true, free: [coins(1_500_000), boost("xp", 2)], vip: [coins(4_000_000), boost("loot", 6)] },
  { dia: 15, tier: "incomum", free: [item(GOLDEN, 10)], vip: [item(GOLDEN, 20), boost("xp", 3)] },
  { dia: 16, tier: "comum", free: [coins(1_000_000)], vip: [coins(2_000_000)] },
  { dia: 17, tier: "incomum", free: [beast(25)], vip: [beast(50)] },
  { dia: 18, tier: "rara", free: [boost("shiny", 1)], vip: [boost("shiny", 3)] },
  { dia: 19, tier: "comum", free: [ultra(100)], vip: [ultra(200), boost("loot", 2)] },
  { dia: 20, tier: "incomum", free: [coins(1_250_000)], vip: [vip(3), coins(2_500_000)] },
  { dia: 21, tier: "rara", bau: true, free: [coins(2_000_000), boost("captura", 2)], vip: [coins(5_000_000), boost("captura", 6), boost("loot", 6)] },
  { dia: 22, tier: "incomum", free: [beast(30)], vip: [beast(60)] },
  { dia: 23, tier: "rara", free: [boost("loot", 2)], vip: [boost("loot", 6)] },
  { dia: 24, tier: "incomum", free: [item(MAX_REVIVE, 20)], vip: [item(MAX_REVIVE, 40), item(ROPE, 5)] },
  { dia: 25, tier: "incomum", free: [coins(1_500_000)], vip: [coins(3_000_000), boost("pokexp", 6)] },
  { dia: 26, tier: "rara", free: [boost("pokexp", 2)], vip: [boost("xp", 6)] },
  { dia: 27, tier: "rara", free: [beast(40)], vip: [beast(80)] },
  { dia: 28, tier: "mitica", bau: true, free: [coins(3_000_000), boost("shiny", 2)], vip: [coins(7_000_000), boost("shiny", 6), boost("captura", 6)] },
  { dia: 29, tier: "rara", free: [item(ROPE, 3), boost("xp", 3)], vip: [vip(3), boost("captura", 6), boost("shiny", 6)] },
  { dia: 30, tier: "lendaria", bau: true, free: [item(BOSS, 1), coins(5_000_000), beast(50)], vip: [boost("shiny", 12), coins(10_000_000), beast(100), boost("captura", 12), vip(7)] },
];

const SITE = "https://pokeidle.io";
const BOOST_ICON: Record<BoostKind, string> = {
  xp: "/assets/site/assets/loja/exp.png",
  pokexp: "/assets/site/assets/loja/boost.png",
  loot: "/assets/site/assets/loja/loot.png",
  captura: "/assets/site/assets/loja/catch.png",
  shiny: "/assets/site/assets/loja/shinysecretlure.png",
};
const BOOST_NAME: Record<BoostKind, string> = {
  xp: "XP", pokexp: "XP Pokémon", loot: "Loot", captura: "Captura", shiny: "Shiny",
};
const BALL_META: Record<number, { name: string; icon: string }> = {
  4: { name: "Ultra Ball", icon: "/assets/site/assets/ui/ball-ultra.png" },
  5: { name: "Beast Ball", icon: "/img/ball-beast.png" },
};
const ITEM_META: Record<number, { name: string; icon: string }> = {
  [REVIVE]: { name: "Revive", icon: "/assets/site/assets/markitems/revive.png" },
  [MAX_REVIVE]: { name: "Max Revive", icon: "/assets/site/assets/markitems/max_revive.png" },
  [GOLDEN]: { name: "Golden Potion", icon: "/img/itens/golden-potion.png" },
  [ROPE]: { name: "Escape Rope", icon: "/img/itens/escape-rope.png" },
  [BOSS]: { name: "Bronze Boss Token", icon: "/assets/site/assets/items/bronze_boss_token.png" },
};

const nf = new Intl.NumberFormat("pt-BR");
function shortQty(n: number): string {
  if (n >= 1_000_000) return `${nf.format(n / 1_000_000)}M`;
  if (n >= 1000) return `${nf.format(n / 1000)}k`;
  return nf.format(n);
}

export function prizeView(p: Prize): { icon: string; short: string; name: string } {
  switch (p.tipo) {
    case "coins":
      return { icon: `${SITE}/assets/site/assets/ui/moeda-ouro.png`, short: shortQty(p.qtd), name: `${nf.format(p.qtd)} Gold` };
    case "bola": {
      const b = BALL_META[p.id];
      return { icon: SITE + (b?.icon ?? ""), short: `×${p.qtd}`, name: `${p.qtd}× ${b?.name ?? `Bola #${p.id}`}` };
    }
    case "item": {
      const i = ITEM_META[p.id];
      return { icon: SITE + (i?.icon ?? ""), short: `×${p.qtd}`, name: `${p.qtd}× ${i?.name ?? `Item #${p.id}`}` };
    }
    case "boost":
      return { icon: SITE + BOOST_ICON[p.boost], short: `${p.horas}h`, name: `Boost ${BOOST_NAME[p.boost]} (${p.horas}h)` };
    case "vip":
      return { icon: `${SITE}/assets/site/assets/loja/vip.png`, short: `${p.dias}d`, name: `${p.dias}d VIP` };
  }
}

export function passDayOf(ms: number) {
  return Math.floor((ms - FUSO_MS) / DIA_MS);
}
export function passDayStart(day: number) {
  return day * DIA_MS + FUSO_MS;
}

export function computePassState(raw: Record<string, unknown> | undefined | null, now: number) {
  const o = raw || {};
  const ultimo = typeof o.ultimo === "number" ? o.ultimo : null;
  const d0 = typeof o.degrau === "number" ? o.degrau : 0;
  const degrauSaved = d0 >= 0 && d0 <= PASSE_DIAS ? d0 : 0;
  const vipAte = Math.max(0, Number(o.vipAte) || 0);
  const ultimoVip = typeof o.ultimoVip === "number" ? o.ultimoVip : null;
  const hoje = passDayOf(now);
  let degrau = 1, jaPegouHoje = false, quebrou = false;
  if (ultimo == null || degrauSaved < 1) degrau = 1;
  else if (ultimo === hoje) { degrau = degrauSaved; jaPegouHoje = true; }
  else if (ultimo === hoje - 1) degrau = degrauSaved >= PASSE_DIAS ? 1 : degrauSaved + 1;
  else { degrau = 1; quebrou = true; }
  const vipAtivo = vipAte > now;
  const vipPegosRaw = typeof o.vipPegos === "number" ? o.vipPegos : 0;
  const vipPegos = degrau === 1 && !jaPegouHoje ? 0 : Math.max(0, vipPegosRaw);
  return {
    degrau,
    jaPegouHoje,
    quebrou,
    vipPendenteHoje: vipAtivo && jaPegouHoje && ultimoVip !== hoje,
    vipAtivo,
    vipAte,
    vipPegos,
    ciclos: Math.max(0, Number(o.ciclos) || 0),
    total: Math.max(0, Number(o.total) || 0),
    viradaEm: passDayStart(hoje + 1),
    feitos: jaPegouHoje ? degrau : degrau - 1,
  };
}
