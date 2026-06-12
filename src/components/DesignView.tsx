import { useProject } from '../store/projectStore'

/**
 * Дизайн-студия — агент-нативная генерация дизайн-артефактов внутри Verstak
 * (минимальный аналог open-design). Пресет формирует сильный промпт и
 * отправляет его в композер через событие gg-inject-prompt, затем
 * переключает на чат — агент генерирует self-contained HTML через
 * инструмент generate_html. Готовые артефакты показываются галереей с
 * превью (ArtifactPreview через setPreviewArtifact).
 *
 * V1: пресеты + галерея артефактов текущей сессии. Персистентные проекты,
 * деки-шаблоны, экспорт в PDF/PPTX/MP4 — следующие итерации.
 */

interface DesignViewProps {
  /** Переключение на вкладку чата после выбора пресета. */
  onGoToChat: () => void
}

interface Preset {
  icon: string
  title: string
  desc: string
  prompt: string
}

// Общий хвост для всех пресетов: требуем один самодостаточный HTML-артефакт
// через инструмент generate_html (инлайновый CSS, без внешних зависимостей).
const ARTIFACT_TAIL =
  'Сгенерируй результат как один самодостаточный HTML-файл через инструмент generate_html: ' +
  'весь CSS инлайново в <style>, без внешних зависимостей и CDN, адаптивная вёрстка, ' +
  'аккуратная типографика и отступы, современный чистый стиль. Дай осмысленное имя файла.'

const PRESETS: Preset[] = [
  {
    icon: '🖼',
    title: 'Прототип экрана',
    desc: 'Одностраничный HTML-прототип сайта или экрана приложения',
    prompt:
      'Спроектируй и собери прототип экрана. Сначала кратко уточни у меня тип (лендинг / дашборд / ' +
      'мобильный экран / форма) и тему, если не указано. ' + ARTIFACT_TAIL
  },
  {
    icon: '📊',
    title: 'Дашборд',
    desc: 'KPI-стена с карточками метрик и графиками',
    prompt:
      'Собери дашборд: сетка карточек ключевых метрик (значение + дельта + подпись), ' +
      '2–3 блока под графики, шапка с фильтром периода. Используй render_chart для графиков, ' +
      'если уместно. ' + ARTIFACT_TAIL
  },
  {
    icon: '🎞',
    title: 'Презентация',
    desc: 'Слайды-деки в журнальном стиле',
    prompt:
      'Собери презентацию-деку из 5–7 слайдов (титул, проблема, решение, как работает, ' +
      'результаты, призыв). Каждый слайд — отдельная секция на всю высоту экрана, ' +
      'навигация стрелками/скроллом, единая тема и крупная типографика. ' + ARTIFACT_TAIL
  },
  {
    icon: '🛬',
    title: 'Лендинг',
    desc: 'Продающая посадочная страница',
    prompt:
      'Собери продающий лендинг: герой с заголовком и CTA, блок выгод, как работает, ' +
      'соцдоказательство, тарифы, FAQ, финальный CTA, футер. ' + ARTIFACT_TAIL
  },
  {
    icon: '✉️',
    title: 'Email-письмо',
    desc: 'HTML-письмо для рассылки',
    prompt:
      'Собери HTML-письмо для рассылки: шапка с логотипом-плейсхолдером, заголовок, ' +
      'тело с одним ключевым сообщением, заметная кнопка CTA, футер с отпиской. ' +
      'Вёрстка таблицами для совместимости с почтовыми клиентами, ширина 600px. ' + ARTIFACT_TAIL
  },
  {
    icon: '🛒',
    title: 'Карточка товара',
    desc: 'Карточка для маркетплейса / каталога',
    prompt:
      'Собери карточку товара: галерея-плейсхолдер, название, цена, рейтинг, ' +
      'ключевые характеристики списком, описание, кнопки «В корзину» / «Купить». ' + ARTIFACT_TAIL
  }
]

export function DesignView({ onGoToChat }: DesignViewProps) {
  const artifacts = useProject(s => s.artifacts)
  const setPreviewArtifact = useProject(s => s.setPreviewArtifact)
  const htmlArtifacts = artifacts.filter(a => a.kind === 'html')

  const runPreset = (preset: Preset) => {
    window.dispatchEvent(new CustomEvent('gg-inject-prompt', { detail: preset.prompt }))
    onGoToChat()
  }

  return (
    <div className="gg-design-view">
      <div className="gg-design-head">
        <h2>🎨 Дизайн-студия</h2>
        <p>Опиши задачу — агент соберёт дизайн как готовый HTML-артефакт. Выбери шаблон для старта.</p>
      </div>

      <div className="gg-design-presets">
        {PRESETS.map(p => (
          <button key={p.title} className="gg-design-preset" onClick={() => runPreset(p)}>
            <span className="gg-design-preset-icon">{p.icon}</span>
            <span className="gg-design-preset-title">{p.title}</span>
            <span className="gg-design-preset-desc">{p.desc}</span>
          </button>
        ))}
      </div>

      <div className="gg-design-gallery">
        <h3>Артефакты сессии</h3>
        {htmlArtifacts.length === 0 ? (
          <p className="gg-design-empty">
            Пока пусто. Выбери шаблон выше или попроси в чате — сгенерированные HTML-артефакты появятся здесь.
          </p>
        ) : (
          <div className="gg-design-cards">
            {htmlArtifacts.map((a, i) => (
              <button
                key={`${a.path}-${i}`}
                className="gg-design-card"
                onClick={() => setPreviewArtifact(a.path)}
                title={`Открыть превью\n${a.path}`}
              >
                <span className="gg-design-card-icon">📄</span>
                <span className="gg-design-card-name">{a.filename}</span>
                <span className="gg-design-card-meta">{(a.sizeBytes / 1024).toFixed(1)} KB</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
