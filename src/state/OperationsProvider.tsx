import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { loadOperationsState, saveOperationsState } from '../data/persistence'
import { appReducer, type AppFrame, type OperationAction } from './operationsReducer'

interface OperationsContextValue {
  frame: AppFrame
  dispatch: (action: OperationAction) => void
  storageAvailable: boolean
}

const OperationsContext = createContext<OperationsContextValue | null>(null)

export function OperationsProvider({ children }: { children: ReactNode }) {
  const [frame, dispatch] = useReducer(appReducer, undefined, (): AppFrame => ({ data: loadOperationsState(), feedback: null, sequence: 0 }))
  const [storageAvailable, setStorageAvailable] = useState(true)

  useEffect(() => {
    setStorageAvailable(saveOperationsState(frame.data))
  }, [frame.data])

  useEffect(() => {
    const hasOfferAwaiting = frame.data.offers.some((offer) => offer.status === 'Awaiting Response')
    if (!hasOfferAwaiting) return
    const timer = window.setInterval(() => dispatch({ type: 'offer.expire-due', now: Date.now() }), 5_000)
    return () => window.clearInterval(timer)
  }, [frame.data.offers])

  const value = useMemo(() => ({ frame, dispatch, storageAvailable }), [frame, storageAvailable])
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>
}

export function useOperations() {
  const context = useContext(OperationsContext)
  if (!context) throw new Error('useOperations must be used inside OperationsProvider')
  return context
}
