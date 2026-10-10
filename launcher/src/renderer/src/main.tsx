import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import tokens from '../../../../shared/design-tokens.json'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { cssVariables } from './lib/tokens'

// The design tokens shared with the mod become CSS custom properties before anything renders.
for (const [name, value] of Object.entries(cssVariables(tokens))) {
  document.documentElement.style.setProperty(name, value)
}

const root = document.getElementById('root')

if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary scope="app">
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}
