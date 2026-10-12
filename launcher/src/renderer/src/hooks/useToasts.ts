import { useCallback, useState } from 'react'

import type { ToastContent } from '../lib/mods'

export interface ToastItem extends ToastContent {
  id: number
}

export interface Toasts {
  toasts: ToastItem[]
  /** Shows a short notice at the bottom of the window; it goes away by itself. */
  show: (content: ToastContent) => void
  dismiss: (id: number) => void
}

const MAX_TOASTS = 3
let nextId = 1

/** Notices about something that worked (or partly worked), such as mods being added. Errors use alerts. */
export function useToasts(): Toasts {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback((content: ToastContent) => {
    setToasts((current) => [...current, { ...content, id: nextId++ }].slice(-MAX_TOASTS))
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  return { toasts, show, dismiss }
}
