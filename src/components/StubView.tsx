interface StubViewProps {
  title: string
  description: string
}

export function StubView({ title, description }: StubViewProps) {
  return (
    <div className="gg-panel">
      <div className="gg-panel-header">
        <h2 className="gg-panel-title">{title}</h2>
        <div className="gg-panel-meta">скоро</div>
      </div>
      <div className="gg-panel-body">
        <div className="gg-panel-empty">{description}</div>
      </div>
    </div>
  )
}
