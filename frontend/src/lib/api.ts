import { Call, Events } from "@wailsio/runtime";
import type {
  AccountRecord,
  AccountOptions,
  ActivePokemonSheet,
  ChatEvent,
  ChatMessage,
  GlobalSettings,
  HuntsCatalog,
  InventorySummary,
  LivesAccountConfig,
  LivesCentralState,
  MarketLogEntry,
  MarketRule,
  PokemonDetail,
  ProbeResult,
  ProxyConfig,
  PvpAccountView,
  TelemetrySnapshot,
} from "./types";

const SVC = "poke-mngr/internal/service.AppService";

function invoke<T = void>(method: string, ...args: unknown[]): Promise<T> {
  return Call.ByName(`${SVC}.${method}`, ...args) as Promise<T>;
}

export const api = {
  getSnapshot: () => invoke<TelemetrySnapshot>("GetSnapshot"),
  listAccounts: () => invoke<AccountRecord[]>("ListAccounts"),
  parseImportText: (raw: string) =>
    invoke<{ nick: string; token: string; deviceId: string }>("ParseImportText", raw),
  addAccount: (req: {
    nick: string;
    token: string;
    deviceId: string;
    enabled: boolean;
    proxy?: ProxyConfig | null;
    options: AccountOptions;
    skipTest: boolean;
  }) => invoke<{ account: AccountRecord; probe?: ProbeResult }>("AddAccount", req),
  updateAccount: (acc: AccountRecord) => invoke<AccountRecord>("UpdateAccount", acc),
  deleteAccount: (id: number) => invoke<void>("DeleteAccount", id),
  restartAccount: (id: number) => invoke<void>("RestartAccount", id),
  reorderAccounts: (ids: number[]) => invoke<void>("ReorderAccounts", ids),
  testProxy: (proxy: ProxyConfig) => invoke<string>("TestProxy", proxy),
  testAccount: (id: number) => invoke<ProbeResult>("TestAccount", id),
  getSettings: () => invoke<GlobalSettings>("GetSettings"),
  updateSettings: (gs: GlobalSettings) => invoke<void>("UpdateSettings", gs),
  getAutostart: () => invoke<boolean>("GetAutostart"),
  setAutostart: (enabled: boolean) => invoke<void>("SetAutostart", enabled),
  testDiscordWebhook: (url: string) => invoke<void>("TestDiscordWebhook", url),
  sendDailyReportNow: (url: string) => invoke<void>("SendDailyReportNow", url),
  getBookmarkletCode: () => invoke<string>("GetBookmarkletCode"),
  equipItem: (accountId: number, kind: "ball" | "potion", itemId: number) =>
    invoke<void>("EquipItem", accountId, kind, itemId),
  selectHunt: (accountId: number, slug: string) => invoke<void>("SelectHunt", accountId, slug),
  cancelPendingHunt: (accountId: number) => invoke<void>("CancelPendingHunt", accountId),
  selectOutlandTier: (accountId: number, tier: number) =>
    invoke<void>("SelectOutlandTier", accountId, tier),
  claimPass: (accountId: number) => invoke<void>("ClaimPass", accountId),
  claimAllPasses: () => invoke<number>("ClaimAllPasses"),
  getHuntsCatalog: (accountId: number) => invoke<HuntsCatalog>("GetHuntsCatalog", accountId),
  getActivePokemonSheet: (accountId: number) =>
    invoke<ActivePokemonSheet>("GetActivePokemonSheet", accountId),
  getInventory: (accountId: number) => invoke<InventorySummary>("GetInventory", accountId),
  listPokemons: (accountId: number, sortBy: string) =>
    invoke<PokemonDetail[]>("ListPokemons", accountId, sortBy),
  getChatMessages: (canal: string) => invoke<ChatMessage[]>("GetChatMessages", canal),
  sendChatMessage: (accountId: number, canal: string, texto: string) =>
    invoke<void>("SendChatMessage", accountId, canal, texto),
  resetSession: (accountId: number) => invoke<void>("ResetSession", accountId),
  sellDepot: (accountId: number) =>
    invoke<{ label: string; qty: number; gained: number }>("SellDepot", accountId),
  getGameURL: (accountId: number) => invoke<string>("GetGameURL", accountId),
  openGameWindow: (accountId: number) => invoke<void>("OpenGameWindow", accountId),
  closeGameWindow: (accountId: number) => invoke<void>("CloseGameWindow", accountId),
  openAllGameWindows: () => invoke<void>("OpenAllGameWindows"),
  closeAllGameWindows: () => invoke<void>("CloseAllGameWindows"),

  // Market & Sniper
  getMarketOverview: () => invoke<Record<string, unknown>>("GetMarketOverview"),
  getMarketItemListings: (itemId: number, moeda: string, accountId: number) =>
    invoke<Record<string, unknown>>("GetMarketItemListings", itemId, moeda, accountId),
  getMarketVitrine: (filters: Record<string, unknown>, accountId: number) =>
    invoke<Record<string, unknown>>("GetMarketVitrine", filters, accountId),
  getMarketTape: (mode: string, page: number, accountId: number) =>
    invoke<Record<string, unknown>>("GetMarketTape", mode, page, accountId),
  getMarketMyListings: (accountId: number) =>
    invoke<Record<string, unknown>>("GetMarketMyListings", accountId),
  getMarketWallet: (accountId: number) =>
    invoke<Record<string, unknown>>("GetMarketWallet", accountId),
  buyMarketListing: (accountId: number, listingId: number, qty: number, price: number, moeda: string) =>
    invoke<{ status: string; detail: string; total?: number }>(
      "BuyMarketListing",
      accountId,
      listingId,
      qty,
      price,
      moeda
    ),
  getMarketGuideStats: (days: number) => invoke<Record<string, unknown>>("GetMarketGuideStats", days),
  toggleMarketFav: (itemId: number) => invoke<boolean>("ToggleMarketFav", itemId),
  listMarketRules: () => invoke<MarketRule[]>("ListMarketRules"),
  saveMarketRule: (rule: MarketRule) => invoke<MarketRule>("SaveMarketRule", rule),
  toggleMarketRule: (id: number) => invoke<boolean>("ToggleMarketRule", id),
  deleteMarketRule: (id: number) => invoke<void>("DeleteMarketRule", id),
  listMarketLog: () => invoke<MarketLogEntry[]>("ListMarketLog"),
  setSniperEnabled: (enabled: boolean) => invoke<void>("SetSniperEnabled", enabled),

  // PvP
  getPvpOverview: () => invoke<PvpAccountView[]>("GetPvpOverview"),
  setPvpAuto: (accountId: number, enabled: boolean) =>
    invoke<void>("SetPvpAuto", accountId, enabled),
  pvpQueueAction: (accountId: number, enter: boolean) =>
    invoke<void>("PvpQueueAction", accountId, enter),
  savePvpTeam: (accountId: number, pokemonIds: number[], houses: Record<string, number>) =>
    invoke<void>("SavePvpTeam", accountId, pokemonIds, houses),
  getPvpLadder: (accountId: number, page: number) =>
    invoke<Record<string, unknown>>("GetPvpLadder", accountId, page),
  getPvpMonthly: (accountId: number, page: number) =>
    invoke<Record<string, unknown>>("GetPvpMonthly", accountId, page),

  // Lives
  getLivesState: () => invoke<LivesCentralState>("GetLivesState"),
  refreshLivesStatus: () => invoke<LivesCentralState>("RefreshLivesStatus"),
  saveLivesConfig: (accountId: number, cfg: LivesAccountConfig) =>
    invoke<void>("SaveLivesConfig", accountId, cfg),
  openLivePlayer: (accountId: number, site: string, slot: number, channel: string, hidden: boolean) =>
    invoke<void>("OpenLivePlayer", accountId, site, slot, channel, hidden),
  stopLivePlayer: (accountId: number, site: string, slot: number) =>
    invoke<void>("StopLivePlayer", accountId, site, slot),
  openLivePointsPage: (site: string, channel: string) =>
    invoke<void>("OpenLivePointsPage", site, channel),
  openLiveLogin: (site: string) => invoke<void>("OpenLiveLogin", site),

  onTelemetry: (cb: (snap: TelemetrySnapshot) => void) => {
    return Events.On("telemetry", (ev) => {
      const data = ev?.data as TelemetrySnapshot | undefined;
      if (data) {
        cb({
          ...data,
          accounts: Array.isArray(data.accounts) ? data.accounts : [],
        });
      }
    });
  },
  onChat: (cb: (ev: ChatEvent) => void) => {
    return Events.On("chat", (ev) => {
      const data = ev?.data as ChatEvent | undefined;
      if (data) cb(data);
    });
  },
};
