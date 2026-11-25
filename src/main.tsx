import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { OperationsProvider } from './state/OperationsProvider'
import 'leaflet/dist/leaflet.css'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <OperationsProvider>
        <App />
      </OperationsProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
)
