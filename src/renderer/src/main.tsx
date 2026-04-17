import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// Apply saved theme before React renders (no flash on load)
const savedTheme = (() => {
  try {
    const raw = localStorage.getItem('theme')
    return raw === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
})()
document.documentElement.classList.add(savedTheme)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
