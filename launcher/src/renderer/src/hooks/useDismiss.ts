import { useEffect, type RefObject } from 'react'

/**
 * Closes a popover on Escape or on a press outside of it (and outside its trigger, which toggles
 * it by itself).
 */
export function useDismiss(open: boolean, refs: ReadonlyArray<RefObject<HTMLElement | null>>, onDismiss: (reason: 'escape' | 'outside') => void): void {
  useEffect(() => {
    if (!open) {
      return
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target

      if (target instanceof Node && !refs.some((ref) => ref.current?.contains(target))) {
        onDismiss('outside')
      }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onDismiss('escape')
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, refs, onDismiss])
}
