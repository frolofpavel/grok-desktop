/**
 * Генерирует журнал изменений Grok Desktop в D:\PROGRAMMS\GROK DESKTOP
 * Запуск: node scripts/sync-desktop-changelog.cjs
 */
const fs = require('fs')
const path = require('path')
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx')

const OUT_DIR = 'D:\\PROGRAMMS\\GROK DESKTOP'
const BASE_NAME = 'Grok Desktop - Журнал изменений'

const ENTRIES = [
  {
    version: '0.1.0',
    build: '15.06.2026 (текущая)',
    deployed: '15.06.2026 17:27',
    title: 'Настройки приложения — левый нижний угол rail',
    changes: [
      'Кнопка перенесена из сайдбара в нижний левый угол панели проектов (rail).',
      'SVG-шестерёнка (не «солнышко» с лучами): 34×34 px, рамка и лёгкая тень.',
      'При развёрнутом rail — иконка + подпись «Настройки»; список проектов скроллится отдельно.',
      'SettingsGearIcon.tsx, ProjectRail.tsx, layout.css.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 (текущая)',
    deployed: '15.06.2026 17:13',
    title: 'Автообновления из GitHub Releases',
    changes: [
      'При запуске (через 4 с) проверка GitHub Releases frolofpavel/grok-desktop.',
      'Скачивание установщика автоматически; установка — кнопка «Установить» (полоска внизу или Настройки → Обновления).',
      'Настройки → Приложение → Обновления: версия, ручная проверка, прогресс.',
      'npm run publish:win — сборка + публикация релиза (нужен GH_TOKEN у Павла).',
      'Работает в собранном приложении (не в npm run dev).'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 (сессия 1)',
    deployed: '—',
    title: 'Чистая переустановка и синхронизация «мозгов» CLI',
    changes: [
      'Удалены %APPDATA%\\grok-desktop и %LOCALAPPDATA%\\Programs\\Grok Desktop, пересборка с нуля.',
      'Автоимпорт чатов из Grok CLI отключён по умолчанию (включается GROK_DESKTOP_IMPORT_CLI_CHATS=1).',
      'Loader тянет ~/.grok/skills и bundled/skills.',
      'Импорт истории Grok CLI доступен отдельной командой npm run migrate:cli-chats.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 (сессия 2)',
    deployed: '—',
    title: 'Исправление Grok CLI: ответ на первое сообщение',
    changes: [
      'Причина: payload.slice(0, 8000) обрезал хват (текущий user turn).',
      'Добавлен блок <current_user_request> в cli-prompt.ts.',
      'При промпте >8 KB — передача через --prompt-file в grok-cli.ts.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 (сессия 3)',
    deployed: '—',
    title: 'Масштаб интерфейса (UI Scale)',
    changes: [
      'electron/ui-scale.ts — масштаб окна Electron.',
      'Настройки → Внешний вид: ползунок и пресеты масштаба.',
      'Горячие клавиши: Ctrl+колёсико, Ctrl+0 — сброс на 100%.',
      'Ключ настройки: ui_scale_percent.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 (сессия 4)',
    deployed: '—',
    title: 'Сохранение переписки и проектов',
    changes: [
      'projects:set-current → upsert вместо touch (чаты не терялись).',
      'Автооткрытие last_project_path или home при старте (ProjectRail.tsx).',
      'Перед отправкой сообщения — ensureProjectForChat() в Chat.tsx.',
      'last_project_path сохраняется в settings.',
      'Тест: tests/storage/projects.test.ts.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 15:33',
    deployed: '15.06.2026 15:33',
    title: 'Оповещения: звук + Windows toast',
    changes: [
      'electron/ipc/notify.ts — Notification (silent), клик → фокус окна.',
      'src/lib/response-notify.ts — настройки notify_sound, notify_toast, notify_unfocused_only.',
      'Срабатывает при готовом ответе: текущий чат, фоновый чат, фоновый проект.',
      'Настройки → Внешний вид → Оповещения, кнопка «Проверить».',
      'preload + api.d.ts: app.isFocused, notify.show.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 15:41',
    deployed: '15.06.2026 15:41',
    title: 'Звук: системный WAV вместо синтеза',
    changes: [
      'Убран Web Audio (двухтоновый «пик»).',
      'Воспроизведение Windows Notify System Generic.wav из %WINDIR%\\Media.',
      'Удалён src/lib/notify-sound.ts.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 15:49',
    deployed: '15.06.2026 15:49',
    title: 'Исправление: toast есть, звука нет',
    changes: [
      'Add-Type System.Media не работал — заменён на LoadWithPartialName.',
      'Play() → PlaySync() (процесс не обрывал звук).',
      'Явный путь к Windows PowerShell 5.1.',
      'Toast остаётся silent: true; звук отдельно через notify:play-sound.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 15:54',
    deployed: '15.06.2026 15:54',
    title: 'Настройки: вкладка «Уведомления»',
    changes: [
      'Настройки → Приложение → Уведомления (отдельная строка в сайдбаре).',
      'Переключатели: только звук / только toast / оба / «только когда окно не активно».',
      'Блок оповещений убран из «Внешний вид».',
      'i18n: notifications, notifyIntro, обновлены подписи notifySound и notifyToast.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 (текущая)',
    deployed: '—',
    title: 'Журнал изменений',
    changes: [
      'Создан документ Grok Desktop - Журнал изменений.docx в D:\\PROGRAMMS\\GROK DESKTOP.',
      'После каждого изменения Grok Desktop журнал обновляется автоматически (агент).',
      'Пересборка: node scripts/sync-desktop-changelog.cjs.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 16:04',
    deployed: '15.06.2026 16:04',
    title: 'Раздвигающаяся панель проектов (rail)',
    changes: [
      'Кнопка «развернуть» под переключателем сайдбара — стрелка влево/вправо.',
      'Свёрнуто: цветные квадраты с буквой (как раньше), ширина 56px.',
      'Развёрнуто: квадрат + полное название проекта, ширина 200px.',
      'Состояние запоминается в localStorage (gg-rail-expanded).',
      'CSS: --gg-rail-w, плавная анимация, подсветка активного проекта на всей строке.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 16:09',
    deployed: '15.06.2026 16:09',
    title: 'Поиск по проектам в rail',
    changes: [
      'Поле «Поиск проекта…» в развёрнутой панели (от 2 проектов).',
      'Фильтр по названию и пути; Esc — очистить; кнопка ×.',
      'В свёрнутом режиме — иконка лупы: разворачивает панель и фокусирует поиск.',
      'Текущий проект всегда остаётся в списке, даже если не совпал с запросом.',
      'Пустой результат: «Ничего не найдено».'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 16:14',
    deployed: '15.06.2026 16:14',
    title: 'Фикс: настройки проекта уводили чат в левый нижний угол',
    changes: [
      'Причина: модалка без position:fixed становилась вторым ребёнком grid .gg-app и занимала ячейку сайдбара — main сжимался в угол.',
      'Исправление: gg-modal-backdrop + createPortal в document.body.',
      'Модалка вынесена на уровень App.tsx (как Settings), ProjectRail — один grid-элемент.',
      'При открытии блокируется прокрутка body.'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 (текущая)',
    deployed: '15.06.2026 16:25',
    title: 'Проекты в rail — алфавитный порядок',
    changes: [
      'Список проектов сортируется по отображаемому названию (A→Я), а не по дате открытия.',
      'Клик по проекту больше не переносит его вверх — остаётся на своём месте.',
      'При запуске по-прежнему открывается последний активный проект (last_project_path).'
    ]
  },
  {
    version: '0.1.0',
    build: '15.06.2026 (текущая)',
    deployed: '15.06.2026 16:19',
    title: 'Переименование проектов и свои иконки',
    changes: [
      'Настройки проекта → «Отображение в списке»: любое название (не имя папки на диске).',
      'Кнопка «Выбрать изображение» — PNG/JPG/WebP, копия в %APPDATA%\\grok-desktop\\project-icons.',
      'Иконка в rail, в шапке чата и в модалке; без иконки — цветной квадрат с буквой.',
      'Миграция БД v12: projects.icon_path; протокол gg-project-icon для отображения.',
      'API: projects:update-meta, pick-icon, clear-icon.'
    ]
  }
]

function heading(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } })
}

function body(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 80 }
  })
}

function bullet(text) {
  return new Paragraph({
    children: [new TextRun({ text: `• ${text}`, size: 22 })],
    indent: { left: 360 },
    spacing: { after: 60 }
  })
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const children = [
    new Paragraph({
      children: [new TextRun({ text: 'Grok Desktop — Журнал изменений', bold: true, size: 36 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 }
    }),
    body(`Обновлено: ${new Date().toLocaleString('ru-RU')}`),
    body('Версия в package.json: 0.1.0'),
    body('Исходники: локальная рабочая копия grok-desktop'),
    body('Установка: %LOCALAPPDATA%\\Programs\\Grok Desktop'),
    body('Правило: после каждого изменения/деплоя агент дописывает запись и перегенерирует этот файл (node scripts/sync-desktop-changelog.cjs).'),
    new Paragraph({ text: '', spacing: { after: 200 } })
  ]

  for (const e of ENTRIES) {
    children.push(heading(e.title))
    children.push(body(`Версия: ${e.version}  |  Сборка: ${e.build}  |  Деплой: ${e.deployed}`))
    for (const c of e.changes) children.push(bullet(c))
  }

  const doc = new Document({ sections: [{ children }] })
  const buf = await Packer.toBuffer(doc)
  const docxPath = path.join(OUT_DIR, `${BASE_NAME}.docx`)
  fs.writeFileSync(docxPath, buf)
  console.log('OK:', docxPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
