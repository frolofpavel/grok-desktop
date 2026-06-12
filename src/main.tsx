import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrapTheme } from './hooks/useTheme'
import './styles/theme.css'
import './styles/layout.css'
import './styles/markdown.css'

void bootstrapTheme()
createRoot(document.getElementById('root')!).render(<App />)
