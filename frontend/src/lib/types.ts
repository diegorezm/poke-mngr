export type ConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "AUTHENTICATING"
  | "ONLINE"
  | "PAUSED_COOLDOWN"
  | "BLOCKED";

export type CardStyle = "padrao" | "medalhao" | "versus" | "corrida";

export interface ProxyConfig {
  scheme: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface RestockRule {
  enabled: boolean;
  id: number;
  below: number;
  keep: number;
}

export interface RestockConfig {
  enabled: boolean;
  goldFloor: number;
  potionFirst: boolean;
  potion: RestockRule;
  ball: RestockRule;
  revive: RestockRule;
}

export interface AccountOptions {
  huntSlug: string;
  autoCatch: boolean;
  ballPriority: number[];
  autoPotion: boolean;
  potionId: number | null;
  potionRestockThreshold: number;
  potionRestockQty: number;
  autoBallRestock: boolean;
  ballId: number | null;
  ballRestockThreshold: number;
  ballRestockQty: number;
  pvpAuto: boolean;
  directMode: boolean;
  restock: RestockConfig;
}

export interface AccountRecord {
  id: number;
  uuid: string;
  nick: string;
  token?: string;
  tokenHint?: string;
  deviceId: string;
  enabled: boolean;
  orderIndex: number;
  proxy?: ProxyConfig | null;
  options: AccountOptions;
  tokenStatus: string;
  tokenDetail: string;
  createdAt: number;
}

export interface PokemonSummary {
  id: number;
  name: string;
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  xp: number;
  xpNext: number;
  shiny: boolean;
  looktype: number;
  heldItemId: number;
}

export interface EquippedItem {
  id: number;
  name: string;
  stock: number;
}

export interface HuntTelemetry {
  slug: string;
  name: string;
  pendingSlug?: string;
  combatLockMs: number;
  outlandTier: number;
  isOutland: boolean;
  elapsedSec: number;
  kills: number;
  killsPerHour: number;
  xpPerHour: number;
  goldPerHour: number;
  xpGained: number;
  goldGained: number;
}

export interface SessionTelemetry {
  startedAt: number;
  gained: Record<string, number>;
  shiniesSeen: number;
  shiniesCaught: number;
  showShinies: boolean;
}

export interface AccountTelemetry {
  id: number;
  uuid: string;
  nick: string;
  enabled: boolean;
  orderIndex: number;
  state: ConnectionState;
  block?: { kind: string; detail: string } | null;
  lastReason?: string;
  cooldownUntil?: number;
  exitIp: string;
  proxyLabel?: string;
  bridgeAttached: boolean;
  directMode: boolean;
  level: number;
  xp: number;
  xpLevel: number;
  xpNext: number;
  gold: number;
  orbs: number;
  diamonds: number;
  activePokemon?: PokemonSummary | null;
  equippedPotion?: EquippedItem | null;
  equippedBall?: EquippedItem | null;
  hunt: HuntTelemetry;
  ballsCaught: number;
  ballsFailed: number;
  pokemonCount: number;
  pokedexCount: number;
  session: SessionTelemetry;
  pass: { canClaim: boolean; raw?: Record<string, unknown> };
  pvpAuto: boolean;
  serverOffsetMs: number;
  updatedAt: number;
}

export interface MemoryStats {
  totalBytes: number;
  appBytes: number;
  webViewBytes: number;
  processCount: number;
}

export interface TelemetrySnapshot {
  serverTimeMs: number;
  bridgePort: number;
  memory?: MemoryStats | null;
  accounts: AccountTelemetry[];
}

export interface GlobalSettings {
  wsUrl: string;
  discordWebhookUrl: string;
  dailyReportHour: number;
  reportTz: string;
  externalLoginWaitMin: number;
  downAlertDelaySec: number;
  minimizeToTrayOnClose: boolean;
  startMinimized: boolean;
  cardStyle: CardStyle;
  language: string;
  sniperEnabled: boolean;
  marketSellAlert: boolean;
  marketSellAlertPct: number;
  deckLayout: string;
  deckZoom: number;
  deckUltra: boolean;
  deckReduceMotion: boolean;
  deckHuntExt: boolean;
}

export interface ProbeResult {
  ok: boolean;
  kind: string;
  detail: string;
  nick?: string;
  level?: number;
  hunts?: string[];
}

export interface OutlandTier {
  tier: number;
  rotulo: string;
  nivel: number;
  mult: number;
}

export interface HuntSpeciesInfo {
  pokeId: number;
  nome: string;
  looktype: number;
  tipos: string[];
  pontos: number;
  nivelMin: number;
  nivelMax: number;
}

export interface HuntInfo {
  slug: string;
  nome: string;
  regiao: string;
  area: string;
  nivelMin: number;
  nivelMax: number;
  nivelNecessario: number;
  tipos: string[];
  especies: HuntSpeciesInfo[];
  drops: string[];
  mainLook: number;
  isOutland: boolean;
}

export interface ActivePokemonSheet {
  id: number;
  speciesId: number;
  nome: string;
  looktype: number;
  level: number;
  shiny: boolean;
  quality: number;
  potencia: number;
  stats: Record<string, number>;
  ivs: Record<string, number>;
  tmAoe: boolean;
  trainerLevel: number;
}

export interface HuntsCatalog {
  accountId: number;
  accountLevel: number;
  activeSlug: string;
  pendingSlug: string;
  combatLockMs: number;
  outlandTier: number;
  outlandTiers: OutlandTier[];
  hunts: HuntInfo[];
}

export interface InventoryItemEntry {
  id: number;
  kind: string;
  nome: string;
  icon: string;
  total: number;
  accounts: { accountId: number; nick: string; qty: number }[];
}

export interface InventorySummary {
  totalGold: number;
  totalOrbs: number;
  totalDiamonds: number;
  totalPokemons: number;
  totalShinies: number;
  items: InventoryItemEntry[];
}

export interface EvoStep {
  pokeId: number;
  nome: string;
  looktype: number;
  level: number;
}

export interface EvolutionProjection {
  pokeId: number;
  nome: string;
  looktype: number;
  nota: number;
  faixa: string;
  mercadoOk: boolean;
  pvpPower: number;
  alcance: number;
}

export interface PokemonDetail {
  id: number;
  accountId: number;
  accountNick: string;
  owner?: string;
  pokeId: number;
  nome: string;
  apelido: string;
  especie: string;
  level: number;
  hp: number;
  maxHp: number;
  combatHp: number;
  xp: number;
  xpProximo: number;
  shiny: boolean;
  looktype: number;
  noTime: boolean;
  ativo: boolean;
  trancado: boolean;
  qualidade: number;
  potencia: number;
  heldItemId: number;
  ivs: Record<string, number>;
  ivSoma: number;
  ivPct: number;
  stats: Record<string, number>;
  baseStats?: Record<string, number>;
  refino?: Record<string, number>;
  tmElemental?: string;
  tmAoe?: boolean;
  tipos: string[];
  nota: number;
  faixa: string;
  mercadoOk: boolean;
  eixos: Record<string, number>;
  pvpPower: number;
  pvpLevel: number;
  pvePower: number;
  alcance: number;
  evoPrev?: EvoStep | null;
  evoNext?: EvoStep[];
  evolucoes?: EvolutionProjection[];
}

export interface ListingDetail {
  id: number;
  kind: "item" | "pokemon" | string;
  nome: string;
  qtd: number;
  preco: number;
  moeda: "gold" | "orb";
  vendedor: string;
  estado: string;
  compravelEm?: number;
  itemId?: number;
  itemIcon?: string;
  pokemon?: PokemonDetail | null;
}

export interface ValuationItem {
  key: string;
  kind: "rare" | "item" | "shiny" | string;
  nome: string;
  icon?: string;
  looktype?: number;
  qty: number;
  unitGems: number;
  totalGems: number;
  totalUsd: number;
}

export interface InventoryValuation {
  usdPerGem: number;
  orbsBalance: number;
  rareItemsGems: number;
  otherItemsGems: number;
  shiniesGems: number;
  totalGems: number;
  totalUsd: number;
  pricedShinies: number;
  totalShinies: number;
  pendingShinies: number;
  topEntries: ValuationItem[];
}

export interface ChatMessage {
  id: string | number;
  ts: number;
  canal: string;
  de: string;
  nivel: number;
  cargo?: string;
  guild?: string;
  guildColor?: string;
  kind: "msg" | "shiny" | "rare" | "share" | "ad";
  text: string;
  ad?: { id: number; qtd: number; nome: string; preco: string; moeda: string };
  pk?: { nick: string; id: number; label: string };
}

export interface ChatEvent {
  type: "chat" | "history" | "del" | "notice";
  canal?: string;
  msg?: ChatMessage;
  msgs?: ChatMessage[];
  delId?: string;
  notice?: string;
  account?: number;
}

export interface MarketRuleSpec {
  target: "item" | "pokemon";
  itemId?: number;
  itemName?: string;
  query?: string;
  elemento?: string;
  moeda: "gold" | "orb";
  maxPrice: number;
  maxPctBelow?: number;
  onlyShiny?: boolean;
  onlyP5?: boolean;
  onlyZMove?: boolean;
  onlyTmAoe?: boolean;
  minIv?: number;
  minLevel?: number;
  dailyBudget?: number;
  accountIds?: number[];
}

export interface MarketRule {
  id: number;
  kind: "alert" | "snipe";
  enabled: boolean;
  spec: MarketRuleSpec;
  spent: number;
  spentDay: string;
  lastFire: number;
  createdAt: number;
}

export interface MarketLogEntry {
  id: number;
  ts: number;
  accountId: number;
  ruleId: number;
  status: string;
  text: string;
}

export interface PvpMatchEntry {
  id: string | number;
  won: boolean;
  delta: number;
  opponent: string;
  points: number;
  at: number;
}

export interface PvpAccountView {
  accountId: number;
  nick: string;
  level: number;
  online: boolean;
  auto: boolean;
  nativeAuto: boolean;
  inQueue: boolean;
  queueSize: number;
  waitSec: number;
  position: number;
  finalPosition: number;
  finalCut: number;
  totalRanked: number;
  rank?: Record<string, unknown>;
  team: number[];
  houses: Record<string, number>;
  wins: number;
  losses: number;
  delta: number;
  refusal?: string;
  matches: PvpMatchEntry[];
}

export interface LivesAccountConfig {
  enabled: boolean;
  autoRedeem: boolean;
  reward: "xp" | "capture" | "lure";
  claimChest: boolean;
  twitchSlot1: string;
  twitchSlot2: string;
  kickSlot1: string;
  kickSlot2: string;
  extraTwitch: string[];
  extraKick: string[];
}

export interface LivesCentralState {
  officialFresh: boolean;
  channels: {
    site: "twitch" | "kick";
    channel: string;
    name: string;
    official: boolean;
    live: boolean;
    viewers: number;
  }[];
  accounts: {
    accountId: number;
    nick: string;
    config: LivesAccountConfig;
    slots: {
      site: "twitch" | "kick";
      slot: number;
      channel: string;
      standIn: boolean;
      playing: boolean;
    }[];
  }[];
  logs: {
    id: number;
    ts: number;
    accountId: number;
    site: string;
    channel: string;
    kind: string;
    message: string;
  }[];
}

export const POTION_OPTIONS = [
  { id: 70070, name: "Golden Potion", icon: "https://pokeidle.io/img/itens/golden-potion.png" },
  { id: 204, name: "Ultimate Potion", icon: "https://pokeidle.io/assets/site/assets/markitems/ultimate_potion.png" },
  { id: 203, name: "Hyper Potion", icon: "https://pokeidle.io/assets/site/assets/markitems/hyper_potion.png" },
  { id: 202, name: "Ultra Potion", icon: "https://pokeidle.io/assets/site/assets/markitems/ultra_potion.png" },
  { id: 201, name: "Great Potion", icon: "https://pokeidle.io/assets/site/assets/markitems/great_potion.png" },
  { id: 200, name: "Small Potion", icon: "https://pokeidle.io/assets/site/assets/markitems/small_potion.png" },
];

export const BALL_OPTIONS = [
  { id: 5, name: "Beast Ball", icon: "https://pokeidle.io/img/ball-beast.png" },
  { id: 4, name: "Ultra Ball", icon: "https://pokeidle.io/assets/site/assets/ui/ball-ultra.png" },
  { id: 3, name: "Super Ball", icon: "https://pokeidle.io/img/ball-super.png" },
  { id: 2, name: "Great Ball", icon: "https://pokeidle.io/assets/site/assets/ui/ball-great.png" },
  { id: 1, name: "Poké Ball", icon: "https://pokeidle.io/assets/site/assets/ui/ball-poke.png" },
];

export const REVIVE_ICON = "https://pokeidle.io/assets/site/assets/markitems/revive.png";

export function potionIcon(id?: number): string {
  return POTION_OPTIONS.find((p) => p.id === id)?.icon || POTION_OPTIONS[0].icon;
}

export function ballIcon(id?: number): string {
  return BALL_OPTIONS.find((b) => b.id === id)?.icon || BALL_OPTIONS[0].icon;
}

export function fmtCompact(n: number | undefined | null): string {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "0";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toLocaleString("pt-BR");
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${rem}s`;
  return `${rem}s`;
}

export function fmtBytes(bytes: number | undefined | null): string {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return "0 MB";
  const mb = b / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

export interface HuntExtStatus {
  enabled: boolean;
  installed: boolean;
  version: string;
  error?: string;
}

export interface UpdateState {
  enabled: boolean;
  repo: string;
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  url: string;
  installerName?: string;
  checkedAt: number;
  error?: string;
  canApply: boolean;
  cannotApplyReason?: string;
  step?: string;
  doneMessage?: string;
}

export interface UpdateApplyResult {
  ok: boolean;
  restarting: boolean;
  message: string;
}

export function defaultAccountOptions(): AccountOptions {
  return {
    huntSlug: "",
    autoCatch: true,
    ballPriority: [1, 2, 3, 4],
    autoPotion: true,
    potionId: null,
    potionRestockThreshold: 10,
    potionRestockQty: 100,
    autoBallRestock: true,
    ballId: null,
    ballRestockThreshold: 10,
    ballRestockQty: 100,
    pvpAuto: false,
    directMode: false,
    restock: {
      enabled: true,
      goldFloor: 0,
      potionFirst: false,
      potion: { enabled: true, id: 0, below: 10, keep: 110 },
      ball: { enabled: true, id: 0, below: 10, keep: 110 },
      revive: { enabled: false, id: 0, below: 50, keep: 200 },
    },
  };
}
