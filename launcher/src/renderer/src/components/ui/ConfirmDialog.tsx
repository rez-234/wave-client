import { useRef, type JSX, type ReactNode, type RefObject } from 'react'

import { Button } from './Button'
import { Dialog } from './Dialog'

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
  const cancelButton = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      initialFocus={cancelButton}
      returnFocusTo={returnFocusTo}
      actions={
        <>
          <Button ref={cancelButton} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
