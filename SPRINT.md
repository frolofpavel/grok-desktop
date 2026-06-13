# SPRINT — Мультиагентность Grok Desktop (до 100 агентов)

Спринт из 4 фаз. Каждая фаза = инкремент, проверка (type/test/build), отдельный коммит. Не «3.0 одной PR».

Базовая точка (V2): `delegate_task` (1 суб, one-shot, без tools), `delegate_parallel` (≤12, батчи по 4, 5 ролей, abort+60s). Карточки `subagent-run` живые но эфемерные. `chat_sessions` имеет `kind`+`parent_chat_id`. `cost-guard`, `child-kill`, `handoff.ts`, `smart-router` — есть, недокручены.

Ключевой потолок V2: суб-агенты — one-shot текст без инструментов. Фаза 1 снимает этот потолок.

---

## Фаза 1 — Мощность (идеи 4 + 9) ← фундамент
- [x] Суб-агент = agent-loop с инструментами (не one-shot), итерационный лимит (`electron/ai/sub-agent-loop.ts`, MAX_SUB_ITERATIONS=8, per-task timeout 180с).
- [x] Whitelist инструментов по роли (`electron/ai/role-tools.ts`, `getRoleToolset`):
  - researcher / critic / planner → read-only (read_file, search_project, list_directory, find_files, get_project_map, impact_analysis)
  - verifier → read-only + check_diagnostics + run_command (только test/lint/typecheck — `command-policy.isVerifierCommand`)
  - executor → read + apply_patch / write_file (через mode-policy.decide) + run_command (denylist)
- [x] Суб-агентам запрещено делегировать дальше (delegate_* в SUBAGENT_FORBIDDEN_TOOLS — защита от рекурсии, Фаза 4).
- [x] cost-guard сессии прокинут в sub-loop (ctx.subCostGuard) + родительский abort убивает субов и их run_command-процессы (per-task AbortController, child-kill через ctx.tools).
- [x] Идея 9: provider per task в delegate_parallel — grok (API) + grok-cli (Grok Build) смешиваются в одном батче; CLI-суб работает с loop'ом (буферизация уже в grok-cli).

## Фаза 2 — Прозрачность и масштаб (идеи 1 + 7 + 6)
- [ ] Персистентные суб-сессии (kind='subagent', parent_chat_id, история, снапшот). Переключение как в SideChat.
- [ ] Панель/вкладка Agents: живой граф/список запущенных+завершённых, фильтры (роль/провайдер/статус), «притащить» результат в основной чат.
- [ ] Параллелизм: приоритетные очереди, группы, массовая отмена по роли/тегу, cost-cap на весь батч. До 20–50 агентов без смерти провайдеров/UI.

## Фаза 3 — Оркестрация (идеи 2 + 5 + 8)
- [ ] TodoGate: главный агент создаёт todo-лист, субы берут/обновляют/закрывают. Новая таблица + tools.
- [ ] Smart-оркестратор: авто-декомпозиция плана по ролям + умный выбор провайдера/модели (smart-router + effortLevel) на подзадачу.
- [ ] Per-sub memory + handoff: суб сохраняет находки, на завершении авто-handoff ключевых выводов главному.

## Фаза 4 — Вершина (идеи 3 + 10)
- [ ] Динамическое дерево делегирования: субы вызывают delegate_* с лимитом глубины и общего количества + визуализация дерева.
- [ ] Agent Swarms: рой по одной цели (исследование+критика+реализация+верификация) с голосованием/консенсусом и выбором лучшего.

---

## Журнал
- (старт) baseline V2 закартирован, план утверждён Павлом («делай под ключ весь спринт»).
- Фаза 1 ✅ — суб-агенты получили tool-enabled agent-loop с whitelist по роли. Новые модули: `sub-agent-loop.ts` (облегчённый цикл, переиспользует tool-handlers.lookupHandler — не дублирует выполнение tools), `role-tools.ts` (getRoleToolset). `command-policy.isVerifierCommand` — гейт run_command для verifier. delegate_task/delegate_parallel переведены с one-shot на loop; delegate_task получил параметр `role`. Идея 9: mixed providers per task (grok+grok-cli) в одном батче. cost-guard сессии учитывает токены субов, abort/timeout (180с) их убивает, delegate_* запрещены субам. UI: карточка subagent-run показывает роль + счётчик tool-вызовов. Тесты: `tests/ai/role-tools.test.ts` (31 кейс). type ✅ build ✅ test:fast ✅ (только sqlite ABI-шум).
