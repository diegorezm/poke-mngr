# AGENTS.md — PokeMngr

Guia completo de arquitetura, diretrizes e boas práticas para agentes de IA trabalhando neste repositório.

---

## 1. Visão Geral e Estrutura do Repositório

- **Backend / Desktop:** Go + Wails v3 (`main.go`, `internal/`, `cmd/server/`), SQLite pure-Go (`CGO_ENABLED=0` via `modernc.org/sqlite`).
- **Frontend (`frontend/`):** React 18 + TypeScript + Vite 8 (Rolldown) + Tailwind CSS v4 + `@headlessui/react` + **React Compiler** (`babel-plugin-react-compiler`).
- **Bindings Wails:** `frontend/bindings/` é gerado automaticamente — **nunca edite manualmente**.
- **Idioma da UI:** Português (PT-BR).
- **Commits:** Conventional Commits (`feat(ui): ...`, `fix(backend): ...`, `refactor(frontend): ...`, `docs: ...`, `chore(...): ...`).
- **Pastas ignoradas / auxiliares:** `mocks/`, `.refs/`, `bin/`, `frontend/dist/` estão no `.gitignore` e não devem ser commitadas.

### Mapa de Pacotes

| Caminho | Responsabilidade |
| --- | --- |
| `main.go` | Inicialização do app desktop Wails v3, system tray, single-instance e shutdown gracioso. |
| `cmd/server/main.go` | Modo servidor headless (Linux/VPS/Docker) sem dependência de GUI. |
| `internal/config/` | Constantes, paths de dados (`%LOCALAPPDATA%\PokeMngr`), tipos de conta, proxy e configurações globais. |
| `internal/store/` | Persistência SQLite pure-Go (contas, sessões, stats diários, mercado, lives). |
| `internal/pokeidle/` | Conexões WebSocket com PokéIdle (`connection.go`), gerenciador (`manager.go`), automações (`hunt.go`, `balls.go`, `shop.go`, `pvp.go`), bridge local do Deck (`bridge.go`), mercado/sniper (`market.go`), catálogos/sprites (`sprites.go`), chat, inventário, fichas, Discord (`notify.go`, `daily_report.go`) e extensão `/hunt` (`hunt_ext.go`). |
| `internal/lives/` | Central de lives (Twitch & Kick), status ao vivo e alocação de slots. |
| `internal/service/` | Camada RPC exposta ao frontend via Wails (`AppService`). |
| `internal/updater/` | Verificação de Releases no GitHub, validação SHA-256 e instalador silencioso NSIS no Windows. |
| `internal/sysmem/` | Coleta leve de memória do sistema / processo. |
| `frontend/src/` | Interface React, tema Pokédex (`index.css`), primitivas Headless UI (`components/DsPrimitives.tsx`) e views. |

---

## 2. Comandos Úteis

> **Windows PowerShell 5.1:** use `;` em vez de `&&` para encadear comandos.

```powershell
# Validar tipos TypeScript e build de produção do frontend (com React Compiler)
cd frontend; npm run build

# Validar backend Go (vet, testes e compilação pure-Go)
$env:CGO_ENABLED="0"; go vet ./...
$env:CGO_ENABLED="0"; go test -count=1 ./internal/...
$env:CGO_ENABLED="0"; go build . ./cmd/server ./internal/...

# Rodar app desktop em desenvolvimento (Wails v3 + Vite)
wails3 dev
# ou via Taskfile:
task dev
```

> **Nota sobre `go build ./...`:** o diretório `build/ios/` contém arquivos de scaffold mobile do Wails com build tags específicas. Para compilar o projeto no desktop/CI, use `go build . ./cmd/server ./internal/...`.

---

## 3. Diretrizes do Backend Go

### Concorrência e Locks (`sync.RWMutex` / `sync.Mutex`)

