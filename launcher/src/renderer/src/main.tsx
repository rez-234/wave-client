import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Placeholder until the full UI lands.
function App(): React.JSX.Element {
  return <main style={{ fontFamily: 'system-ui', color: '#E6E6E8', background: '#0F1012', height: '100vh', display: 'grid', placeItems: 'center' }}>Wave Client</main>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
