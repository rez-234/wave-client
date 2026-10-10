import { useEffect, useId, useRef, type JSX, type ReactNode, type RefObject } from 'react'

import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
  /** Where focus goes afterwards; by default, back to what had it before the dialog opened. */
  returnFocusTo?: RefObject<HTMLElement | null>
}

/**
 * A modal question with Cancel focused first, so a stray Enter doesn't confirm a destructive
 * action. Escape cancels; focus goes back to where it was.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
  returnFocusTo
}: ConfirmDialogProps): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const bodyId = useId()

  const isOpen = useRef(open)
  /** Set while the dialog is shown, so focus only moves when it actually closes. */
  const shown = useRef(false)

  useEffect(() => {
    isOpen.current = open
    const element = dialog.current

    if (!element) {
      return
    }

    if (open) {
      if (!element.open) {
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        element.showModal()
        shown.current = true
        cancelButton.current?.focus()
      }

      return
    }

    if (element.open) {
      element.close()
    }

    if (!shown.current) {
      return
    }

    shown.current = false

    const target = returnFocusTo?.current ?? returnFocus.current
    returnFocus.current = null

    if (target?.isConnected) {
      target.focus()
    }
  }, [open, returnFocusTo])

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      onCancel={(event) => {
        // Escape: let React close it, so state and focus stay in step.
        event.preventDefault()
        onCancel()
      }}
      onClose={() => {
        // Chromium may close a modal by itself (a repeated Escape); keep the state in step.
        if (isOpen.current) {
          onCancel()
        }
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <div className="dialog__panel">
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        {children && (
          <div id={bodyId} className="dialog__body">
            {children}
          </div>
        )}
        <div className="dialog__actions">
          <Button ref={cancelButton} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