1. **Nunca faça lock reentrante:** `sync.RWMutex` em Go **não é reentrante**. Nunca chame helpers que adquiram `ac.mu.RLock()` ou `ac.mu.Lock()` (nem callbacks como `hunt.OnKill` ou `ac.ServerNowMs()`) enquanto já estiver segurando `ac.mu`. Leia os campos diretamente sob o lock já adquirido ou libere o lock antes de chamar o helper.
2. **Zero I/O sob `ac.mu.Lock()`:** nunca execute escritas em SQLite (`store.*`), chamadas HTTP ou envios ao Discord (`notifier.Send`) enquanto segura `ac.mu.Lock()`. Extraia o snapshot/valores sob lock, dê `Unlock()` e só então persista ou notifique.
3. **Nunca exponha mapas/slices mutáveis fora do lock:**
   - Em `Snapshot()`, `BuildInventory()`, `lives.Manager.State()` e `automationLoop`, sempre faça clone (`deepCloneMap` ou cópia explícita do mapa) antes de soltar o lock. Expor uma referência viva para o serializador JSON do Wails causa `fatal error: concurrent map iteration and map write`.
4. **Não chame `c.Snapshot()` enquanto segura `mgr.mu.RLock()`:** use `c.IsOnline()` e `mgr.PickOnlineConnection(preferredID)` para verificar status de conexão sem alocar telemetria completa nem aninhar locks pesados.
5. **Envios em canais de resposta não devem bloquear o loop de leitura WS:** use sempre `select { case ch <- v: default: }` e limpe referências de canais de espera (`saveCh`, `ladderCh`, `monthlyCh`, `pendingSell`) via `defer` ou método dedicado (`ShopManager.CancelSell`) em erros, timeouts e `ctx.Done()`.

### Rede, Recursos e Shutdown

- **Feche conexões ociosas de clientes HTTP efêmeros:** sempre use `defer client.CloseIdleConnections()` quando criar um `*http.Client` via `BuildHTTPClient` (`ProbeExitIP`, `ProbeAccount`, `connectOnce`).
- **Catálogos compartilhados (`ItemCatalog`, `CreatureCatalog`):** reutilize um `*http.Client` na struct e proteja recargas com `loadMu sync.Mutex` (double-check) para evitar *thundering herd*.
- **Caches em memória:** todo cache ou mapa de deduplicação em serviços de longa duração (`MarketService`, `SpriteProxy`) deve ter TTL e limpeza periódica (`pruneCaches`) ou limite máximo de entradas.
- **Shutdown gracioso:** ao encerrar uma `AccountConnection` com `ctx.Err() != nil`, use `ws.CloseNow()` em vez de handshake bloqueante `ws.Close()`, e mantenha timeout no aguardo de `<-ac.done` em `Stop()` para nunca travar o fechamento da janela do app.
- **Sempre verifique `resp.StatusCode == http.StatusOK`** antes de decodificar JSON de APIs externas e limite leituras com `io.LimitReader` quando apropriado.

### SQLite (`internal/store`)

- Sempre manter `CGO_ENABLED=0` (`modernc.org/sqlite`), `journal_mode(WAL)`, `synchronous(NORMAL)`, `busy_timeout(5000)`, `foreign_keys(ON)` e `db.SetMaxOpenConns(1)`.
- Prefira queries diretas com `WHERE` (ex.: `GetAccount(id)`) em vez de carregar listas completas para filtrar em memória.

---

## 4. Diretrizes do Frontend — UI, Design System e WebView2

### Identidade Visual (Pokédex Red + Smoked Carbon)

- **Temas oficiais:** **Pokédex Red Edition** (Light) e **Smoked Carbon** (Dark), definidos via CSS variables em `frontend/src/index.css`.
- **Tipografia:** `Space Grotesk` para textos e títulos, `JetBrains Mono` para números, métricas, preços, IVs, timers e logs (`frontend/index.html`).
- **Tokens semânticos obrigatórios:** sempre utilize as classes e tokens do design system (`ds-card`, `ds-btn-*`, `ds-modal`, `ds-input`, `var(--ink-*)`, `var(--surface-*)`, `var(--border-*)`). Nunca fixe cores que só funcionam no dark mode (como `text-white` sobre fundo sem surface escura ou `bg-zinc-900` hardcoded sem suporte ao modo claro).

### Regras Críticas do Wails v3 / WebView2

- **NUNCA use `window.confirm()`, `window.alert()` ou `window.prompt()`:** no WebView2 do Wails v3, diálogos nativos do browser são bloqueados/suprimidos silenciosamente (`window.confirm` retorna `false` sem abrir nada), quebrando ações como exclusão de contas.
- **Use sempre os componentes de `frontend/src/components/DsPrimitives.tsx`** baseados em `@headlessui/react`:
  - `DsConfirmDialog` para confirmações (principalmente ações destrutivas como deletar conta, vender depósito, etc.);
  - `DsModal` para formulários de criação/edição e inspeções detalhadas;
  - `DsToast` para feedbacks rápidos.

