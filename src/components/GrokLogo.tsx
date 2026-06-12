/**
 * GrokLogo — фирменный знак Grok Desktop: двойной диагональный штрих.
 * Монохром: рисуется currentColor, фон и размер задаёт контейнер.
 * Геометрия повторяет resources/icon.svg (источник иконки приложения).
 */
interface Props {
  size?: number
  className?: string
}

export function GrokLogo({ size = 24, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 17.5 16.4 6.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M13.3 17.5 17.5 11.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
