import { useEffect, useState } from "react";
import {
  Tag,
  Play,
  Plus,
  Trash2,
  Pencil,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  PauseCircle,
  Sparkles,
  Package,
  X,
  HelpCircle,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Zap,
  Lock,
  Check,
} from "lucide-react";
import {
  AccountTelemetry,
  AutoSellPreviewItem,
  GlobalSettings,
  InventoryItemEntry,
  MarketLogEntry,
  MarketSellRule,
  MarketSellRuleSpec,
  SellPriceMode,
  fmtCompact,
} from "../lib/types";
import { api } from "../lib/api";
import { ItemSprite } from "./PokemonSprite";
import { DsConfirmDialog, DsDialog, DsSwitch, MiniBall } from "./DsPrimitives";

interface CatalogItemEntry {
  id: number;
  name: string;
  icon: string;
  category?: string;
  rare?: boolean;
}

interface SellFormState {
  editingId: number;
  moeda: "gold" | "orb";
  itemId: number;
  itemName: string;
  keepQty: number;
  minSellQty: number;
  maxActiveAds: number;
  priceMode: SellPriceMode;
  fixedPrice: number;
  minPrice: number;
  minPctOfAvg: number;
  undercutType: "value" | "pct";
  undercutAmount: number;
  belowFloorAction: "hold" | "list_at_floor";
  repriceEnabled: boolean;
  repriceMinDiffPct: number;
  accountIds: number[];
}

function defaultFormState(defaultMoeda: "gold" | "orb"): SellFormState {
  return {
    editingId: 0,
    moeda: defaultMoeda,
    itemId: 70000,
    itemName: "Bronze Boss Token",
    keepQty: 20,
    minSellQty: 10,
    maxActiveAds: 1,
    priceMode: "smart",
    fixedPrice: 10000,
    minPrice: 0,
    minPctOfAvg: 85,
    undercutType: "value",
    undercutAmount: 1,
    belowFloorAction: "hold",
    repriceEnabled: true,
    repriceMinDiffPct: 3,
    accountIds: [],
  };
}

function formFromRule(rule: MarketSellRule): SellFormState {
  const s = rule.spec;
  const usesPct = Boolean(s.undercutPct && s.undercutPct > 0);
  return {
    editingId: rule.id,
    moeda: s.moeda === "orb" ? "orb" : "gold",
    itemId: s.itemId || 0,
    itemName: s.itemName || "",
    keepQty: s.keepQty ?? 0,
    minSellQty: s.minSellQty || 1,
    maxActiveAds: s.maxActiveAds || 1,
    priceMode: s.priceMode || "smart",
    fixedPrice: s.fixedPrice || 0,
    minPrice: s.minPrice || 0,
    minPctOfAvg: s.minPctOfAvg ?? 85,
    undercutType: usesPct ? "pct" : "value",
    undercutAmount: usesPct ? s.undercutPct || 1 : s.undercutStep ?? 1,
    belowFloorAction: s.belowFloorAction || "hold",
    repriceEnabled: Boolean(s.repriceEnabled),
    repriceMinDiffPct: s.repriceMinDiffPct || 3,
    accountIds: Array.isArray(s.accountIds) ? [...s.accountIds] : [],
  };
}

function buildRuleFromForm(f: SellFormState, existing?: MarketSellRule): MarketSellRule {
  const spec: MarketSellRuleSpec = {
    target: "item",
    moeda: f.moeda,
    itemId: Math.max(0, Math.floor(f.itemId)),
    itemName: f.itemName.trim() || `Item #${f.itemId}`,
    keepQty: Math.max(0, Math.floor(f.keepQty)),
    minSellQty: Math.max(1, Math.floor(f.minSellQty || 1)),
    maxActiveAds: Math.max(1, Math.floor(f.maxActiveAds || 1)),
    priceMode: f.priceMode,
    fixedPrice: Math.max(0, Math.floor(f.fixedPrice)),
    minPrice: Math.max(0, Math.floor(f.minPrice)),
    minPctOfAvg: Math.max(0, Math.min(200, f.minPctOfAvg)),
    undercutStep: f.undercutType === "value" ? Math.max(0, Math.floor(f.undercutAmount)) : 0,
    undercutPct: f.undercutType === "pct" ? Math.max(0, Math.min(50, f.undercutAmount)) : 0,
    belowFloorAction: f.belowFloorAction,
    repriceEnabled: f.repriceEnabled,
    repriceMinDiffPct: Math.max(0.5, Math.min(50, f.repriceMinDiffPct || 3)),
    accountIds: f.accountIds,
  };

  return {
    id: f.editingId,
    enabled: existing ? existing.enabled : true,
    spec,
    listed: existing ? existing.listed : 0,
    lastFire: existing ? existing.lastFire : 0,
    createdAt: existing ? existing.createdAt : 0,
  };
}

function validateStep(step: 1 | 2 | 3, f: SellFormState): string | null {
  if (step === 1) {
    if (!f.itemId || f.itemId <= 0) {
      return "Escolha um item na lista (ou informe um Item ID em Avançado).";
    }
    return null;
  }
  if (step === 2) {
    if (f.priceMode === "fixed" && f.fixedPrice < 2) {
      return "No modo Preço Fixo, o preço unitário deve ser no mínimo 2.";
    }
    if (f.priceMode === "undercut" && f.minPrice < 2) {
      return "No modo Undercut Rápido, defina um Piso Mínimo Fixo (≥ 2) para não vender no prejuízo.";
    }
    if (f.priceMode === "smart" && f.minPrice <= 0 && f.minPctOfAvg <= 0) {
      return "No modo Smart, defina um Piso % da Média 7d ou um Piso Mínimo Fixo.";
    }
    return null;
  }
  return validateStep(1, f) || validateStep(2, f);
}

function formatPriceModeBadge(mode: SellPriceMode): { label: string; cls: string } {
  if (mode === "undercut") {
    return {
      label: "Undercut",
      cls: "bg-amber-500/15 text-[var(--ink-accent-amber)] border-amber-500/35",
    };
  }
  if (mode === "fixed") {
    return {
      label: "Fixo",
      cls: "bg-sky-500/15 text-[var(--ink-accent-sky)] border-sky-500/35",
    };
  }
  return {
    label: "Smart",
    cls: "bg-emerald-500/15 text-[var(--ink-accent-green)] border-emerald-500/35",
  };
}

