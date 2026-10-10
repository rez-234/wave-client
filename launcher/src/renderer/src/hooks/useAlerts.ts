import { useCallback, useState } from 'react'

import { errorMessage } from '../lib/errors'

export interface AlertItem {
  id: number
  message: string
}

const MAX_ALERTS = 3
let nextId = 1

export interface Alerts {
  alerts: AlertItem[]
  /** Shows the message of a rejected wave.* call (or any error) until it's dismissed. */
  report: (error: unknown) => void
  dismiss: (id: number) => void
}

/** Messages from failed calls, shown as dismissible alerts. The same message is only shown once. */
export function useAlerts(): Alerts {
  const [alerts, setAlerts] = useState<AlertItem[]>([])

  const report = useCallback((error: unknown) => {
    const message = errorMessage(error)
    setAlerts((current) => {
      const others = current.filter((alert) => alert.message !== message)
      return [...others, { id: nextId++, message }].slice(-MAX_ALERTS)
    })
  }, [])

  const dismiss = useCallback((id: number) => {
    setAlerts((current) => current.filter((alert) => alert.id !== id))
  }, [])

  return { alerts, report, dismiss }
}
