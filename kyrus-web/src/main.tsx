import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const legacyCentroCustoCacheKeys = [
  'boletim.selectedCentroCustoId',
  'home.selectedCentroCustoId.default',
  'home.selectedCentroCustoId',
]

for (const cacheKey of legacyCentroCustoCacheKeys) {
  localStorage.removeItem(cacheKey)
}

const temaSalvo = localStorage.getItem('theme')
const temaInicial = temaSalvo === 'dark' ? 'dark' : 'light'
document.documentElement.classList.toggle('dark', temaInicial === 'dark')
document.body.classList.toggle('dark', temaInicial === 'dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
