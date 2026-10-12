import { useEffect, useId, useRef, type JSX, type ReactNode, type RefObject } from 'react'

interface DialogProps {
  open: boolean
  title: string
  children?: ReactNode
  /** The buttons at the bottom, in reading order (the main action last). */
  actions: ReactNode
  /** Escape, a click on the backdrop, or the browser closing it. */
  onClose: () => void
  /** Makes the dialog a form: Enter in a field submits it. */
  onSubmit?: () => void
  /** Focused when it opens. */
  initialFocus?: RefObject<HTMLElement | null>
  /** Where focus goes afterwards; by default, back to what had it before the dialog opened. */
  returnFocusTo?: RefObject<HTMLElement | null>
  /** While a request runs, Escape and the backdrop don't close it. */
  busy?: boolean
  /** Wider panel for forms. */
  wide?: boolean
}

/** A modal: focus moves in when it opens and back when it closes; Escape closes it. */
export function Dialog({ open, title, children, actions, onClose, onSubmit, initialFocus, returnFocusTo, busy = false, wide = false }: DialogProps): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const bodyId = useId()
  const isOpen = useRef(open)
  /** Set while the dialog is shown, so focus only moves when it actually closes. */
  const shown = useRef(false)
  const dismiss = (): void => {
    if (!busy) {
      onClose()
    }
  }

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
        initialFocus?.current?.focus()
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
  }, [open, initialFocus, returnFocusTo])

  const panel = (
    <>
      <h2 id={titleId} className="dialog__title">
        {title}
      </h2>
      {children && (
        <div id={bodyId} className="dialog__body">
          {children}
        </div>
      )}
      <div className="dialog__actions">{actions}</div>
    </>
  )

  return (
    <dialog
      ref={dialog}
      className={`dialog${wide ? ' dialog--wide' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={children && !onSubmit ? bodyId : undefined}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        // Escape: let React close it, so state and focus stay in step.
        event.preventDefault()
        dismiss()
      }}
      onClose={() => {
        // Chromium may close a modal by itself (a repeated Escape); keep the state in step.
        if (isOpen.current) {
          onClose()
        }
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) {
          dismiss()
        }
      }}
    >
      {onSubmit ? (
        <form
          className="dialog__panel"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()

            if (!busy) {
              onSubmit()
            }
          }}
        >
          {panel}
        </form>
      ) : (
        <div className="dialog__panel">{panel}</div>
      )}
    </dialog>
  )
}
