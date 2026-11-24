# Roadmap — PokeMngr

Documento vivo de evolução do **PokeMngr** (Wails v3 · Go + React + TypeScript), combinando as features do `pokeidle-manager-online` e do `pokeidleDeck` num app desktop leve na bandeja do sistema (com opção de servidor headless para VPS).

---

## Status Atual (Já Implementado)

- [x] **Fundação Desktop & Bandeja:** Wails v3, System Tray com menu e status de contas online, `SingleInstance`, minimizar para bandeja ao fechar, SQLite pure-Go (`modernc.org/sqlite`, `CGO_ENABLED=0`).
- [x] **Motor WebSocket PokéIdle:** até 4 contas simultâneas, proxy SOCKS5/HTTP individual com teste de IP, renovação automática de token, cooldown de login externo (`4001`), detecção de bloqueio e watchdog de 150s.
- [x] **Bridge WS (Caminho 1) + Deck Visual:** reverse proxy local same-origin (`127.0.0.1`) sem erro de CSP ou `4001`, visualização embutida em Grade/Colunas/Foco/Zoom e popout em janela separada.
- [x] **Dashboard & Automações Core:** 4 estilos de card, drag-to-reorder, troca rápida de Poção/Pokébola com ícones oficiais, auto-catch FIFO, recompra avançada (piso de ouro, histerese, melhor custo-benefício/HP, Golden Potion, Revives, `potionFirst`), rastreador de shinies e itens raros da sessão.
- [x] **Mapa & Melhores Hunts:** 11 regiões, Outland Tiers (1–8), filtros de efetividade, fila pós-combate (`centroLivreEm`), simulador PokéIdle Guide (`pokeidleguide.io`) por **XP/h** e **Ouro/h**, sprites completos via `marker-atlas.webp` + `creatures*.json`.
- [x] **Inventário & Ficha Pokémon:** itens com nomes e ícones reais (`items.json` + `items-icons.json` + Z-Moves), lista filtrável/ordenável, venda Depot, radar IV hexagonal e Nota de Nascença (0–10).
- [x] **Passe de Batalha (30 dias):** trilha Grátis + VIP, virada meia-noite de Brasília, resgate individual e em lote.
- [x] **Chat Unificado (PT-BR):** `#mundo`, `#comercio`, `#duvidas` em tempo real com proteção contra links/spam.
- [x] **Mercado & Sniper (Itens):** preços + média 7d + selo "Barato", Vitrine Pokémon com sprites, Histórico/Tape, Analytics via `pokeidleguide.io`, carteira Gemas (somente leitura), calculadora de comissão, alertas Discord e Sniper multi-conta (`compravelEm + 20ms`).
- [x] **PvP:** auto-fila (VIP e não-VIP), editor visual de time no tabuleiro de 30 casas, Top 1.000 semanal e Top 2.000 mensal.
- [x] **Lives Twitch/Kick (Base):** sincronização de streamers oficiais via WS, alocação de 2 vagas por site com cobertura (Stand-In), players ocultos/mutados (`visible.js`), login e página de pontos.
- [x] **Servidor Headless VPS (Base):** pacote isolado (`internal/server` + `cmd/server`) compilando para Linux (`CGO_ENABLED=0`).
- [x] **Polimento Desktop & Notificações (Nível 1):** ícone próprio (`build/appicon.png`, `icon.ico`, `icons.icns`, `icon.svg`), Autostart nativo do Windows (`app.Autostart`), toggles ao vivo de **ULTRA** e **Menos animações** na barra do Deck (via `postMessage` + `CSSMediaRule`), relatório diário automático (`dailyReportHour`/`reportTz`) + alertas de queda prolongada e retorno no Discord, e indicador de consumo de RAM (Go + processos filhos WebView2) no rodapé da sidebar.

---

## Próximas Features — Rankeadas por Ordem de Dificuldade

> Escala de dificuldade: **1 (Trivial)** → **5 (Complexa / Alto risco técnico)**

### Nível 1 — Fácil (Quick Wins) — ✅ Concluído

| # | Feature | Status | Dificuldade | Impacto | Origem | Escopo Técnico |
|---|---|---|---|---|---|---|
| 1 | **Ícone próprio do app (janela, bandeja e executável)** | ✅ | ★☆☆☆☆ (1/5) | Médio | Desktop | Substituir `build/appicon.png` e `build/windows/icon.ico` por arte própria do PokeMngr e regerar `.syso`. |
| 2 | **Iniciar com o Windows (Autostart)** | ✅ | ★☆☆☆☆ (1/5) | Alto | Desktop | Usar suporte nativo do Wails v3 (`app.Autostart`) + toggle em `SettingsView.tsx`. |
| 3 | **Toggle em tempo real de ULTRA e Menos Animações na barra do Deck** | ✅ | ★☆☆☆☆ (1/5) | Médio | `pokeidleDeck` | Enviar `postMessage` para os iframes do Deck alternarem `cfg-ultra` (`#btn-config`/`#cfg-ultra`/`#ultra-sair`) e `matchMedia`/`CSSMediaRule` sem precisar reabrir o Deck. |
| 4 | **Relatório diário automático + alertas de queda/volta no Discord** | ✅ | ★★☆☆☆ (2/5) | Alto | `manager-online` | Agendador em Go usando `dailyReportHour` + `reportTz` lendo `daily_state` do SQLite na virada do dia; timer configurável (`downAlertDelaySec`, padrão 120s) em `connection.go` para notificar quedas prolongadas e retorno. |
| 5 | **Indicador de consumo de RAM no rodapé** | ✅ | ★★☆☆☆ (2/5) | Baixo | `pokeidleDeck` | Coletar uso de memória do processo Go + processos filhos WebView2 via Win32/PSAPI (`internal/sysmem`) a cada 5s e exibir no rodapé da sidebar. |