---

## 5. Frontend — React Compiler (100% Cobertura, 0 Bailouts)

O **React Compiler** está configurado em `frontend/vite.config.ts` via `@rolldown/plugin-babel` + `reactCompilerPreset({ target: "18" })` e runtime `react-compiler-runtime`. Todo o código em `frontend/src/` é compilado com **100% de cobertura (0 bailouts)** — mantenha esse padrão ao criar ou editar componentes e hooks.

### 1. Não use memoização manual desnecessária

- **NÃO use `useMemo`** para derivar listas, filtros, ordenações, `Map`s ou objetos no render. Escreva o cálculo direto no corpo do componente; o compilador memoiza automaticamente.
- **NÃO use `useCallback`** apenas para estabilizar referências de handlers passados como props ou usados em JSX.
- **NÃO envolva componentes em `React.memo`** preventivamente.
- **Exceções raras:** só recorra a `useMemo`/`useCallback` se houver requisito semântico explícito de integração externa (ou custo comprovado fora do alcance do compilador) e documente o motivo em comentário breve.

### 2. Regras do React e Pureza

- **Render puro:** não chame `Date.now()`, `Math.random()` nem leia/escreva `.current` de refs durante o render. Passe timestamps via props (ex.: `serverTimeMs`) ou use efeitos/timers.
- **Imutabilidade:** nunca mute props, state ou valores retornados por hooks.
- **Isole timers frequentes (1Hz):** se apenas um contador visual precisa atualizar a cada segundo, extraia um subcomponente pequeno (ex.: `ResetCountdown` em `PassView.tsx`) em vez de colocar `setInterval` no topo de uma view grande.
- **Dependências de `useEffect`:** extraia expressões complexas (como `accounts.map(...).join(",")`) para uma `const` antes do `useEffect`.

### 3. Evite padrões que causam *bailout* no `babel-plugin-react-compiler` v1.0

O compilador pula silenciosamente (sem falhar o build) componentes/hooks que contenham algumas construções ainda não suportadas pelo HIR atual. Evite dentro de componentes e hooks:

1. **`try / finally`:** quando o `catch` não relança o erro, prefira `try { ... } catch (e) { ... }` seguido da limpeza (`setBusy(false)`) logo após o bloco.
2. **Value blocks dentro de `try`:** evite ternários (`?:`), operadores lógicos (`&&`, `||`, `??`) e optional chaining (`?.`) dentro de blocos `try`. Calcule valores/payloads antes do `try` ou delegue normalização/formatação para helpers puros no nível de módulo.
3. **Chaves computadas não-identificador em objetos:** em `{ [expr]: val }`, extraia `const key = ...;` antes de montar o objeto (evite `{ [String(id)]: v }` ou `{ [ev.canal!]: v }`).
4. **Update expressions (`x++`) capturadas por closures:** extraia loops/cálculos mutáveis para helpers puros fora do componente.

### 4. Atenção à versão do Babel

- **Mantenha `@babel/core` na v7 (`^7.29.0`) + `@types/babel__core`.**
- Não atualize `@babel/core` para v8 enquanto `babel-plugin-react-compiler` usar `@babel/types` v7 — no Babel 8, `AssignmentPattern` deixa de ser reconhecido como `LVal`, causando bailout em componentes com props default desestruturadas (`{ size = 48 }`).

---

## 6. Checklist Antes de Finalizar Alterações

- [ ] **Frontend alterado:** rodar `cd frontend; npm run build` (sem erros de TypeScript e mantendo 0 bailouts no React Compiler) e verificar ambos os temas (**Light** e **Dark**).
- [ ] **Backend alterado:** rodar `$env:CGO_ENABLED="0"; go vet ./...`, `go test -count=1 ./internal/...` e `go build . ./cmd/server ./internal/...`.
- [ ] **Novos bugs de concorrência ou regras críticas:** adicionar teste de regressão em `*_test.go`.
- [ ] **Não editar `frontend/bindings/` manualmente** e não commitar arquivos temporários (`mocks/`, `.refs/`).
