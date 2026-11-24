# AGENTS.md — PokeMngr

Guia para agentes de IA trabalhando neste repositório.

## Visão Geral do Projeto

- **Backend / Desktop:** Go + Wails v3 (`main.go`, `internal/`, `cmd/server/`), SQLite pure-Go (`CGO_ENABLED=0`).
- **Frontend (`frontend/`):** React 18 + TypeScript + Vite 8 (Rolldown) + Tailwind CSS v4 + **React Compiler** (`babel-plugin-react-compiler`).
- **Bindings Wails:** `frontend/bindings/` é gerado automaticamente — não edite manualmente.
- **Idioma da UI:** Português (PT-BR).
- **Commits:** Conventional Commits (`feat(ui): ...`, `fix(...): ...`, `refactor(frontend): ...`, `chore(...): ...`).

### Comandos Úteis

```bash
# Validar tipos e build de produção do frontend
cd frontend && npm run build

# Dev desktop (Wails + Vite)
wails3 dev
```

---

## Frontend: React Compiler Está Ativo

O **React Compiler** está configurado em `frontend/vite.config.ts` via `@rolldown/plugin-babel` + `reactCompilerPreset({ target: "18" })` e runtime `react-compiler-runtime`. Todo o código em `frontend/src/` é compilado com **100% de cobertura (0 bailouts)** — mantenha esse padrão ao criar ou editar componentes e hooks.

### 1. Não use convenções antigas de memoização manual

Com o React Compiler ativo, memoização manual vira boilerplate desnecessário:

- **NÃO use `useMemo`** para derivar listas, filtros, ordenações, `Map`s ou objetos no render. Escreva o cálculo direto no corpo do componente; o compilador memoiza automaticamente com granularidade de expressão/bloco.
- **NÃO use `useCallback`** apenas para estabilizar referências de handlers passados como props ou usados em JSX. Funções normais e handlers inline (`onClick={() => ...}`) já são memoizados pelo compilador.
- **NÃO envolva componentes em `React.memo`** preventivamente.
- **Exceções raras:** só recorra a `useMemo`/`useCallback` se houver um requisito semântico explícito de integração externa (ou efeito comprovadamente caro fora do alcance do compilador) e documente o porquê em um comentário breve.

### 2. Regras do React e Pureza

O compilador pressupõe código compatível com as Rules of React:

- **Render puro:** não chame `Date.now()`, `Math.random()` nem leia/escreva `.current` de refs durante o render. Passe timestamps via props (ex.: `serverTimeMs` do snapshot de telemetria) ou use efeitos/timers.
- **Imutabilidade:** nunca mute props, state ou valores retornados por hooks.
- **Isole timers frequentes (1Hz):** se apenas um contador visual precisa atualizar a cada segundo, extraia um subcomponente pequeno (ex.: `ResetCountdown` em `PassView.tsx`) em vez de colocar `setInterval` no topo de uma view grande.
- **Dependências de `useEffect`:** extraia expressões complexas (como `accounts.map(...).join(",")`) para uma `const` antes do `useEffect`.

### 3. Evite padrões que causam *bailout* no `babel-plugin-react-compiler` v1.0

O compilador pula silenciosamente (sem falhar o build) componentes/hooks que contenham algumas construções ainda não suportadas pelo HIR da versão atual. Evite dentro de componentes e hooks:

1. **`try / finally`:** quando o `catch` não relança o erro, prefira `try { ... } catch (e) { ... }` seguido da limpeza (`setBusy(false)`) logo após o bloco.
2. **Value blocks dentro de `try`:** evite ternários (`?:`), operadores lógicos (`&&`, `||`, `??`) e optional chaining (`?.`) dentro de blocos `try`. Calcule valores/payloads antes do `try` ou delegue normalização/formatação para funções puras no nível de módulo.
3. **Chaves computadas não-identificador em objetos:** em `{ [expr]: val }`, extraia `const key = ...;` antes de montar o objeto (evite `{ [String(id)]: v }` ou `{ [ev.canal!]: v }`).
4. **Update expressions (`x++`) capturadas por closures:** extraia loops/cálculos mutáveis para helpers puros fora do componente.

### 4. Atenção à versão do Babel

- **Mantenha `@babel/core` na v7 (`^7.29.0`) + `@types/babel__core`.**
- Não atualize `@babel/core` para v8 enquanto `babel-plugin-react-compiler` usar `@babel/types` v7 — no Babel 8, `AssignmentPattern` deixa de ser reconhecido como `LVal`, fazendo qualquer componente com props default desestruturadas (`{ size = 48 }`) dar bailout.

### 5. Checklist ao editar o frontend

- Rode `cd frontend && npm run build` para garantir `tsc` limpo e bundle Vite sem erros.
- Prefira helpers puros no nível de módulo (ou em `frontend/src/lib/`) para formatação, normalização de respostas da API e lookups (`Map` em vez de `.find()` repetido dentro de loops de render).
- Mantenha helpers de atualização de estado aninhado (ex.: `updateRestock` em `SettingsView.tsx`) em vez de duplicar spreads profundos no JSX.