---

### Nível 2 — Média

| # | Feature | Dificuldade | Impacto | Origem | Escopo Técnico |
|---|---|---|---|---|---|
| 6 | **Valoração do Inventário (Gemas / USD)** | ★★☆☆☆ (2/5) | Médio | `manager-online` | Cruzar inventário multi-conta (itens raros + shinies) com médias 7d do mercado e cotação da Gema (`orbs.painel`), exibindo card resumo em `InventoryView.tsx`. |
| 7 | **Gráficos de Mercado (histórico 7d/30d, inflação e movers)** | ★★★☆☆ (3/5) | Médio | `manager-online` | Consumir `/api/mercado/serie` e campos `inflacao` / `maioresAltas` / `maioresQuedas` do `pokeidleguide.io` + renderizar gráficos SVG leves em `MarketView.tsx`. |
| 8 | **Chat clicável (Ficha Pública + Anúncio de Mercado)** | ★★★☆☆ (3/5) | Médio | `manager-online` | Implementar waiter WS para `chat.verPokemon` → `ranking.ficha` e `market.anuncio`; tornar nomes de Pokémon e anúncios clicáveis em `ChatView.tsx` abrindo o modal de Ficha ou Compra. |
| 9 | **Ficha Pokémon completa (Evoluções ramificadas + Poder PvP/PvE)** | ★★★☆☆ (3/5) | Médio | `manager-online` | Portar tabela de evoluções ramificadas (`evolucoes_ramificadas.py`) e cálculo exato de Poder PvP (achatamento de arena `150*(lv/150)^0.45`), Poder PvE e alcance no tabuleiro (1–4) em `calc.go` / `pvp.go`. |
| 10 | **Sniper & Alertas de Mercado para Pokémon + % abaixo da média** | ★★★☆☆ (3/5) | Alto | `manager-online` | Estender `MarketService.tickRules` para consultar `market.listar` com filtros (espécie, shiny, IV mín, nível mín, P5, Z-Move), gatilho por `%` abaixo da média 7d e alerta de venda de item raro acima da média (`+30%`). |
| 11 | **Eco de cliques entre contas no Deck + Extensão `/hunt`** | ★★★☆☆ (3/5) | Médio | `pokeidleDeck` | Injetar `echo.js` no proxy local `/app` comunicando via `postMessage` com `DeckView.tsx` para replicar cliques entre iframes (opt-in); loader opcional do `.xpi` `/hunt for PokeIdle` com ponte para `/api/wishlist`. |
| 12 | **Auto-updater + Instalador Windows (NSIS)** | ★★★☆☆ (3/5) | Médio | `manager-online` | Checar GitHub Releases, validar SHA-256 e disparar instalador NSIS silencioso via `Taskfile.yml` + GitHub Actions workflow. |

---

### Nível 3 — Alta

| # | Feature | Dificuldade | Impacto | Origem | Escopo Técnico |
|---|---|---|---|---|---|
| 13 | **Janela de Login embarcada (captura automática de sessão)** | ★★★★☆ (4/5) | Alto | `manager-online` | Abrir janela WebView2 isolada/incógnito em `https://pokeidle.io/app` (sem misturar cookies/sessões), pollar `localStorage.getItem('sessao')` e `id-dispositivo`, fechar automaticamente ao logar e pré-preencher o cadastro da conta. |
| 14 | **Modo VPS completo (Painel Web + Auth + API completa)** | ★★★★☆ (4/5) | Médio | `manager-online` | Embutir `frontend/dist` em `cmd/server`, adicionar camada de transporte HTTP/WS no `frontend/src/lib/api.ts` (fallback quando fora do Wails), autenticação por senha (`scrypt` + cookie HttpOnly + rate-limit) e espelhar todas as rotas (Mapa, Inventário, Mercado, PvP, Passe, Chat) em `internal/server`. |

---

### Nível 4 — Muito Alta (Maior Complexidade Técnica)

| # | Feature | Dificuldade | Impacto | Origem | Escopo Técnico |
|---|---|---|---|---|---|
| 15 | **Lives Twitch/Kick — Multi-conta isolado + Automação completa de Pontos & Baú** | ★★★★★ (5/5) | Alto | `pokeidleDeck` | Criar host nativo Win32/WebView2 COM em Go (`internal/lives/webview2_windows.go`) com `UserDataFolder` separado por conta (já que o Wails v3 usa um único `WebviewUserDataPath` global). Inclui: flags anti-throttling do Chromium, bloqueio de anúncios via `WebResourceRequested`, leitura de cookies HttpOnly (`ICoreWebView2CookieManager`), login Twitch anti-Kasada via CDP `Network.setUserAgentOverride` + controller limpo, loop automático de leitura de saldo/baú +50 (Twitch GQL + `/integrity` e Kick API v2), resgate automático de pacotes (1h/3h/5h/10h) e detecção de reembolso. |

---

## Sugestão de Ordem de Execução

1. **Bloco Rápido (Polimento & Discord):** `#2` (Autostart) + `#4` (Relatório diário & queda/volta Discord) + `#3` (ULTRA/Animações ao vivo no Deck) + `#1` (Ícone próprio).
2. **Bloco Gameplay & Mercado:** `#10` (Sniper/Alertas Pokémon + % média) + `#9` (Evoluções & Poder PvP) + `#8` (Chat clicável) + `#6`/`#7` (Valoração & Gráficos).
3. **Bloco UX de Contas & Lives:** `#13` (Janela de Login embarcada) → `#15` (WebView2 isolado por conta + automação completa de pontos Twitch/Kick).
4. **Bloco Distribuição & VPS:** `#12` (Instalador + Updater) e `#14` (VPS completo).
