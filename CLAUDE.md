# CLAUDE.md — регламент проекта Grok Desktop

Файл читается user_layer'ом Grok Desktop и Claude Code как «правила работы с этим проектом». См. `electron/ai/user-layer.ts` — порядок поиска: AGENTS.md → CLAUDE.md → GEMINI.md → .verstak/RULES.md.

---

## 1. Что это за проект

**Grok Desktop** — десктопный AI coding agent только для Grok (xAI). Electron + TypeScript + React + Zustand + better-sqlite3. Урезанный форк Verstak: оставлены два провайдера и три коннектора, всё остальное ядро (агентный цикл, память, скиллы, артефакты) сохранено.

**Ключевая ценность:** контроль, прозрачность, локальность.

**Базовые фичи:**
- **2 провайдера:** Grok API (xAI, key `xai_api_key`) + Grok Build (CLI `grok`). Реестр — `electron/ai/registry.ts`.
- **5 режимов агента** (`ask` / `accept-edits` / `plan` / `auto` / `bypass`) — переключаются 1-5.
- **Per-chat модель.** Multi-chat со снапшотами фоновых стримов.
- **Сессионный checkpoint + per-file undo.** Откат любой агентной сессии одной кнопкой.
- **Cost controller** в статус-баре.
- **Context sliding window** для длинных сессий (старые tool results сжимаются в маркеры).
- **Exponential backoff** на 429/503/ECONNRESET.
- **Skills как first-class.** Frontmatter `.md` файлы → system prompt + tools_allow. Авто-импорт из `~/.claude/skills/` + `~/.verstak/skills/` + built-in. Slash commands в composer.
- **Artifacts:** `generate_html` / `generate_docx` / `render_chart` (SVG bar/line/pie). Embedded preview.
- **3 коннектора:** GitHub, generic HTTP, SSH executor (с denylist).
- **Память:** core memory (MEMORY.md/USER.md в `.verstak/`), archival facts, conversation search, handoff.

---

## 2. Архитектура — карта

```
electron/                  ← main process (Node.js)
├── main.ts                ← entry: window, IPC регистрация, db open (grok-desktop.db)
├── preload.ts             ← contextBridge: window.api для renderer
├── ai/                    ← провайдеры + ядро агентной логики
│   ├── skills/              ← skill loader + frontmatter + built-in
│   ├── artifacts.ts         ← generate_html / generate_docx (docx npm)
│   ├── charts.ts            ← render_chart — SVG bar/line/pie без зависимостей
│   ├── registry.ts          ← 2 провайдера: grok | grok-cli
│   ├── types.ts             ChatMessage / ChatEvent / ChatProvider
│   ├── grok.ts              ← API-провайдер (xAI)
│   ├── grok-cli.ts          ← CLI-провайдер (Grok Build)
│   ├── cli-prompt.ts        ← serializer истории для CLI
│   ├── compose-system.ts    ← единый сборщик system prompt
│   ├── system-layer.ts      ← неизменяемый протокол агента
│   ├── user-layer.ts        ← поиск AGENTS/CLAUDE/GEMINI.md/RULES
│   ├── context-pack.ts      ← Recent writes + project map в контекст
│   ├── compact-history.ts   ← sliding window для tool results
│   ├── with-retry.ts        ← exponential backoff
│   ├── tools.ts             ← read_file/write_file/apply_patch/run_command/...
│   ├── mode-policy.ts       ← decide(): confirm/auto-accept/block по mode
│   ├── path-policy.ts       ← safeRealJoin: anti symlink escape
│   ├── secret-scanner.ts    ← redact API keys / tokens в logs
│   ├── core-memory.ts, memory-hooks.ts, procedural-memory.ts ← память
│   ├── handoff.ts, session-summary.ts, session-journal.ts ← сессии
│   └── child-kill.ts        ← treeKill через taskkill /F /T на Windows
├── ipc/                   ← IPC handlers (ai, chats, undo, files, projects,
│                            settings, terminal, memory, skills, mcp, ...)
├── mcp/                   ← MCP client
├── storage/               ← sqlite слой (db.ts: openDb + MIGRATIONS)
└── connectors/            ← внешние сервисы — 3 шт
    ├── registry.ts, types.ts
    ├── github.ts            ← GitHub REST API
    ├── http.ts              ← generic REST
    └── ssh.ts               ← SSH executor через системный ssh (denylist)

src/                      ← renderer (React 19)
├── App.tsx                ← composition root + Onboarding + Toast + Preview
├── store/                 ← zustand (projectStore + skillStore)
├── components/            ← UI компоненты
├── hooks/                 ← useProvider / useAgentMode / useTheme
├── lib/                   ← pricing, context-budget, ...
├── styles/                ← layout / theme / markdown CSS
└── types/api.d.ts         ← типы для window.api (bridge типизация)

tests/                    ← vitest (ai, storage, connectors, lib, agent-bench)
```

