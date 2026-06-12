# Verstak — Журнал разработки

Хронология значимых изменений. Записывать каждое закрытое усилие (новая фича, фикс, рефакторинг).

| Дата | Что сделано | Коммит | Результат |
|------|-------------|--------|-----------|
| 2026-05-19 | Initial design spec (10 разделов) | `5011cde` | `docs/superpowers/specs/2026-05-19-verstak-design.md` — что строим, зачем, как |
| 2026-05-19 | MVP implementation plan (15 задач) | `66592aa` | `docs/superpowers/plans/2026-05-19-verstak-mvp.md` — пошаговый план реализации |
| 2026-05-19 | **Task 1.** Bootstrap Electron + Vite + React + TS | `fd49445` | Минимальный скелет. `npm run build` зелёный |
| 2026-05-19 | **Task 2.** Vitest + sanity-тест | `7304275` | Тестовый стенд готов |
| 2026-05-19 | **Task 3.** SQLite storage (better-sqlite3) | `2e8772f` | `db.ts` с миграциями для `settings` и `chats` |
| 2026-05-19 | **Task 4.** Settings storage с safeStorage | `df7e2f5` | Шифрованное хранение секретов через OS keyring |
| 2026-05-19 | **Task 5.** Chats history (per-project) | `2a43d07` | Сообщения изолированы по `project_path` |
| 2026-05-19 | **Task 6.** Gemini provider (@google/genai, streaming) | `8a49ad1` | `ChatProvider` интерфейс + Gemini impl |
| 2026-05-19 | **Task 7.** IPC для projects/files | `bc80b15` | `projects:pick`, `files:tree`, `files:read` |
| 2026-05-19 | **Task 8.** Project store (Zustand) + Sidebar UI | `7490cbb` | Дерево файлов с глубиной до 5, ignore для `node_modules`/`.git` |
| 2026-05-19 | **Task 9.** Settings UI + AI IPC | `0be92df` | Модалка ввода API ключа, главный IPC для чата |
| 2026-05-19 | **Task 10.** Chat UI + Gemini streaming | `9c196f0` | Сообщения с ролями, авто-скролл, streaming в реальном времени |
| 2026-05-19 | **Task 11.** Chat history persistence | `60eb8d7` | История загружается при открытии проекта, сохраняется на `done` |
| 2026-05-19 | **Task 12.** File tools (read/list/write) + multi-turn loop | `2fc81a7` | AI читает файлы и предлагает изменения. Max 5 turns |
| 2026-05-19 | **Task 13.** DiffView + write_file confirmation | `cfc257b` | Modal с diff'ом, Accept/Reject, IPC `ai:resolve-write` |
| 2026-05-19 | **Task 14.** Терминал + run_command tool | `2a41fa2` | xterm.js + node-pty, AI может запускать команды |
| 2026-05-19 | **Task 15.** README + native rebuild script | `a816d31` | Документация запуска. Electron pinned to v40 (better-sqlite3 prebuild) |
| 2026-05-19 | **Fix.** Externalize electron в build | `de4785d` | electron-vite бандлил electron в main.mjs → ошибка "failed to install". Добавлен `externalizeDepsPlugin` |
| 2026-05-19 | **Feature.** Gemini CLI provider (подписка) | `cc450f9` | Subprocess `gemini` с stream-json. Пользователь подключает свою Gemini Ultra подписку без API ключа |
| 2026-05-19 | **UX.** Ярлык на рабочем столе | — | `Desktop/Verstak.bat` — двойной клик и запускается |
| 2026-05-19 | **Design.** Полный UI редизайн | `(см. ниже)` | Geist Sans/Mono, GitHub-dark тема, markdown + highlight.js, новый layout. Sidebar с дискверным брендом, status footer с провайдером, новая модалка Settings, DiffView v2, тема терминала |
| 2026-05-19 | **Feature.** Model pill в composer'е | — | Под полем ввода справа виден текущий провайдер `Gemini 2.5 Pro · API` или `Gemini Ultra · CLI`. Кликабельно — открывает Settings. Добавлен `hooks/useProvider.ts` (polling settings) |
| 2026-05-19 | **Feature.** Вложения: файлы, скриншоты (Ctrl+V), drag-drop | `dc60a8f` | Кнопка скрепки в composer'е, обработчик paste для clipboard images, drag-drop overlay. API режим — `inlineData` в Gemini (нативная multimodal). CLI режим — упоминание имён файлов в промте. Лимит 5MB/файл, 8 файлов |
| 2026-05-19 | **Security.** Аудит от Codex → закрытие критики | `(см. ниже)` | По итогам внешнего ревью закрыт MUST-блок безопасности (3 фикса) + SHOULD-блок UX (3 фичи) |
| 2026-05-19 | **Security 1.** Path boundary для `files:read` IPC | `(в составе security commit)` | Главный процесс трекает активный проект (`state/project-state.ts`); `files:read` нормализует путь и отказывается читать вне корня. Лимит на размер файла 2MB |
| 2026-05-19 | **Security 2.** `run_command` confirmation flow | `(в составе security commit)` | Раньше команды выполнялись неявно через `execSync`. Теперь IPC показывает модалку `CommandConfirm.tsx`, ждёт явное Accept/Reject. Внутри — `execFile` с timeout 60s, captured stderr, exit code |
| 2026-05-19 | **Security 3.** Denylist деструктивных команд | — | `ai/command-policy.ts`: hard-блок 11 паттернов (rm -rf /, format, mkfs, dd of=/dev, fork bomb, shutdown, curl|sh, sudo rm, git push --force, git filter-repo, чтение ~/.ssh / .aws / .npmrc). 12 unit-тестов. Blocked-команды не доходят до confirmation — сразу отказ с причиной |
| 2026-05-19 | **UX.** Activity log + Changed files summary | — | Под сообщением Gemini виден список действий (read/write/command) с цветовым статусом pending/ok/rejected/blocked. После окончания ответа — выделенный блок "Изменены файлы (N)" с зелёной рамкой |
| 2026-05-19 | **UX.** Stop streaming (Esc / красная кнопка) | `7fd7e07` | `ai:stop` IPC с AbortController per-send. CLI subprocess убивается, API loop вылетает на следующей итерации. Незавершённые подтверждения auto-rejected чтобы модалки не зависали |
| 2026-05-19 | **Branding.** Иконка приложения | `4737cd4` | `resources/icon.png` + `.ico` (7 размеров через sharp + png-to-ico), `scripts/build-icon.mjs` для пересборки. Electron BrowserWindow + AppUserModelId. `Desktop/Verstak.lnk` с кастомной иконкой, `.bat` переехал в `scripts/launch.bat`. Та же иконка в sidebar бренде и empty-state чата |
| 2026-05-19 | **Feature.** Per-project views (Chat/Tasks/Journal/Plan/Workflow/Calendar) | — | В sidebar секция навигации с 6 табами. SQLite таблицы `tasks` и `journal` per-project. TasksView — добавить/check/удалить/clear-done. JournalView — composer заметок + хронология с цветовыми бейджами kind (Session/Action/Note). Auto-log: user-сообщение → session; принятая правка → tool; команда успех/упало/блок → tool. Plan/Workflow/Calendar — заглушки |
| 2026-05-19 | **Feature.** Multi-project rail с переключением | — | Новая `projects` таблица + `storage/projects.ts`. IPC list/rename/remove поверх pick. Узкая колонка `ProjectRail` слева от sidebar: Verstak-логотип-home, цветные квадраты-проекты (стабильный hash-color, первая буква), `+` для добавить. Hover → красный `×` для убрать из списка (файлы не трогаются). При старте автоматом открывается последний использованный |
| 2026-05-19 | **Feature.** Multi-provider: Claude / Grok / ChatGPT API | — | `electron/ai/claude.ts` (Anthropic SDK), `electron/ai/openai-compat.ts` (общий для OpenAI и Grok через baseURL), `electron/ai/grok.ts` + `electron/ai/openai.ts`. `electron/ai/registry.ts` — single source of truth для метаданных провайдеров. Settings UI v3 — 5-row provider list + per-provider key + dropdown моделей. `ModelPicker.tsx` — popover из composer для быстрой смены провайдера/модели без захода в settings |
| 2026-05-19 | **Feature.** CLI subscriptions: Claude Code + Codex | — | `electron/ai/claude-cli.ts` (wrapping `claude --print --output-format stream-json --verbose`), `electron/ai/codex-cli.ts` (`codex exec --json`). Оба stdin pipe + parse stream-json. Регистрируются как `claude-cli` и `codex-cli`. Settings UI показывает install hint для каждого. Теперь 7 провайдеров: Gemini API / Gemini CLI / Claude API / Claude Code CLI / Grok / ChatGPT / Codex CLI |
| 2026-05-19 | **UX.** Collapsible sidebar | `b4ba01c` | Кнопка-toggle в rail под home-иконкой + `Ctrl/Cmd+B`. При сворачивании grid с 3 колонок (56/260/1fr) → 2 колонки (56/1fr), main растягивается. Project rail остаётся виден чтобы переключать проекты |
| 2026-05-19 | **Fix.** Author label в чате | `f55a5cc` | Раньше было хардкод "Gemini" — теперь dynamic из `useProvider().label`. Под сообщением AI пишется реальное имя текущего провайдера (Claude / Grok / Codex / …) |
| 2026-05-19 | **Fix.** `__dirname is not defined` в main.mjs | `280de72` | После добавления `externalizeDepsPlugin` в build config Vite перестал инжектить CJS shim для `__dirname`. Заменил на `dirname(fileURLToPath(import.meta.url))` явно. Окно перестало падать при старте |
| 2026-05-19 | **UX.** Terminal toggle | — | Раньше открывался автоматически при выборе проекта. Теперь по умолчанию скрыт. Кнопка-иконка терминала в composer (рядом с model pill) разворачивает; `×` в шапке панели сворачивает |
| 2026-05-19 | **Feature.** Model selection for CLI providers | — | Раньше у `gemini-cli` / `claude-cli` / `codex-cli` была одна модель `auto`. Теперь у каждого свой список: Gemini Ultra (2.5-pro/flash, 3-pro/flash-preview), Claude Code (sonnet/opus/haiku 4-5/4-6), Codex (gpt-5-codex/gpt-5/o3/o3-mini/4o). Provider передаёт выбранную модель в субпроцесс через `--model` или `-m`. ModelPicker и Settings показывают полный список для CLI |
| 2026-05-19 | **Feature.** Tools across all API providers (Claude/Grok/ChatGPT) | — | Раньше только Gemini API умел tools. Теперь все 4 API провайдера поддерживают полный агентский режим: function calling, диф-конфирмация для write_file, подтверждение run_command, multi-turn loop. Архитектура: `ChatMessage` расширен полями `toolCalls` и `toolResults`. Каждый провайдер форматирует их под свой формат: Gemini — `functionCall`/`functionResponse` parts; Claude — `tool_use`/`tool_result` blocks; OpenAI/Grok — `tool_calls` field + `role:'tool'` messages. IPC handler собирает structured результаты после каждой итерации цикла |
| 2026-05-19 | **Feature.** Grok Build CLI provider (SuperGrok подписка) | — | `electron/ai/grok-cli.ts` — обёртка над `grok` (Grok Build TUI) из `~/.grok/bin/grok`. Использует `--output-format streaming-json` и парсит `{type:"thought",data:"..."}` события как text-чанки. `-m <model>` для выбора (grok-4 / grok-4-fast / grok-code-fast-1 / grok-3). 8-й провайдер в реестре: Gemini API / Gemini CLI / Claude API / Claude Code CLI / Grok API / **Grok Build CLI** / ChatGPT / Codex CLI |
| 2026-05-19 | **AS-227 DONE.** Immutable system layer + user layer | — | Иммутабельный системный слой агента в коде продукта: `electron/ai/system-layer.ts` экспортирует `SYSTEM_LAYER_PROMPT` v1.0.0 (7-шаговый цикл, anti-patterns, scope discipline, verification contract, safety, output style). User layer auto-loaded из `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `.verstak/RULES.md` (первый найденный, лимит 64KB). `compose-prompt.ts` собирает `system_layer + user_layer` и инжектится в каждое API сообщение через role:'system'. CLI-провайдеры не инжектятся — они сами читают AGENTS.md. UI: бейдж над чатом `System layer · v1.0.0 · User layer · AGENTS.md` (кликабельно открывает SystemLayerViewer с табами System / User read-only). Соответствует постановке: пользователь может только **расширять** через AGENTS.md, перезаписать системный слой не может |
| 2026-05-19 | **Iteration: critical features sweep** | — | После аудита статьи и Codex закрыты сразу несколько критических пунктов |
| 2026-05-19 | **Tools.** search_project + find_files | `a32f1d5` | Полнотекстовый поиск через ripgrep (fallback на манульный walker), glob-find по проекту. AI разблокирован на больших репо. Игнор node_modules/.git/out/dist/build/__pycache__/venv |
| 2026-05-19 | **Agent.** Undo stack + Loop detection + Max-turns warning | `812695e` | `file_undo` таблица (50 на проект), кнопка `↶ N` в composer'е восстанавливает последнюю принятую правку. Loop detection — если AI 3× повторил один tool+args → break + supervisor message. Max turns 5→8 + явный warning при достижении лимита |
| 2026-05-19 | **Agent.** Per-session token counter | `a036fc8` | Каждый API провайдер yield-ит `usage` ChatEvent в конце stream (Gemini.usageMetadata, Claude.message_start/delta.usage, OpenAI stream_options.include_usage). Pill в composer `↑2.1k · ↓0.8k`. Сбрасывается при смене проекта |
| 2026-05-19 | **Feature.** Plan mode (DB + view + AI tool + execution) | `5 commits` | `plans` + `plan_steps` таблицы. PlanView заменил StubView: ручное создание плана, list+detail, шаги с чекбоксами. AI tool `create_plan(title, steps[])` — IPC перехватывает, сохраняет, шлёт `plan-created` event. Кнопка `▶ Запустить` per step → focused-промт → AI работает с tools → finalize step.result на 'done'. Кнопка `▶▶ Все шаги` — последовательный прогон pending шагов |
| 2026-05-19 | **UI.** Multi-file DiffView | `09e5040` + `8443d3a` | Backend параллелит write_file в одном turn (Promise.all). Renderer переключился на `pendingWrites: PendingWrite[]`. DiffView: file rail слева (path + +N/−M), diff body справа, footer "Принять все (N)" / "Отклонить все" + per-file ✓/×. Когда один файл — fallback на старый layout |
| 2026-05-19 | **Chore.** Test pipeline fix | `a777fe2` | `npm test` теперь сам ребилдит better-sqlite3 под node перед vitest. `predev` ребилдит под Electron. `test:fast` пропускает ребилд. Решена боль ABI mismatch из аудита |
| 2026-05-19 | **Docs.** README → GGC = Verstak Claude | `49f4894` | Обновлён под актуальный набор: 8 провайдеров (4 API + 4 CLI), список фич, инструкции для каждого CLI, скрипты, статус |
| 2026-05-19 | **Safety.** Confirm project switch mid-stream | `2903cc1` | Stop-gap до полного background-agents. При клике на другой проект во время стрима — confirm `AI ещё отвечает. Прервать?`. Без подтверждения остаёмся в текущем |
| 2026-05-19 | **Feature.** Background agents (4 коммита) | `1cc05e5` → `34a9326` | Полная фоновая работа AI во время переключения проектов. Backend: каждое `ai:event` теперь тегируется `projectPath` (taggedSender wrapper). Store: `SessionSnapshot` per-проект, snapshot/restore при `setProject`, `applyEventToSession` action для фоновых сессий. Chat: листенер маршрутизирует по `projectPath` — если событие не для текущего проекта, мутирует snapshot. UI: на ProjectChip синяя точка `hasUnread` (AI закончил пока ты был в другом проекте) или зелёная пульсирующая `isStreaming` (ещё работает). Stop-gap confirm-mid-stream удалён. Переключение проектов во время стрима безопасно: AI продолжает писать в свой проект, ты видишь точку, вернулся — увидел готовый ответ |

---

## Архитектурные решения

### 2026-05-19 — Multi-provider через ChatProvider interface
Один интерфейс для всех способов подключения AI:
```typescript
interface ChatProvider {
  id: string
  name: string
  models: string[]
  send: (messages, tools, toolResults) => AsyncIterable<ChatEvent>
}
```
Текущие реализации: `gemini-api` (через `@google/genai` SDK), `gemini-cli` (subprocess `gemini` CLI).
Готовится: `claude-api`, `claude-code-cli`, `gpt-api`, `codex-cli`.

### 2026-05-19 — Settings как key/value в SQLite + safeStorage
Все значения (включая не-секреты типа `provider`) проходят через `safeStorage.encryptString` → base64 → SQLite. Шифрование симметричное, OS-native. Доступ через `settings:get-key` / `settings:set-key` IPC.

### 2026-05-19 — Чаты в SQLite, в БД приложения, не в `.verstak/` проекта
Изначально проектировали хранить историю в папке проекта (`.verstak/chats.db`), но в реализации перешли на единую БД в `app.getPath('userData')`. История разделяется по полю `project_path`. Перенос на per-project DB — отдельная задача если понадобится "взять с собой" историю.

### 2026-05-19 — Externalize нативных модулей в build config
`electron`, `better-sqlite3`, `node-pty` помечены как `rollupOptions.external` в `electron.vite.config.ts`. Иначе Vite пытается бандлить их runtime-код и приложение падает при старте. См. фикс `de4785d`.

### 2026-05-19 — Tools API для AI, но не для CLI
AI tools (`read_file`/`list_directory`/`write_file`/`run_command`) работают только в API режиме (через function calling в Gemini). В CLI режиме gemini-cli сам управляет файлами внутри — diff-подтверждение не показывается. Эта несимметрия — осознанный trade-off. Чтобы вернуть diff в CLI режим, нужно парсить output gemini-cli'а (как делает Cursor с Claude Code).

---

## Известные ограничения / технический долг

- **Electron pinned на v40.** better-sqlite3 ещё не выпустил prebuilt бинарники для Electron 42+ (ABI 146). При апгрейде Electron надо ждать prebuild или собирать better-sqlite3 из source.
- **`npm test` после `electron-rebuild`.** Native модули собираются для Electron, Vitest падает. Чтобы тестировать — `npm install --legacy-peer-deps` (восстанавливает node-бинарники), потом снова `electron-rebuild` перед `npm run dev`.
- **Renderer bundle 1.5 MB.** Из-за highlight.js (с языками) и зависимостей React/Zustand/Markdown. Не критично для desktop приложения, но при packaging .exe можно оптимизировать code-splitting.
- **Вложения не сохраняются в истории.** В DB записывается только текстовый markdown с упоминанием файлов (`📎 screenshot.png`). При перезагрузке проекта картинок в старых сообщениях больше нет. Если понадобится — сохранять base64 в `chats.content` JSON-блобом или отдельной таблицей `attachments`.
- **run_command без подтверждения.** AI может выполнять любые shell-команды без подтверждения пользователя. Для production-сценариев нужен подобный diff-подтверждению UI или whitelist команд.
- **CLI режим: каждый запрос — новая сессия.** `gemini` CLI вызывается как subprocess для каждого сообщения, контекст сессии не накапливается. История чата в нашей UI есть, но в gemini-cli не передаётся (gemini-cli получает только последнее user-сообщение).
- **Один проект за раз.** Открыть второй проект параллельно нельзя — store перезаписывается. Tabs или multi-window — отдельная фича.

---

## 2026-05-20 — ночной /goal цикл (10 коммитов)

Goal: сделать продукт лучше Antigravity 2.0 за ночь. Циклами по фиче-в-коммит,
каждый — typecheck + при возможности unit-тесты + git commit.

### Добавлено

1. **Sidebar Chat as collapsible section** (`1fd8589`) — список чат-сессий
   внутри секции Chat: "+", двойной клик = rename, × = удалить.
2. **Journal auto-summary** (`57ec2bf`) — `electron/ipc/ai.ts` в конце каждой
   AI-сессии пишет запись в journal: тронутые файлы, команды, последний
   ответ ассистента (truncated). Не шумит на пустых сессиях.
3. **Secret scanner + path policy** (`1dbe574`) — `electron/ai/secret-scanner.ts`.
   Блокирует чтение/запись `.env*`, `.ssh/*`, `.aws/*`, `*.key/.pem/.p12`,
   credentials, cookies. Редактирует API-ключи (OpenAI, Anthropic, GitHub,
   AWS, Google, Slack, Stripe, JWT, private-key blocks, basic-auth в URL)
   как `[REDACTED:type]`. 11 unit-тестов. System layer v1.1.0 документирует
   политику для AI.
4. **In-app browser** (`5f2505c`) — `src/components/BrowserView.tsx` через
   Electron `<webview>` (включён `webviewTag` в main). URL-бар, back/fwd/stop/reload,
   error overlay, title+host status. Renderer экспортит `window.verstakBrowser`.
   AI tools `browser_navigate` / `browser_read_page` диспатчатся через
   `webContents.executeJavaScript` — main процесс дёргает renderer-side API.
5. **Connectors framework + 1C OData** (`2facb7f`) — `electron/connectors/` с
   pluggable `Connector` интерфейсом и registry. 1С через `standard.odata` +
   HTTP Basic. AI tools `list_connectors`, `connector_query` (`id=onec` +
   entity/filter/select/top/metadata). Settings UI: URL/логин/пароль в
   safeStorage. Body capped 256KB → secret-scanner. 3 теста.
6. **Activity stream upgrade** (`10214ec`) — `ai.ts` эмитит `tool-activity`
   события для read_file / list_directory / search_project / find_files /
   list_connectors / connector_query / browser_*. `ChatEvent` union расширен.
   Видно в активити-фиде что AI делает в реальном времени, не только текст.
7. **Cost estimator** (`0cd5195`) — `src/lib/pricing.ts` со snapshot pricing
   для Anthropic / Google / OpenAI / xAI. Учитывает скидку cached-input
   (Anthropic prompt caching). CLI провайдеры → null (по подписке).
   Usage pill в Chat composer теперь показывает `↑in ↓out ⟲cached $cost`.
8. **AGENTS.md auto-init + DiffView shortcuts** (`9db9a1e`) — `ensureUserLayer()`
   создаёт `.verstak/RULES.md` со стартовым шаблоном при открытии проекта
   если правил нет. DiffView: Enter принять / Esc отклонить все /
   Ctrl+Enter принять все / ←→ навигация между файлами.
9. **Generic HTTP/REST connector** (`709e855`) — `electron/connectors/http.ts`.
   До 4 пользовательских эндпоинтов в Settings: name + base + Authorization +
   allow-paths. AI вызывает `connector_query` с `id="http"`, endpoint, method,
   path, query/body/headers. Auth-заголовок инжектится из settings, AI не
   видит токен и не может переопределить. Path allow-list блокирует попытки
   обращаться к запрещённым путям. 5 тестов.
10. **propose_edits batch tool** (`4817f23`) — атомарный пакет правок
    нескольких файлов. AI передаёт `{edits: [{path, content, reason}], summary}`.
    Backend раскладывает в pending-write events с уникальными child callId,
    multi-file DiffView с шорткатами показывает всё в одной модалке.
    Возвращает aggregate-результат accepted/rejected per-file.

### Архитектурные узлы

- **Renderer ↔ Main bridge для tools.** Browser-tools диспатчатся через
  `sender.exec()` (`executeJavaScript(code, true)`), что позволяет main
  process'у дёргать renderer-side API. Паттерн переиспользуем для будущих
  визуальных tools (file picker, screenshot диалогов).
- **Layered defense.** path policy (block) → content scanner (redact) →
  размерный cap (256KB в HTTP/connector body, 2MB в read_file, 64KB в
  user-layer) → user diff/command confirmation. Ни один секрет не должен
  выйти из main-процесса в AI-context без явного действия пользователя.
- **Connector registry.** Добавление нового адаптера = одна строка в
  `BUILTINS`. Каждый адаптер сам решает что считать "needs-config" и
  какие args принимать. HTTP-адаптер закрывает 80% MCP-style use cases
  без кода — конфигурируется JSON-эндпоинтами из Settings.

### Не сделано (deferred)

- **Per-hunk accept в DiffView.** Требует нового IPC `ai:resolve-write-modified`
  принимающего изменённое содержимое и reconstruct-логики из принятых hunks.
- **Inline syntax-aware highlighting в DiffView.** Скорее всего через
  highlight.js (уже в bundle) — но требует переписать рендеринг diff.parts.
- **Plan→Journal полный rename.** JournalView уже существует, Plan view
  оставлен как отдельная вкладка (структурированные планы AI vs. ручные
  записи в журнал).
- **Workflow auto-generate canvas.** Требует mermaid / react-flow зависимости.
- **Tasks Kanban с timer support.** Текущий TasksView — простой список.

---

## 2026-05-20 — пост-аудит (4 коммита, Gemini 3.5 wave)

После выхода Gemini 3.5 Flash и аудита от пользователя — закрыты 4 из 5
приоритетов аудита (multi-chat threads оставлены deferred).

11. **Gemini 3.5 Flash integration** (`3c6fa1f`) — `gemini-3.5-flash`,
    `gemini-3-pro`, `gemini-3-flash` в списке моделей; 3.5 Flash —
    дефолт для нового provider. Pricing обновлён.
12. **Project Map** (`1c2105d`) — `electron/ai/project-map.ts` сканирует
    проект, извлекает символы из *.ts/.tsx/.js/.jsx через regex.
    AI tools `get_project_map` (cached) + `refresh_project_map`. Cache
    инвалидируется при каждом write_file. С 1M контекстом Gemini 3.5
    можно скармливать всю карту целиком и не тратить десятки
    list_directory вызовов. 3 теста.
13. **Plan Autopilot** (`a6d25ad`) — `electron/ipc/verify.ts` (новый
    IPC `verify:exec`, обходит per-call confirmation, command-policy
    всё равно работает). PlanView получил 🤖 Автопилот toggle с
    maxSteps + verifyCmd. После каждого шага автопилот запускает
    verify (например `npm test` или `npx tsc --noEmit`); non-zero
    exit помечает шаг failed и стопит pipeline. Live log событий.
14. **Vision: browser_screenshot** (`4a49138`) — новый AI tool. Делает
    `webview.capturePage()`, парсит data URL в `Attachment`, кладёт в
    `pendingAttachments`. После turn'а агентского loop'а attachments
    флэшаются на следующий user message; Gemini-провайдер уже
    поддерживает `inlineData` parts. Vision-модели (Gemini 3.5,
    GPT-4o) видят скриншот и анализируют его. Heavy dataUrl
    срезается из текстового tool-result чтобы не платить дважды.

### 2026-05-20 · Спринт «не хуже Cursor» (parity, не compliance)

Решили: 152-ФЗ и compliance — moat второго порядка. Сначала нужно быть **не
хуже Cursor** на ежедневных задачах разработки. Compliance продаст продукт
только тем, кто уже его использует.

Сделано (7 коммитов):

- `97c9ef3` **Context Pack** — авто-инжект git status + recent_writes
  (из undoStack) + project_map (компактная версия) + verify_scripts
  (из package.json/tsconfig) в system prompt перед каждым `ai:send`.
  Модель сразу знает что в репо, без расхода ходов на discovery.
- `d2ec16b` **apply_patch tool** — SEARCH/REPLACE блоки вместо
  full-file writes. `write_file` остаётся только для новых файлов.
  Идёт через тот же diff-confirm flow. Экономия ~10× токенов на
  правках больших файлов, меньше риск «AI переписал лишнее».
  7 unit-тестов.
- `7abf027` **Continue budget** — на 8-м ходу не done, а событие
  `turns-exhausted` → UI показывает плашку «+10 ходов». Hard
  ceiling 40. Новое `ai.sendWithBudget(messages, path, N)` для
  расширения.
- `25ba2d1` **Parallel reads + verify nudge** —
  read_file/list_directory/search_project/find_files/get_project_map
  стартуют через `Promise.all` в одном turn'е. Плюс после accepted
  writes в next user-message подмешивается `[system: запусти
  npm test перед готово]` если в проекте есть verify-scripts.
- `36f206f` **Agent bench** — `tests/agent-bench/bench.test.ts` —
  10 детерминированных регрессий (apply_patch блоки, context-pack
  scripts, project-map exports, secret-scanner редакция,
  command-policy bypass-check). Запуск:
  `npx vitest run tests/agent-bench`.
- `d129e2e` **CLI parity (light)** — `electron/ai/cli-prompt.ts`
  единый builder. Все 4 CLI (claude/gemini/grok/codex) теперь
  получают system_layer + user_layer + context_pack + сжатую
  историю последних 10 turns. Поправка к ТЗ Cursor: для claude-cli
  НЕ дублируем SYSTEM_LAYER_PROMPT (у Claude Code свой развёрнутый
  system, двойной регламент = шум). grok-cli argv-cap 28KB. Tools
  всё ещё API-only — это ограничение one-shot stream-json режима
  у вендоров.

Agent mode = API only. CLI = shared brain, no tools.

### 2026-05-21 · GGC-009 · Agent grounding

Cursor предложил ТЗ предполагая что studio_server.py / studio.html
ещё есть и AI их подсасывает в описание стека. На момент написания
ТЗ — файлы уже удалены (предыдущая сессия), `index.html` в корне
это Vite entry point (НЕ legacy), а `grok_chat/` не было галлюцинации
(Pavel был в проекте grok-chat в момент скриншота).

Из ТЗ оставлено только полезное, остальное отрезано:

- **product_stack в context-pack** — одна строка на пакет. Читает
  package.json и собирает summary типа `electron + react + vite +
  better-sqlite3 + typescript (verstak)`. Fallback на pyproject /
  requirements.txt для Python проектов. Цена ~50 байт; экономит
  модели read_file package.json на первом turn.
- **system-layer v1.2.0 · блок GROUNDING** — явные правила: стек
  определять ТОЛЬКО из package.json / product_stack; ENOENT на
  read_file → не повторять путь, звать list_directory; соседние
  проекты недоступны; для архитектурных вопросов — get_project_map
  СНАЧАЛА.
- **tools.read_file ENOENT** — вместо raw ENOENT возвращает
  «Файл "X" не существует в активном проекте (Y). Вызови
  list_directory или get_project_map». Это убирает повторный
  read_file того же пути (модель раньше повторяла трижды до loop
  detection).
- **+2 bench-теста** (#11 electron+react из package.json, #12
  Python+fastapi из requirements.txt) — теперь 12/12 в agent-bench.

Отказался от: `legacy_ignore` (нечего игнорировать), пометки
index.html / chats/ как legacy (это runtime/entry, не мусор).

### Deferred из аудита

- **Threaded chats** (древовидная структура бесед) — отложено.
  Текущая Sidebar Chat-секция со списком сессий покрывает
  use case "разные модели на разные задачи", полные threads
  требуют рефакторинга чат-стора и UI.

---

## Следующие шаги (черновик)

1. **Multi-provider (v0.2).** Claude API + Claude Code CLI + GPT API + Codex CLI. Дизайн уже описан в брейнсторме (Settings → список провайдеров + переключатель в чате).
2. **Сохранение вложений в истории.** Хотя бы для последних N сообщений, иначе reload теряет картинки.
3. **Multi-chat per project.** Сейчас один линейный чат на проект. Хорошо бы — список бесед, как в ChatGPT/Claude.
4. **Inline edit для AI.** Когда AI правит файл — открывать прямо в Monaco-editor вместо отдельной модалки. Удобнее для серий правок.
5. **Distributable installer.** electron-builder → `.exe` с подписью.

### 2026-05-21 · GGC-010 · electron-builder → .exe для пилотов

Закрыл «Это не продукт, это dev-сборка» из Grok audit.

- package.json: build config для electron-builder
  * appId ru.verstak.ide, productName Verstak
  * Targets: NSIS installer + portable .exe (x64)
  * asarUnpack для better-sqlite3 + node-pty (native modules)
  * npmRebuild: false (используем уже собранные за predev бинарники
    Electron; node-gyp на Windows без VS Build Tools не работает)
  * signAndEditExecutable: false, CSC_IDENTITY_AUTO_DISCOVERY=false —
    unsigned dist (для signed нужен сертификат Authenticode ~$200/год)
  * scripts: dist / dist:win

- Замена node-pty → @homebridge/node-pty-prebuilt-multiarch
  Старая node-pty падала на winpty/GetCommitHash.bat при @electron/rebuild.
  Prebuilt-multiarch имеет binarys для Windows/Mac/Linux out of the box.

- Артефакты в release/:
  * Verstak-Setup-1.0.0-x64.exe — NSIS installer (с user choice
    install path, desktop shortcut, start menu entry)
  * Verstak-Portable-1.0.0-x64.exe — standalone, без установки

- release/ добавлен в .gitignore

Известные ограничения:
- Unsigned: Windows SmartScreen покажет «Unknown publisher» при первом
  запуске. Для пилотов с инсайдерами ок; для широкого распространения
  нужен Authenticode сертификат.
- ~109 MB размер — Electron + Chromium + наш bundle. Стандартно для
  Electron приложений.
