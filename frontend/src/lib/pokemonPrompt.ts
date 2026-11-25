import { ListingDetail, PokemonDetail } from "./types";

const STAT_ROWS: [string, string][] = [
  ["hp", "HP"],
  ["atk", "ATK"],
  ["def", "DEF"],
  ["spAtk", "SP.ATK"],
  ["spDef", "SP.DEF"],
  ["speed", "SPD"],
];

const POTENCY_DESC: Record<number, string> = {
  1: "P1 (sem bônus)",
  2: "P2 (+5% em todos os stats)",
  3: "P3 (+10% em todos os stats)",
  4: "P4 (+25% em todos os stats)",
  5: "P5 (×2 em todos os stats)",
};

const GRADE_TIER_LABEL: Record<string, string> = {
  "extremamente-fraco": "Extremamente Fraco",
  fraco: "Fraco",
  mediano: "Mediano",
  razoavel: "Razoável",
  bom: "Bom",
  forte: "Forte",
  poderoso: "Poderoso",
  mitico: "Mítico",
  legendario: "Legendário",
  divino: "Divino",
};

function qualityPercentile(q: number): number {
  const clamped = Math.min(1.8, Math.max(0.8, q || 1));
  const rem = 1.8 - clamped;
  return Math.max(0, Math.min(100, Math.floor((1 - rem * rem) * 100)));
}

