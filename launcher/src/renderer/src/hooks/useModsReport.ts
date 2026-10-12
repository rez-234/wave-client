import { useCallback, useEffect, useRef, useState } from 'react'

import type { ModsReport } from '@shared/ipc'

import { errorMessage } from '../lib/errors'
import { sameReport } from '../lib/mods'

/** How often a visible mods list checks the folder for changes made outside the launcher. */
export const POLL_MS = 2000

export interface ModsReportApi {
  report: ModsReport | null
  /** Why loading failed while there's nothing to show yet. */
  error: string | null
  reload: () => void
  /**
   * Runs a change (turn on/off, remove, add) and shows the report it returns right away. A check
   * that started before the change is dropped when it answers, so it can't bring back the old list.
   */
  change: <T>(run: () => Promise<T>, reportOf: (result: T) => ModsReport) => Promise<T>
}

/**
 * A profile's mods. With `poll`, the folder is checked every 2 s while the window is shown and
 * focused, and again when it gets focus, since players add and remove jars in their file manager.
 */
export function useModsReport(profileId: string | null, poll: boolean): ModsReportApi {
  const [report, setReport] = useState<ModsReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Goes up with every change and every profile switch; an answer from an older generation is stale. */
  const generation = useRef(0)
  const loading = useRef(false)
  const current = useRef(profileId)

  const load = useCallback(() => {
    const id = current.current

    if (id === null || loading.current) {
      return
    }

    const started = generation.current
    loading.current = true
    window.wave.mods
      .list(id)
      .then((next) => {
        if (generation.current === started) {
          setReport((previous) => (sameReport(previous, next) ? previous : next))
          setError(null)
        }
      })
      .catch((reason: unknown) => {
        if (generation.current === started) {
          setError(errorMessage(reason, "Couldn't read this profile's mods."))
        }
      })
      .finally(() => {
        loading.current = false
      })
  }, [])

  useEffect(() => {
    current.current = profileId
    generation.current++
    loading.current = false
    setReport(null)
    setError(null)
    load()
  }, [profileId, load])

  useEffect(() => {
    if (!poll || profileId === null) {
      return
    }

    const tick = (): void => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        load()
      }
    }

    const timer = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', load)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [poll, profileId, load])

  const change = useCallback(async <T>(run: () => Promise<T>, reportOf: (result: T) => ModsReport): Promise<T> => {
    const id = current.current
    generation.current++
    const result = await run()
    const next = reportOf(result)

    if (current.current === id && next.profileId === id) {
      generation.current++
      setReport(next)
      setError(null)
    }

    return result
  }, [])

  return { report, error, reload: load, change }
}