function formatPreviewActionBadge(action: AutoSellPreviewItem["action"]): { label: string; cls: string } {
  if (action === "create") {
    return {
      label: "ANUNCIAR",
      cls: "bg-emerald-500/15 text-[var(--ink-accent-green)] border-emerald-500/35",
    };
  }
  if (action === "reprice") {
    return {
      label: "REAJUSTAR",
      cls: "bg-sky-500/15 text-[var(--ink-accent-sky)] border-sky-500/35",
    };
  }
  if (action === "blocked") {
    return {
      label: "BLOQUEADO",
      cls: "bg-rose-500/15 text-rose-500 border-rose-500/35",
    };
  }
  return {
    label: "SEGURAR",
    cls: "bg-amber-500/15 text-[var(--ink-accent-amber)] border-amber-500/35",
  };
}

function describeSellRule(r: MarketSellRule): string {
  const s = r.spec;
  if (s.target === "pokemon") {
    return `${s.query?.trim() || "Qualquer Pokémon"} (regra antiga de Pokémon)`;
  }
  const name = s.itemName || `Item #${s.itemId}`;
  return `${name} · manter ${s.keepQty ?? 0} · lote ≥ ${s.minSellQty || 1}`;
}

function describePriceSummary(s: MarketSellRuleSpec): string {
  const cur = s.moeda === "orb" ? "Gemas" : "Gold";
  if (s.priceMode === "fixed") {
    return `Fixo ${fmtCompact(s.fixedPrice || 0)} ${cur}`;
  }
  const parts: string[] = [];
  if (s.undercutPct && s.undercutPct > 0) {
    parts.push(`-${s.undercutPct}%`);
  } else {
    parts.push(`-${s.undercutStep || 1}`);
  }
  if (s.minPrice && s.minPrice > 0) {
    parts.push(`piso ${fmtCompact(s.minPrice)} ${cur}`);
  }
  if (s.priceMode === "smart" && s.minPctOfAvg && s.minPctOfAvg > 0) {
    parts.push(`≥ ${s.minPctOfAvg}% média 7d`);
  }
  parts.push(s.belowFloorAction === "list_at_floor" ? "anuncia no piso" : "segura abaixo");
  return parts.join(" · ");
}

function estimateFormPrice(
  f: SellFormState,
  marketMin: number,
  avg7d: number
): { hardFloor: number; estimated: number; willHold: boolean } {
  let hardFloor = Math.max(2, Math.floor(f.minPrice || 0));
  if (f.priceMode === "smart" && avg7d > 0 && f.minPctOfAvg > 0) {
    const avgFloor = Math.ceil(avg7d * (f.minPctOfAvg / 100));
    if (avgFloor > hardFloor) hardFloor = avgFloor;
  }
  if (f.priceMode === "fixed") {
    return { hardFloor: Math.max(2, f.fixedPrice), estimated: Math.max(2, f.fixedPrice), willHold: false };
  }
  if (marketMin <= 0) {
    if (f.priceMode === "smart" && avg7d > 0) {
      return { hardFloor, estimated: Math.max(Math.round(avg7d), hardFloor), willHold: false };
    }
    return { hardFloor, estimated: f.minPrice >= 2 ? f.minPrice : 0, willHold: f.minPrice < 2 };
  }
  const delta =
    f.undercutType === "pct"
      ? Math.max(1, Math.round(marketMin * ((f.undercutAmount || 1) / 100)))
      : Math.max(1, Math.floor(f.undercutAmount || 1));
  const cand = Math.max(2, marketMin - delta);
  if (cand < hardFloor) {
    if (f.belowFloorAction === "list_at_floor") {
      return { hardFloor, estimated: hardFloor, willHold: false };
    }
    return { hardFloor, estimated: 0, willHold: true };
  }
  return { hardFloor, estimated: cand, willHold: false };
}

function buildLiveFormSummary(f: SellFormState): string {
  const name = f.itemName.trim() || `Item #${f.itemId}`;
  const cur = f.moeda === "orb" ? "Gemas" : "Gold";
  const keep = Math.max(0, Math.floor(f.keepQty));
  const minLot = Math.max(1, Math.floor(f.minSellQty || 1));
  const triggerAt = keep + minLot;

  if (f.priceMode === "fixed") {
    return `Mantém ${keep} ${name} na mochila. Ao chegar em ${triggerAt}+ unidades, anuncia o excedente por ${fmtCompact(f.fixedPrice)} ${cur} cada.`;
  }
  const cut =
    f.undercutType === "pct" ? `${f.undercutAmount || 1}%` : `${f.undercutAmount || 1} ${cur}`;
  const floors: string[] = [];
  if (f.minPrice > 0) floors.push(`mín. ${fmtCompact(f.minPrice)} ${cur}`);
  if (f.priceMode === "smart" && f.minPctOfAvg > 0) floors.push(`${f.minPctOfAvg}% da média 7d`);
  const floorPart = floors.length > 0 ? ` com piso de ${floors.join(" / ")}` : "";
  const belowPart =
    f.belowFloorAction === "list_at_floor" ? "anuncia no piso" : "segura sem anunciar";
  return `Mantém ${keep} ${name} na mochila. Ao chegar em ${triggerAt}+ unidades, anuncia ${cut} abaixo do menor concorrente${floorPart} (se cair abaixo do piso: ${belowPart}).`;
}

function normalizePreviewArray(res: AutoSellPreviewItem[]): AutoSellPreviewItem[] {
  return Array.isArray(res) ? res : [];
}

function normalizeInvItems(items: InventoryItemEntry[] | undefined): InventoryItemEntry[] {
  return Array.isArray(items) ? items : [];
}