export function buildPokemonAIPrompt(
  sheet: PokemonDetail,
  listing?: ListingDetail | null
): string {
  const speciesName = sheet.nome || sheet.especie || "Pokémon";
  const tiposStr =
    sheet.tipos && sheet.tipos.length > 0 ? ` — ${sheet.tipos.join(" / ")}` : "";
  const idStr = sheet.pokeId > 0 ? ` (#${sheet.pokeId})` : "";
  const potDesc = POTENCY_DESC[sheet.potencia] || `P${sheet.potencia || 1}`;
  const qVal = sheet.qualidade || 1;
  const qPct = qualityPercentile(qVal);
  const tierLabel = GRADE_TIER_LABEL[sheet.faixa] || sheet.faixa || "—";
  const mainPower = sheet.pvePower > 0 ? sheet.pvePower : sheet.pvpPower;
  const combatHp = sheet.combatHp || (sheet.stats?.hp || 0) * 12;

  const refino = sheet.refino || {};
  const hasRefino = STAT_ROWS.some(([k]) => (refino[k] || 0) > 0);
  const baseStats = sheet.baseStats || {};
  const hasBase = STAT_ROWS.some(([k]) => (baseStats[k] || 0) > 0);

  const lines: string[] = [
    `# ${speciesName} — ficha do PokeIdle`,
    "",
    "Ficha de um pokemon do PokeIdle, um MMO idle de pokemon. Os números são os do jogo, que tem regras próprias: use a regra de cálculo do fim desta ficha, e não a dos jogos oficiais.",
    "",
    "## O pokemon",
    "",
    `- Espécie: ${speciesName}${idStr}${tiposStr}`,
  ];

  if (sheet.apelido && sheet.apelido !== speciesName) {
    lines.push(`- Apelido: ${sheet.apelido}`);
  }

  lines.push(
    `- Shiny: ${sheet.shiny ? "sim" : "não"}`,
    `- Nível: ${sheet.level}`,
    `- Potência: ${potDesc}`,
    `- Qualidade: ${qVal.toFixed(3)} (melhor que ${qPct}% dos nascimentos)`,
    `- IV somado: ${sheet.ivSoma} de 192`,
    `- Nota da Calculadora: ${sheet.nota.toFixed(3)} de 10 (${tierLabel})`,
    `- Poder (⚔): ${mainPower > 0 ? mainPower.toLocaleString("pt-BR") : "—"}`
  );

  if (sheet.pvpPower > 0 && sheet.pvpPower !== mainPower) {
    lines.push(
      `- Poder PvP (Arena Lv ${sheet.pvpLevel || sheet.level}): ${sheet.pvpPower.toLocaleString("pt-BR")}`
    );
  }
  if (sheet.alcance > 0) {
    lines.push(
      `- Alcance PvP: ${sheet.alcance} (${sheet.alcance <= 1 ? "corpo a corpo" : "distância"})`
    );
  }
  lines.push(
    `- HP de combate: ${combatHp.toLocaleString("pt-BR")} (o HP do stat × 12)`,
    "",
    "## Stats",
    ""
  );

  // Build Stats Markdown Table
  const headers = ["Stat"];
  const seps = ["---"];
  if (hasBase) {
    headers.push("Base da espécie");
    seps.push("---");
  }
  if (hasRefino) {
    headers.push("Refino");
    seps.push("---");
  }
  headers.push("IV (1–32)", `Stat atual (nível ${sheet.level})`);
  seps.push("---", "---");

  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`|${seps.join("|")}|`);

  let totalBase = 0;
  let totalRef = 0;
  let totalIv = 0;
  let totalStat = 0;

  for (const [k, label] of STAT_ROWS) {
    const b = baseStats[k] || 0;
    const rf = refino[k] || 0;
    const iv = sheet.ivs?.[k] || 0;
    const st = sheet.stats?.[k] || 0;
    totalBase += b;
    totalRef += rf;
    totalIv += iv;
    totalStat += st;

    const cols: string[] = [label];
    if (hasBase) cols.push(String(b));
    if (hasRefino) cols.push(rf > 0 ? `+${rf}` : "0");
    cols.push(String(iv), String(st));
    lines.push(`| ${cols.join(" | ")} |`);
  }

  const totalCols: string[] = ["Total"];
  if (hasBase) totalCols.push(String(totalBase));
  if (hasRefino) totalCols.push(totalRef > 0 ? `+${totalRef}` : "0");
  totalCols.push(String(totalIv), String(totalStat));
  lines.push(`| ${totalCols.join(" | ")} |`);

  lines.push(
    "",
    "## TMs e Z-Move",
    "",
    `- Z-Move: ${sheet.tmElemental ? sheet.tmElemental : "nenhum (sem TM elemental)"}`,
    `- TM AoE: ${sheet.tmAoe ? "sim" : "não"}`
  );

  if (sheet.evolucoes && sheet.evolucoes.length > 0) {
    lines.push("", "## Evoluções projetadas", "");
    for (const evo of sheet.evolucoes) {
      const evoTier = GRADE_TIER_LABEL[evo.faixa] || evo.faixa;
      lines.push(
        `- ${evo.nome}: Nota ${evo.nota.toFixed(2)} (${evoTier}) · Poder PvP ${evo.pvpPower.toLocaleString("pt-BR")} · Alcance ${evo.alcance}`
      );
    }
  }

  if (listing) {
    const moedaLabel = listing.moeda === "orb" ? "Gemas" : "Gold";
    lines.push(
      "",
      "## Anúncio no Mercado",
      "",
      `- Anúncio: #${listing.id}`,
      `- Vendedor: ${listing.vendedor || "?"}`,
      `- Preço: ${listing.preco.toLocaleString("pt-BR")} ${moedaLabel}`
    );
  }

  lines.push(
    "",
    "## Como o jogo calcula",
    "",
    "- Stat = (base + refino + 2 × IV) × (nível ÷ 100) × qualidade^expoente × potência × shiny × lendário",
    "- Expoente da qualidade: 0.95 no HP e no SPD; 0.8 no ATK, DEF, SP.ATK e SP.DEF",
    "- Potência: P1 ×1 · P2 ×1.05 · P3 ×1.1 · P4 ×1.25 · P5 ×2",
    "- Shiny: ×3 em todos os stats",
    "- Lendário ou Mítico: ×4 em todos os stats (vale pela espécie)",
    "- IV: de 1 a 32 em cada stat (6 a 192 somados) · Qualidade: de 0.8 a 1.8",
    '- O refino é o "+N" comprado com pedras: soma na base, antes do IV e de todo multiplicador.',
    "- A Nota da Calculadora vai de 0 a 10 DENTRO da espécie: 0 é o pior nascimento possível dela, 10 é P5 + shiny + IV máximo. Evoluir nunca baixa a nota. Lendário não tem nota."
  );

  return lines.join("\n");
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
