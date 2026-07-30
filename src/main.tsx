import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import './styles/global.css'
import './styles/v6/index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(<App />)