---

## 3. Команды

```bash
npm run dev          # запуск в dev (electron-vite + HMR)
npm run build        # build в out/
npm run type         # tsc --noEmit
npm run test:fast    # vitest run (без rebuild native)
npm run test         # rebuild better-sqlite3 + vitest (full)
npm run dist:win     # NSIS + portable .exe
```

**Перед коммитом обязательно:** `npm run type && npm run test:fast`. Если type-check падает — НЕ коммитим.

**Известный шум в тестах:** sqlite-тесты могут падать по `NODE_MODULE_VERSION` — это better-sqlite3 скомпилирован под Electron, а vitest идёт под Node. НЕ путать с реальными регрессиями.

---

## 4. Зоны файлов и правила

| Зона | Можно | НЕЛЬЗЯ |
|---|---|---|
| `electron/ai/` | тулзы, helpers | менять `system-layer.ts` (immutable протокол) |
| `electron/ipc/` | новые IPC handlers | менять контракт существующих без обновления preload + api.d.ts |
| `electron/storage/` | новые таблицы (через MIGRATIONS) | менять схему inline в `openDb()` |
| `electron/connectors/` | новые внешние сервисы | хардкодить креды, делать без validation args |
| `src/` | компоненты, hooks, lib | импорт из `electron/` (renderer не имеет доступа) |
| `tests/` | свободно | моки настолько глубокие что не тестируют реальную логику |
| `resources/` | иконки, статика | трогать без явного запроса |

**Никогда не трогать без явного разрешения:**
- `*.env`, `*.key`, `creds*.json`, `.ssh/` — секреты (path-policy блокирует).
- `out/`, `release/`, `node_modules/` — артефакты.
- `MIGRATIONS` массив в порядке индексов — только append, никогда edit/reorder.

---

## 5. Конвенции кода

- **TypeScript strict.** Любой `any` — обоснован в комментарии.
- **Минимализм.** Только запрошенный код. Без спекулятивных абстракций.
- **Сохранять существующий стиль.** Если рядом без точек с запятой — не ставь. Если используются одинарные кавычки — не меняй на двойные.
- **Комментарии на русском** для product-логики, на английском для технических деталей и API-интеграций (так уже сложилось в коде).
- **Не удалять чужой код** без явной просьбы.
- **Зависимости трогаем только лишние** (которые стали лишними от наших правок).

---

## 6. Тесты

- **Цель = тест воспроизводящий баг, потом фикс.** Не «фикс + тест который проходит».
- **Pure logic — обязательно тесты.** `compose-system`, `compact-history`, `with-retry`, `pricing` — покрыто.
- **IPC handlers — интеграционные, по возможности.** Через mock electron-окружения.
- **UI компоненты** — пока не покрываем, кроме критических.

---

## 7. Безопасность

- **path-policy.ts** — все file access через `safeRealJoin(projectRoot, rel)`. Никогда не использовать raw `path.join` для пользовательских путей.
- **secret-scanner.ts** — весь текст, попадающий в логи/контекст, проходит scanText. API keys / tokens заменяются на `[REDACTED:type]`.
- **isForbiddenPath()** блокирует `.env`, `*.key`, `creds*.json` — write через write_file туда не пройдёт.
- **Renderer = `nodeIntegration: false`** + `contextIsolation: true`. ESM preload требует `sandbox: false`, это known trade-off.

---

## 8. Куда писать новые фичи

- **Новый коннектор:** `electron/connectors/{name}.ts` реализует `Connector` интерфейс (info + query). Регистрация в `connectors/registry.ts`. Settings UI в `src/components/Settings.tsx`.
- **Новый skill:** `.md` файл в `~/.verstak/skills/` (или `~/.claude/skills/` — авто-импортится). Frontmatter: id (обязательно) + name/description/icon/slash/tools_allow. Body = system prompt. Built-in — `electron/ai/skills/built-in.ts`.
- **Новый tool (для агента):** TOOL_DEF в `electron/ai/tools.ts` + handler в `electron/ipc/tool-handlers.ts`. Регистрируй в HANDLER_REGISTRY.
- **Новый IPC endpoint:** handler в `electron/ipc/{file}.ts` → bridge в `preload.ts` → тип в `src/types/api.d.ts`. Все три места.
- **Новая таблица в БД:** миграция в `MIGRATIONS` массив `electron/storage/db.ts` с НОВЫМ version номером. Никогда не правь старые миграции.
- **Новая фича UI:** компонент в `src/components/`, состояние через zustand, стили в `src/styles/layout.css` секцией с комментарием-маркером.

**Новые AI-провайдеры НЕ добавлять** — проект намеренно Grok-only.

---

Последнее обновление: 2026-06-12. Если архитектура изменилась — обнови этот файл.
