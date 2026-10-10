import { useCallback, useEffect, useRef, useState } from 'react'

/** A flag that turns itself off again after `durationMs`, for "Saved" and "Copied" confirmations. */
export function useFlash(durationMs = 1800): [visible: boolean, flash: () => void] {
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | null>(null)

  const flash = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
    }

    setVisible(true)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setVisible(false)
    }, durationMs)
  }, [durationMs])

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
      }
    },
    []
  )

  return [visible, flash]
}
