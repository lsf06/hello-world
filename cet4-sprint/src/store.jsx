import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [dashboard, setDashboard] = useState(null)
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState([])
  const toastId = useRef(0)

  const notify = useCallback((message, type = 'success') => {
    const id = ++toastId.current
    setToasts((list) => [...list, { id, message, type }])
    setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id))
    }, 3800)
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const refreshDashboard = useCallback(async () => {
    try {
      const data = await api.get('/api/dashboard')
      setDashboard(data)
      return data
    } catch (err) {
      console.error(err)
      return null
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    try {
      const data = await api.get('/api/settings')
      setSettings(data)
      return data
    } catch (err) {
      console.error(err)
      return null
    }
  }, [])

  useEffect(() => {
    Promise.all([refreshDashboard(), refreshSettings()]).finally(() => setLoading(false))
  }, [refreshDashboard, refreshSettings])

  const value = useMemo(
    () => ({
      dashboard,
      settings,
      loading,
      refreshDashboard,
      refreshSettings,
      notify,
      aiConfigured: Boolean(settings?.ai_configured),
    }),
    [dashboard, settings, loading, refreshDashboard, refreshSettings, notify],
  )

  return (
    <AppContext.Provider value={value}>
      {children}
      <Toasts toasts={toasts} onClose={dismissToast} />
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

function Toasts({ toasts, onClose }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast-${t.type}`} onClick={() => onClose(t.id)}>
          <span className="toast-dot" />
          <span>{t.message}</span>
        </button>
      ))}
    </div>
  )
}