function HelpTip({
  text,
  align = "center",
  side = "top",
}: {
  text: string;
  align?: "left" | "center" | "right";
  side?: "top" | "bottom";
}) {
  const posX =
    align === "left"
      ? "left-0"
      : align === "right"
      ? "right-0"
      : "left-1/2 -translate-x-1/2";
  const posY = side === "bottom" ? "top-full mt-2" : "bottom-full mb-2";

  return (
    <span className="relative inline-flex items-center group">
      <button
        type="button"
        aria-label="Ajuda"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[var(--ink-subtle)] hover:text-[var(--ink)] focus:text-[var(--ink)] focus:outline-none cursor-help transition"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100 transition duration-150 absolute ${posY} ${posX} z-50 w-64 rounded-lg bg-[var(--panel-bg)] border-[1.5px] border-[var(--border-dark)] shadow-xl px-3 py-2 text-[11px] font-medium leading-relaxed text-[var(--ink)] normal-case tracking-normal text-left`}
      >
        {text}
      </span>
    </span>
  );
}

const WIZARD_STEPS: { num: 1 | 2 | 3; label: string }[] = [
  { num: 1, label: "Item & Estoque" },
  { num: 2, label: "Preço" },
  { num: 3, label: "Reajuste & Revisão" },
];

export function MarketAutoSellTab({
  accounts,
  settings,
  defaultMoeda,
  itemsMeta,
  resumo,
  medias,
  sellRules,
  logs,
  onSettingsChange,
  onRulesReload,
  onToast,
}: {
  accounts: AccountTelemetry[];
  settings: GlobalSettings;
  defaultMoeda: "gold" | "orb";
  itemsMeta: Record<string, CatalogItemEntry>;
  resumo: Record<string, Record<string, number>>;
  medias: Record<string, Record<string, { media?: number }>>;
  sellRules: MarketSellRule[];
  logs: MarketLogEntry[];
  onSettingsChange: (gs: GlobalSettings) => void;
  onRulesReload: () => void;
  onToast: (msg: string) => void;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<SellFormState>(() => defaultFormState(defaultMoeda));
  const [itemSearch, setItemSearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [invItems, setInvItems] = useState<InventoryItemEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [previewRuleId, setPreviewRuleId] = useState<number | null>(null);
  const [previews, setPreviews] = useState<AutoSellPreviewItem[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MarketSellRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .getInventory(0)
      .then((res) => setInvItems(normalizeInvItems(res.items)))
      .catch(() => {});
  }, []);

  const invById = new Map<number, InventoryItemEntry>();
  for (const it of invItems) {
    if (it.kind !== "ball") {
      invById.set(it.id, it);
    }
  }

  const searchNorm = itemSearch.trim().toLowerCase();
  const pickerEntries: { id: number; name: string; icon: string; stock: number; rare: boolean }[] = [];
  const seenIds = new Set<number>();

  for (const it of invItems) {
    if (it.kind === "ball") continue;
    seenIds.add(it.id);
    if (!searchNorm || it.nome.toLowerCase().includes(searchNorm) || String(it.id).includes(searchNorm)) {
      pickerEntries.push({
        id: it.id,
        name: it.nome,
        icon: it.icon,
        stock: it.total,
        rare: it.kind === "rare",
      });
    }
  }
  for (const meta of Object.values(itemsMeta)) {
    if (!meta || seenIds.has(meta.id)) continue;
    if (searchNorm && !meta.name.toLowerCase().includes(searchNorm) && !String(meta.id).includes(searchNorm)) {
      continue;
    }
    pickerEntries.push({
      id: meta.id,
      name: meta.name,
      icon: meta.icon,
      stock: 0,
      rare: Boolean(meta.rare),
    });
  }
  const visiblePicker = pickerEntries.slice(0, 14);

  const openCreateWizard = () => {
    const initial = defaultFormState(defaultMoeda);
    const firstBagItem = invItems.find((it) => it.kind !== "ball" && it.total > 0);
    if (firstBagItem) {
      initial.itemId = firstBagItem.id;
      initial.itemName = firstBagItem.nome;
    }
    setForm(initial);
    setItemSearch("");
    setShowAdvanced(false);
    setWizardStep(1);
    setWizardOpen(true);
  };

  const openEditWizard = (rule: MarketSellRule) => {
    setForm(formFromRule(rule));
    setItemSearch("");
    setShowAdvanced(false);
    setWizardStep(1);
    setWizardOpen(true);
  };

  const handleGoToStep = (next: 1 | 2 | 3) => {
    if (next > wizardStep) {
      const err = validateStep(wizardStep, form);
      if (err) {
        onToast(err);
        return;
      }
      if (next === 3 && wizardStep === 1) {
        const err2 = validateStep(2, form);
        if (err2) {
          onToast(err2);
          return;
        }
      }
    }
    setWizardStep(next);
  };

  const handleToggleMaster = async (nextEnabled: boolean, nextDryRun: boolean) => {
    const nextSettings: GlobalSettings = {
      ...settings,
      autoSellEnabled: nextEnabled,
      autoSellDryRun: nextDryRun,
    };
    const toastMsg = nextEnabled
      ? nextDryRun
        ? "Auto-Venda LIGADA em modo Simulação (Dry-Run)"
        : "Auto-Venda LIGADA (anúncios e reajustes reais ativos)"
      : "Auto-Venda DESLIGADA";
    try {
      await api.setAutoSellConfig(nextEnabled, nextDryRun);
      onSettingsChange(nextSettings);
      onToast(toastMsg);
    } catch (e) {
      onToast(`Erro: ${String(e)}`);
    }
  };

  const handleSimulate = async (ruleId: number) => {
    setSimulating(true);
    setPreviewRuleId(ruleId);
    try {
      const res = await api.previewAutoSell(ruleId);
      const list = normalizePreviewArray(res);
      setPreviews(list);
      if (list.length === 0) {
        onToast("Simulação concluída: nenhuma ação pendente no momento.");
      }
    } catch (e) {
      setPreviews([]);
      onToast(`Simulação: ${String(e)}`);
    }
    setSimulating(false);
  };

  const handleSaveRule = async () => {
    const errMsg = validateStep(3, form);
    if (errMsg) {
      onToast(errMsg);
      return;
    }
    const existing = form.editingId > 0 ? sellRules.find((r) => r.id === form.editingId) : undefined;
    const payload = buildRuleFromForm(form, existing);
    const doneMsg = form.editingId > 0 ? "Regra de auto-venda atualizada!" : "Regra de auto-venda criada!";
    setSaving(true);
    try {
      await api.saveMarketSellRule(payload);
      setWizardOpen(false);
      onToast(doneMsg);
      onRulesReload();
    } catch (e) {
      onToast(`Erro ao salvar regra: ${String(e)}`);
    }
    setSaving(false);
  };

  const handleToggleRule = async (id: number) => {
    try {
      await api.toggleMarketSellRule(id);
      onRulesReload();
    } catch (e) {
      onToast(`Erro: ${String(e)}`);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleting(true);
    try {
      await api.deleteMarketSellRule(targetId);
      setDeleteTarget(null);
      onToast("Regra removida.");
      onRulesReload();
    } catch (e) {
      onToast(`Erro ao excluir: ${String(e)}`);
    }
    setDeleting(false);
  };

  const toggleAccountInForm = (accId: number) => {
    const exists = form.accountIds.includes(accId);
    const nextIds = exists
      ? form.accountIds.filter((id) => id !== accId)
      : [...form.accountIds, accId];
    setForm({ ...form, accountIds: nextIds });
  };

  const sellLogs = logs.filter(
    (l) =>
      l.status.startsWith("autosell_") ||
      l.status.startsWith("reprice_") ||
      l.status.startsWith("editar_") ||
      l.status.startsWith("cancelar_")
  );

  const selectedIdKey = String(form.itemId);
  const selectedBagItem = invById.get(form.itemId);
  const selectedMeta = itemsMeta[selectedIdKey];
  const selectedIcon = selectedBagItem?.icon || selectedMeta?.icon || "";
  const selectedResumo = resumo[selectedIdKey];
  const selectedMarketMin = selectedResumo
    ? form.moeda === "orb"
      ? selectedResumo.minOrb || 0
      : selectedResumo.minGold || 0
    : 0;
  const selectedAvg7d = medias[selectedIdKey]?.[form.moeda]?.media || 0;
  const liveEstimate = estimateFormPrice(form, selectedMarketMin, selectedAvg7d);
  const triggerTotal = Math.max(0, Math.floor(form.keepQty)) + Math.max(1, Math.floor(form.minSellQty || 1));
  const curLabel = form.moeda === "orb" ? "Gemas" : "Gold";
  const selectedAccNames =
    form.accountIds.length > 0
      ? form.accountIds.map((id) => accounts.find((a) => a.id === id)?.nick || `#${id}`).join(", ")
      : "Todas as contas";

  return (
    <div className="space-y-4">
      {/* Master Control Bar */}
      <div className="px-box p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="space-y-0.5 max-w-lg">
          <div className="flex items-center gap-2 text-sm font-bold text-[var(--ink)]">
            <Tag className="w-4 h-4 text-[var(--ink-accent-green)]" />
            Auto-Venda de Itens Excedentes
          </div>
          <p className="text-[var(--ink-muted)] font-medium">
            Anuncia excedentes automaticamente e reajusta preços abertos sem poluir sua tela.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="inline-flex items-center gap-1">
            <DsSwitch
              checked={Boolean(settings.autoSellDryRun)}
              onChange={(nextDry) => handleToggleMaster(Boolean(settings.autoSellEnabled), nextDry)}
              label="Dry-Run"
            />
            <HelpTip
              align="right"
              side="bottom"
              text="Modo de teste: quando ligado junto com Auto-Venda, o sistema só simula sem anunciar nem editar nada no jogo."
            />
          </div>

          <button
            type="button"
            disabled={simulating}
            onClick={() => handleSimulate(0)}
            className="ds-btn ds-btn-blue ds-btn-sm inline-flex items-center gap-1.5"
          >
            <Play className={`w-3.5 h-3.5 ${simulating ? "animate-pulse" : ""}`} />
            {simulating ? "Simulando..." : "Simular Agora"}
          </button>

          <button
            type="button"
            onClick={() => handleToggleMaster(!settings.autoSellEnabled, Boolean(settings.autoSellDryRun))}
            className={`ds-btn ds-btn-sm ${
              settings.autoSellEnabled ? "ds-btn-green" : "ds-btn-slate"
            }`}
          >
            {settings.autoSellEnabled
              ? settings.autoSellDryRun
                ? "AUTO-VENDA: DRY-RUN"
                : "AUTO-VENDA: ON"
              : "AUTO-VENDA: OFF"}
          </button>

          <button
            type="button"
            onClick={openCreateWizard}
            className="ds-btn ds-btn-orange ds-btn-sm inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Regra
          </button>
        </div>
      </div>

      {/* Simulation Preview Panel */}
      {previewRuleId !== null && (
        <div className="px-box p-4 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold text-[var(--ink)] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--ink-accent-amber)]" />
              Prévia da Simulação{" "}
              {previewRuleId > 0 ? `(Regra #${previewRuleId})` : "(Todas as regras ativas)"} —{" "}
              {previews.length} resultado(s)
            </div>
            <button
              type="button"
              onClick={() => {
                setPreviewRuleId(null);
                setPreviews([]);
              }}
              className="ds-btn ds-btn-slate ds-btn-sm !px-2"
              title="Fechar prévia"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {previews.length === 0 ? (
            <div className="px-inset p-3 text-[var(--ink-muted)] font-medium">
              Nenhum item excedente elegível para anunciar ou reajustar neste momento.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {previews.map((p, idx) => {
                const badge = formatPreviewActionBadge(p.action);
                const cur = p.moeda === "orb" ? "Gemas" : "Gold";
                return (
                  <div
                    key={`${p.ruleId}-${p.accountId}-${p.label}-${idx}`}
                    className="px-inset px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                      <span className="font-bold text-[var(--ink)]">[{p.accountNick}]</span>
                      <span className="font-semibold text-[var(--ink)]">
                        {p.qty > 1 ? `${p.qty}× ` : ""}
                        {p.label}
                      </span>
                      <span className="text-[var(--ink-muted)]">· {p.reason}</span>
                    </div>
                    <div className="font-mono-num text-right shrink-0 flex items-center gap-2">
                      {p.action === "reprice" && p.currentPrice ? (
                        <span className="text-[var(--ink-muted)] line-through">
                          {fmtCompact(p.currentPrice)}
                        </span>
                      ) : null}
                      {p.price > 0 && (
                        <span className="font-bold text-[var(--ink-accent-amber)]">
                          {fmtCompact(p.price)} {cur}
                        </span>
                      )}
                      {p.marketFloor > 0 && (
                        <span className="text-[10px] text-[var(--ink-subtle)]">
                          (menor mkt {fmtCompact(p.marketFloor)}
                          {p.refAvg > 0 ? ` · méd 7d ${fmtCompact(Math.round(p.refAvg))}` : ""})
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Rules List */}
      <div className="space-y-2 text-xs">
        {sellRules.length === 0 ? (
          <div className="px-box p-8 text-center space-y-3">
            <div className="w-11 h-11 mx-auto rounded-xl bg-[var(--panel-alt)] border border-[var(--border-mid)] flex items-center justify-center">
              <Tag className="w-5 h-5 text-[var(--ink-accent-green)]" />
            </div>
            <div className="space-y-1">
              <div className="font-bold text-sm text-[var(--ink)]">
                Nenhuma regra de Auto-Venda configurada
              </div>
              <p className="text-[var(--ink-muted)] font-medium max-w-md mx-auto">
                Crie sua primeira regra em 3 passos rápidos para anunciar itens excedentes no piloto automático.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateWizard}
              className="ds-btn ds-btn-green ds-btn-sm inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Criar Primeira Regra
            </button>
          </div>
        ) : (
          sellRules.map((r) => {
            const isLegacyPoke = r.spec.target === "pokemon";
            const pm = formatPriceModeBadge(r.spec.priceMode || "smart");
            const accNames =
              r.spec.accountIds && r.spec.accountIds.length > 0
                ? r.spec.accountIds
                    .map((id) => accounts.find((a) => a.id === id)?.nick || `#${id}`)
                    .join(", ")
                : "Todas as contas";
            const itemMeta = !isLegacyPoke && r.spec.itemId ? itemsMeta[String(r.spec.itemId)] : undefined;
            return (
              <div
                key={r.id}
                className="px-box px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {!isLegacyPoke && itemMeta?.icon ? (
                    <ItemSprite icon={itemMeta.icon} size={30} alt={r.spec.itemName || ""} />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-[var(--panel-alt)] border border-[var(--border-mid)] flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-[var(--ink-accent-sky)]" />
                    </div>
                  )}
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-bold text-[var(--ink)] flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${pm.cls}`}>
                        {pm.label}
                      </span>
                      {r.spec.repriceEnabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-500/15 text-[var(--ink-accent-sky)] border-sky-500/35 inline-flex items-center gap-1">
                          <RefreshCw className="w-2.5 h-2.5" /> Reajuste ≥{r.spec.repriceMinDiffPct || 3}%
                        </span>
                      )}
                      <span>{describeSellRule(r)}</span>
                    </div>
                    <div className="text-[11px] text-[var(--ink-muted)] font-medium">
                      {describePriceSummary(r.spec)} · {accNames} · Anúncios feitos:{" "}
                      <b className="font-mono-num text-[var(--ink)]">{r.listed}</b>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={simulating}
                    onClick={() => handleSimulate(r.id)}
                    title="Simular esta regra agora"
                    className="ds-btn ds-btn-blue ds-btn-sm !px-2.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  {!isLegacyPoke && (
                    <button
                      type="button"
                      onClick={() => openEditWizard(r)}
                      title="Editar regra"
                      className="ds-btn ds-btn-slate ds-btn-sm !px-2.5"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleToggleRule(r.id)}
                    className={`ds-btn ds-btn-sm inline-flex items-center gap-1 ${
                      r.enabled ? "ds-btn-green" : "ds-btn-slate"
                    }`}
                  >
                    {r.enabled ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Ativa
                      </>
                    ) : (
                      <>
                        <PauseCircle className="w-3.5 h-3.5" /> Pausada
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(r)}
                    title="Excluir regra"
                    className="ds-btn ds-btn-red ds-btn-sm !px-2.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Auto-Sell Execution Log */}
      {sellLogs.length > 0 && (
        <div className="px-box p-4 space-y-2 text-xs">
          <div className="font-bold text-[var(--ink)] flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--ink-accent-amber)]" />
            Log de Auto-Venda & Reajustes
          </div>
          <div className="max-h-52 overflow-y-auto space-y-1">
            {sellLogs.slice(0, 40).map((l) => (
              <div
                key={l.id}
                className="px-inset px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
              >
                <span className="truncate font-medium text-[var(--ink)]">{l.text}</span>
                <span className="font-mono-num text-[10px] text-[var(--ink-subtle)] shrink-0">
                  {new Date(l.ts * 1000).toLocaleTimeString("pt-BR")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3-Step Rule Wizard Dialog */}
      <DsDialog
        open={wizardOpen}
        onClose={() => !saving && setWizardOpen(false)}
        maxWidthClass="max-w-2xl"
      >
        <div className="px-box text-[var(--ink)] shadow-2xl">
          {/* Dialog Header */}
          <div className="rounded-t-[10px] bg-gradient-to-b from-[#2563eb] to-[#1d4ed8] border-b-[1.5px] border-[#1b1f26] px-4 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <MiniBall />
              <span className="font-bold text-sm text-white truncate">
                {form.editingId > 0
                  ? `Editar Regra #${form.editingId}`
                  : "Nova Regra de Auto-Venda"}
              </span>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => setWizardOpen(false)}
              className="ds-btn ds-btn-red ds-btn-sm !px-2"
              title="Fechar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Stepper Bar */}
          <div className="px-4 py-3 bg-[var(--panel-alt)] border-b border-[var(--border-mid)] grid grid-cols-3 gap-2">
            {WIZARD_STEPS.map((st) => {
              const isCurrent = wizardStep === st.num;
              const isDone = wizardStep > st.num;
              return (
                <button
                  key={st.num}
                  type="button"
                  onClick={() => handleGoToStep(st.num)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition cursor-pointer ${
                    isCurrent
                      ? "bg-[var(--panel-bg)] border-blue-500/60 text-[var(--ink)] shadow-sm"
                      : isDone
                      ? "bg-emerald-500/10 border-emerald-500/35 text-[var(--ink)]"
                      : "bg-transparent border-[var(--border-soft)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full text-[11px] font-mono-num font-bold inline-flex items-center justify-center shrink-0 ${
                      isCurrent
                        ? "bg-blue-600 text-white"
                        : isDone
                        ? "bg-emerald-600 text-white"
                        : "bg-[var(--border-mid)] text-[var(--ink-muted)]"
                    }`}
                  >
                    {isDone ? <Check className="w-3 h-3" /> : st.num}
                  </span>
                  <span className="text-[11px] font-bold truncate">{st.label}</span>
                </button>
              );
            })}
          </div>

          {/* Step Body */}
          <div className="p-5 space-y-4 text-xs min-h-[300px]">
            {/* STEP 1: Item & Stock */}
            {wizardStep === 1 && (
              <div className="space-y-4">
                {/* Selected Item Card + Search */}
                <div className="px-inset p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-[var(--panel-bg)] border border-[var(--border-mid)] flex items-center justify-center shrink-0">
                        {selectedIcon ? (
                          <ItemSprite icon={selectedIcon} size={28} alt={form.itemName} />
                        ) : (
                          <Package className="w-4 h-4 text-[var(--ink-muted)]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-[var(--ink)] truncate">
                          {form.itemName || `Item #${form.itemId}`}{" "}
                          <span className="font-mono-num text-[11px] font-normal text-[var(--ink-subtle)]">
                            #{form.itemId}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--ink-muted)] font-medium">
                          Estoque total:{" "}
                          <b className="font-mono-num text-[var(--ink)]">
                            {selectedBagItem ? fmtCompact(selectedBagItem.total) : "0"}
                          </b>
                          {selectedBagItem && selectedBagItem.accounts.length > 0 && (
                            <span className="text-[var(--ink-subtle)]">
                              {" "}
                              ({selectedBagItem.accounts.map((a) => `${a.nick}: ${a.qty}`).join(" · ")})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="relative w-full sm:w-56">
                      <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        value={itemSearch}
                        onChange={(e) => setItemSearch(e.target.value)}
                        placeholder="Buscar item ou ID..."
                        className="ds-input w-full pl-8 pr-3 py-1.5 text-xs"
                      />
                    </div>
                  </div>

                  {visiblePicker.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 max-h-32 overflow-y-auto">
                      {visiblePicker.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() =>
                            setForm({ ...form, itemId: entry.id, itemName: entry.name })
                          }
                          className={`px-2 py-1 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
                            form.itemId === entry.id
                              ? "bg-blue-500/20 border-blue-500/50 text-[var(--ink)]"
                              : "bg-[var(--panel-bg)] border-[var(--border-soft)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                          }`}
                        >
                          {entry.icon ? <ItemSprite icon={entry.icon} size={16} alt={entry.name} /> : null}
                          <span>{entry.name}</span>
                          {entry.stock > 0 && (
                            <span className="font-mono-num text-[10px] text-[var(--ink-accent-amber)]">
                              ×{fmtCompact(entry.stock)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quantity & Currency */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                      <span>Manter na mochila</span>
                      <HelpTip
                        align="left"
                        text="Quantidade mínima que sempre fica guardada na sua conta. O bot só anuncia o que passar desse valor."
                      />
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={form.keepQty}
                      onChange={(e) => setForm({ ...form, keepQty: Number(e.target.value) })}
                      className="ds-input w-full px-3 py-2 font-mono-num"
                    />
                  </div>

                  <div>
                    <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                      <span>Lote mínimo</span>
                      <HelpTip text="Quantidade mínima de excedente para criar um anúncio. Evita anunciar de 1 em 1 enquanto você farma. Para itens raros, use 1." />
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={form.minSellQty}
                        onChange={(e) => setForm({ ...form, minSellQty: Number(e.target.value) })}
                        className="ds-input w-full px-3 py-2 font-mono-num"
                      />
                      <span className="text-[11px] font-mono-num font-bold text-[var(--ink-accent-sky)] whitespace-nowrap shrink-0">
                        → {triggerTotal}+
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                      <span>Moeda</span>
                      <HelpTip
                        align="right"
                        text="Moeda do anúncio. O jogo cobra taxa fixa de 15% na venda de itens tanto em Gold quanto em Gemas."
                      />
                    </label>
                    <select
                      value={form.moeda}
                      onChange={(e) => setForm({ ...form, moeda: e.target.value as "gold" | "orb" })}
                      className="ds-input w-full px-3 py-2 font-semibold"
                    >
                      <option value="gold">Ouro (Gold)</option>
                      <option value="orb">Gemas (Orbs)</option>
                    </select>
                  </div>
                </div>

                {/* Collapsible Advanced */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    Opções avançadas (ID manual / máx. anúncios)
                    {showAdvanced ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {showAdvanced && (
                    <div className="mt-2 px-inset p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                          <span>Item ID manual</span>
                          <HelpTip
                            align="left"
                            text="Use caso queira cadastrar um item pelo ID numérico antes mesmo de tê-lo na mochila."
                          />
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={form.itemId}
                          onChange={(e) => setForm({ ...form, itemId: Number(e.target.value) })}
                          className="ds-input w-full px-2.5 py-1.5 font-mono-num"
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                          <span>Nome</span>
                          <HelpTip text="Nome de exibição da regra na lista e nos logs do Discord." />
                        </label>
                        <input
                          value={form.itemName}
                          onChange={(e) => setForm({ ...form, itemName: e.target.value })}
                          className="ds-input w-full px-2.5 py-1.5"
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                          <span>Máx. anúncios/conta</span>
                          <HelpTip
                            align="right"
                            text="Limita quantos anúncios simultâneos deste item podem ficar abertos na mesma conta (padrão: 1)."
                          />
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={form.maxActiveAds}
                          onChange={(e) => setForm({ ...form, maxActiveAds: Number(e.target.value) })}
                          className="ds-input w-full px-2.5 py-1.5 font-mono-num"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STEP 2: Pricing Strategy */}
            {wizardStep === 2 && (
              <div className="space-y-4">
                {/* Live reference strip */}
                <div className="px-inset px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-[var(--ink)]">
                    {selectedIcon ? <ItemSprite icon={selectedIcon} size={20} alt={form.itemName} /> : null}
                    <span>{form.itemName || `Item #${form.itemId}`}</span>
                  </div>
                  <div className="text-[11px] font-mono-num text-[var(--ink-muted)] flex flex-wrap items-center gap-3">
                    <span>
                      Menor atual:{" "}
                      <b className="text-[var(--ink-accent-amber)]">
                        {selectedMarketMin > 0 ? `${fmtCompact(selectedMarketMin)} ${curLabel}` : "—"}
                      </b>
                    </span>
                    <span>
                      Média 7d:{" "}
                      <b className="text-[var(--ink)]">
                        {selectedAvg7d > 0 ? `${fmtCompact(Math.round(selectedAvg7d))} ${curLabel}` : "—"}
                      </b>
                    </span>
                    <span>
                      Hoje:{" "}
                      {liveEstimate.willHold ? (
                        <b className="text-[var(--ink-accent-amber)]">Segurando</b>
                      ) : liveEstimate.estimated > 0 ? (
                        <b className="text-[var(--ink-accent-green)]">
                          {fmtCompact(liveEstimate.estimated)} {curLabel}
                        </b>
                      ) : (
                        <b>—</b>
                      )}
                    </span>
                  </div>
                </div>

                {/* 3 Mode Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(
                    [
                      {
                        id: "smart" as const,
                        title: "Smart (Recomendado)",
                        desc: "Bate o menor concorrente, protegido pela média 7d e piso.",
                        icon: TrendingUp,
                      },
                      {
                        id: "undercut" as const,
                        title: "Undercut Rápido",
                        desc: "Entra abaixo do menor preço atual para vender logo.",
                        icon: Zap,
                      },
                      {
                        id: "fixed" as const,
                        title: "Preço Fixo",
                        desc: "Anuncia sempre pelo valor exato que você escolher.",
                        icon: Lock,
                      },
                    ]
                  ).map((opt) => {
                    const Icon = opt.icon;
                    const active = form.priceMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setForm({ ...form, priceMode: opt.id })}
                        className={`text-left rounded-xl p-3 border-[1.5px] transition cursor-pointer space-y-1 ${
                          active
                            ? "bg-emerald-500/12 border-emerald-500/60 text-[var(--ink)] shadow-sm"
                            : "bg-[var(--panel-alt)] border-[var(--border-soft)] text-[var(--ink-muted)] hover:border-[var(--border-mid)]"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs text-[var(--ink)]">
                          <Icon
                            className={`w-3.5 h-3.5 ${
                              active ? "text-[var(--ink-accent-green)]" : "text-[var(--ink-muted)]"
                            }`}
                          />
                          {opt.title}
                        </div>
                        <p className="text-[11px] leading-snug text-[var(--ink-muted)] font-medium">
                          {opt.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Pricing Fields */}
                {form.priceMode === "fixed" ? (
                  <div className="px-inset p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                    <div>
                      <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                        <span>Preço Unitário Fixo ({curLabel})</span>
                        <HelpTip
                          align="left"
                          text="Valor exato por unidade. Ex.: 10 unidades × 1.000 = 10.000 no total."
                        />
                      </label>
                      <input
                        type="number"
                        min={2}
                        value={form.fixedPrice}
                        onChange={(e) => setForm({ ...form, fixedPrice: Number(e.target.value) })}
                        className="ds-input w-full px-3 py-2 font-mono-num"
                      />
                    </div>
                    <div className="text-[11px] font-medium text-[var(--ink-muted)] pb-2">
                      Você recebe líquido/un. (taxa 15%):{" "}
                      <b className="font-mono-num text-[var(--ink-accent-green)]">
                        {fmtCompact(Math.floor(form.fixedPrice * 0.85))} {curLabel}
                      </b>
                    </div>
                  </div>
                ) : (
                  <div className="px-inset p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                        <span>Desconto no concorrente</span>
                        <HelpTip
                          align="left"
                          text="Quanto mais barato você entra em relação ao menor anúncio válido dos concorrentes. Ex.: 1 Gold fica em 1º na lista."
                        />
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step={form.undercutType === "pct" ? 0.5 : 1}
                          value={form.undercutAmount}
                          onChange={(e) => setForm({ ...form, undercutAmount: Number(e.target.value) })}
                          className="ds-input w-full px-2.5 py-2 font-mono-num"
                        />
                        <select
                          value={form.undercutType}
                          onChange={(e) =>
                            setForm({ ...form, undercutType: e.target.value as "value" | "pct" })
                          }
                          className="ds-input px-2.5 py-2 font-semibold shrink-0"
                        >
                          <option value="value">{curLabel}</option>
                          <option value="pct">%</option>
                        </select>
                      </div>
                    </div>

                    {form.priceMode === "smart" && (
                      <div>
                        <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                          <span>Piso % da Média 7d</span>
                          <HelpTip
                            align="right"
                            text="Piso automático: se a média 7d for 1.000 e estiver 85%, o bot nunca vende abaixo de 850 (anúncios-isca baratos são ignorados)."
                          />
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={200}
                            value={form.minPctOfAvg}
                            onChange={(e) => setForm({ ...form, minPctOfAvg: Number(e.target.value) })}
                            className="ds-input w-full px-2.5 py-2 font-mono-num"
                          />
                          <span className="text-[var(--ink-muted)] font-bold">%</span>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                        <span>
                          Piso Mínimo Fixo {form.priceMode === "smart" ? "(opcional)" : "(obrigatório)"}
                        </span>
                        <HelpTip
                          align="left"
                          text="Menor valor absoluto em Gold/Gemas que você aceita receber. Se também usar % da média, sempre vale o maior piso."
                        />
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={form.minPrice}
                        onChange={(e) => setForm({ ...form, minPrice: Number(e.target.value) })}
                        placeholder={form.priceMode === "smart" ? "0 = só média 7d" : "Ex.: 500"}
                        className="ds-input w-full px-2.5 py-2 font-mono-num"
                      />
                    </div>

                    <div>
                      <label className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold mb-1">
                        <span>Se cair abaixo do piso</span>
                        <HelpTip
                          align="right"
                          text="Segurar: não anuncia barato e espera o mercado subir. Anunciar no piso: publica travado no seu valor mínimo."
                        />
                      </label>
                      <select
                        value={form.belowFloorAction}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            belowFloorAction: e.target.value as "hold" | "list_at_floor",
                          })
                        }
                        className="ds-input w-full px-2.5 py-2 font-semibold"
                      >
                        <option value="hold">Segurar (não anunciar)</option>
                        <option value="list_at_floor">Anunciar no piso</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: Auto-Reprice, Accounts & Review */}
            {wizardStep === 3 && (
              <div className="space-y-4">
                {/* Auto-Reprice */}
                <div className="px-inset p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1.5">
                      <DsSwitch
                        checked={form.repriceEnabled}
                        onChange={(next) => setForm({ ...form, repriceEnabled: next })}
                        label="Auto-Reajustar anúncios abertos"
                      />
                      <HelpTip
                        align="left"
                        side="bottom"
                        text="Monitora seus anúncios já abertos deste item e atualiza o preço automaticamente quando o mercado mudar (respeitando seu piso e o cooldown de ~30 min do jogo)."
                      />
                    </div>

                    {form.repriceEnabled && (
                      <div className="inline-flex items-center gap-1.5">
                        <span className="text-[var(--ink-muted)] font-semibold">quando variar ≥</span>
                        <input
                          type="number"
                          step={0.5}
                          min={0.5}
                          max={50}
                          value={form.repriceMinDiffPct}
                          onChange={(e) =>
                            setForm({ ...form, repriceMinDiffPct: Number(e.target.value) })
                          }
                          className="ds-input w-16 px-2 py-1 font-mono-num text-center"
                        />
                        <span className="text-[var(--ink-muted)] font-semibold">%</span>
                        <HelpTip
                          align="right"
                          side="bottom"
                          text="Diferença mínima em % entre seu anúncio atual e o novo preço alvo para evitar editar por centavos."
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Accounts */}
                <div className="px-inset p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-[var(--ink-muted)] font-semibold">
                    <span>Em quais contas rodar esta regra?</span>
                    <HelpTip
                      align="left"
                      text="Deixe 'Todas' para rodar em qualquer conta online ou selecione contas específicas."
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, accountIds: [] })}
                      className={`ds-btn ds-btn-sm ${
                        form.accountIds.length === 0 ? "ds-btn-orange" : "ds-btn-slate"
                      }`}
                    >
                      Todas
                    </button>
                    {accounts.map((a) => {
                      const active = form.accountIds.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => toggleAccountInForm(a.id)}
                          className={`ds-btn ds-btn-sm ${active ? "ds-btn-orange" : "ds-btn-slate"}`}
                        >
                          {a.nick}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Final Review Box */}
                <div className="rounded-xl p-3.5 border-[1.5px] border-emerald-500/40 bg-emerald-500/8 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-[var(--ink)]">
                    {selectedIcon ? <ItemSprite icon={selectedIcon} size={22} alt={form.itemName} /> : null}
                    <span>Resumo da Regra</span>
                  </div>
                  <p className="text-[11px] font-semibold text-[var(--ink)] leading-relaxed">
                    {buildLiveFormSummary(form)}
                  </p>
                  <div className="text-[11px] text-[var(--ink-muted)] font-medium flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Contas: <b className="text-[var(--ink)]">{selectedAccNames}</b>
                    </span>
                    <span>
                      Auto-Reajuste:{" "}
                      <b className="text-[var(--ink)]">
                        {form.repriceEnabled ? `Sim (≥ ${form.repriceMinDiffPct}%)` : "Não"}
                      </b>
                    </span>
                    <span>
                      Estimativa hoje:{" "}
                      <b className="font-mono-num text-[var(--ink-accent-green)]">
                        {liveEstimate.willHold
                          ? "Segurando"
                          : liveEstimate.estimated > 0
                          ? `${fmtCompact(liveEstimate.estimated)} ${curLabel}`
                          : "—"}
                      </b>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dialog Footer */}
          <div className="rounded-b-[10px] px-4 py-3 bg-[var(--panel-alt)] border-t border-[var(--border-mid)] flex items-center justify-between gap-2">
            <div>
              {wizardStep > 1 ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setWizardStep((wizardStep - 1) as 1 | 2)}
                  className="ds-btn ds-btn-slate ds-btn-sm inline-flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Voltar
                </button>
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setWizardOpen(false)}
                  className="ds-btn ds-btn-slate ds-btn-sm"
                >
                  Cancelar
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {wizardStep < 3 ? (
                <button
                  type="button"
                  onClick={() => handleGoToStep((wizardStep + 1) as 2 | 3)}
                  className="ds-btn ds-btn-blue ds-btn-sm inline-flex items-center gap-1"
                >
                  Próximo
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveRule}
                  className="ds-btn ds-btn-green ds-btn-sm inline-flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  {saving
                    ? "Salvando..."
                    : form.editingId > 0
                    ? "Salvar Alterações"
                    : "Criar Regra"}
                </button>
              )}
            </div>
          </div>
        </div>
      </DsDialog>

      <DsConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir regra de Auto-Venda?"
        description={
          deleteTarget
            ? `Remover a regra "${describeSellRule(deleteTarget)}"? Anúncios já publicados no mercado não serão cancelados.`
            : ""
        }
        confirmLabel="Excluir"
        tone="danger"
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
