import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import './styles/global.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

const mechanismFixture = new URLSearchParams(window.location.search).get('mechanismFixture')
const root = createRoot(rootElement)

if (import.meta.env.MODE === 'test' && (mechanismFixture === 'humanoid' || mechanismFixture === 'cnc')) {
  void import('./features/scene/v5/MechanismTreeViewportFixtureApp.js').then(({ MechanismTreeViewportFixtureApp }) => {
    root.render(<MechanismTreeViewportFixtureApp mechanismFixture={mechanismFixture} />)
  })
} else {
  root.render(<App />)
}
