# Agent Bench

10 фиксированных задач для регрессии «не стал ли агент глупее».

Каждая задача — JSON-файл в этой папке. Структура:

```json
{
  "id": "find-symbol",
  "title": "Найти где определён символ",
  "prompt": "Где в проекте определён компонент Sidebar?",
  "fixture": "verstak",
  "expectations": {
    "maxToolCalls": 5,
    "mustCall": ["search_project"],
    "mustNotCall": ["write_file", "apply_patch"],
    "mustMention": ["Sidebar.tsx"]
  }
}
```

## Запуск

```bash
npx vitest run tests/agent-bench
```

Каждая задача:
1. Делает дамп `tools.execute` вызовов (mock-провайдер не нужен — мы проверяем
   что **наш слой** правильно собирает context-pack, корректно интерпретирует
   ответ, не теряет attachments и т.п.)
2. Сравнивает с expectations
3. Выдаёт PASS/FAIL с причиной

## Зачем не e2e с реальной моделью

Реальная модель недетерминирована — тесты будут флакать. Bench здесь — это
**регрессия слоя**: что наш context-pack правильный JSON, apply_patch
правильно парсит блоки, project-map не теряет файлы, secret-scanner не пускает
ключи через журнал и т.д.

Реальные e2e прогоны делаем руками раз в неделю по тому же списку и записываем
результаты в `bench-results.md`.
