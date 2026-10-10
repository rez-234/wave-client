import { useCallback } from 'react'

import { useFlash } from './useFlash'

/** Copies text and briefly reports success; failures go to `report`. */
export function useClipboard(report: (error: unknown) => void): [copied: boolean, copy: (text: string) => void] {
  const [copied, flash] = useFlash(1600)

  const copy = useCallback(
    (text: string) => {
      if (!navigator.clipboard) {
        report(new Error("Couldn't copy to the clipboard."))
        return
      }

      navigator.clipboard
        .writeText(text)
        .then(flash)
        .catch(() => report(new Error("Couldn't copy to the clipboard.")))
    },
    [flash, report]
  )

  return [copied, copy]
}
