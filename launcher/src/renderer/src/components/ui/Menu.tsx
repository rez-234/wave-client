import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

import { useDismiss } from '../../hooks/useDismiss'
import { Icon, type IconName } from './Icon'

export type MenuEntry =
  | {
      kind?: 'item'
      key: string
      label: string
      /** A second, dimmer line (a profile's version and mods, or why the item is unavailable). */
      detail?: string
      icon?: IconName
      danger?: boolean
      disabled?: boolean
      /** Set for a choice among several (the profile picker): shows a check on the chosen one. */
      checked?: boolean
      onSelect: () => void
    }
  | { kind: 'divider'; key: string }

type MenuItem = Extract<MenuEntry, { onSelect: () => void }>

/** Spread onto the button that opens the menu. */
export interface MenuTriggerProps {
  ref: RefObject<HTMLButtonElement | null>
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

interface MenuProps {
  /** Renders the button that opens the menu. */
  trigger: (props: MenuTriggerProps) => ReactNode
  items: readonly MenuEntry[]
  /** The menu's accessible name. */
  label: string
  align?: 'start' | 'end'
  className?: string
}

function isItem(entry: MenuEntry): entry is MenuItem {
  return entry.kind !== 'divider'
}

/**
 * A button that opens a list of actions. Arrow keys, Home and End move between the actions,
 * Escape closes it and focus goes back to the button. It opens upwards when there's no room below.
 */
export function Menu({ trigger, items, label, align = 'start', className }: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [above, setAbove] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const refs = useMemo(() => [button, popover], [])
  /** Which item to focus once the menu is drawn: the chosen one, the first, or the last. */
  const focusOnOpen = useRef<'first' | 'last'>('first')
  const menuId = useId()

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)

    if (returnFocus) {
      button.current?.focus()
    }
  }, [])

  useDismiss(open, refs, (reason) => close(reason === 'escape'))

  const menuItems = (): HTMLElement[] => Array.from(popover.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])

  // Before paint: flip upwards if the menu would run off the bottom, then move focus in.
  useLayoutEffect(() => {
    if (!open) {
      setAbove(false)
      return
    }

    const rect = popover.current?.getBoundingClientRect()
    const anchor = button.current?.getBoundingClientRect()

    if (rect && anchor && rect.bottom > window.innerHeight - 8 && anchor.top - rect.height - 8 > 0) {
      setAbove(true)
    }

    const elements = menuItems()
    const checked = elements.find((element) => element.getAttribute('aria-checked') === 'true')
    const target = focusOnOpen.current === 'last' ? elements.at(-1) : (checked ?? elements[0])
    target?.focus()
  }, [open])

  const openWith = (focus: 'first' | 'last'): void => {
    focusOnOpen.current = focus
    setOpen(true)
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openWith(event.key === 'ArrowUp' ? 'last' : 'first')
    }
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const elements = menuItems()
    const index = elements.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined

    if (event.key === 'ArrowDown') {
      next = elements[(index + 1) % elements.length]
    } else if (event.key === 'ArrowUp') {
      next = elements[(index - 1 + elements.length) % elements.length]
    } else if (event.key === 'Home') {
      next = elements[0]
    } else if (event.key === 'End') {
      next = elements.at(-1)
    } else if (event.key === 'Tab') {
      setOpen(false)
      return
    }

    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  const select = (item: MenuItem): void => {
    if (item.disabled) {
      return
    }

    // Focus goes back to the button first, so a dialog the action opens returns focus there.
    close(true)
    item.onSelect()
  }

  const radio = items.some((entry) => isItem(entry) && entry.checked !== undefined)

  return (
    <div className="menu">
      {trigger({
        ref: button,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: () => (open ? close(false) : openWith('first')),
        onKeyDown: onTriggerKeyDown
      })}
      {open && (
        <div
          ref={popover}
          id={menuId}
          role="menu"
          aria-label={label}
          className={['popover', 'menu__popover', `menu__popover--${align}`, above ? 'menu__popover--above' : '', className].filter(Boolean).join(' ')}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((entry) =>
            isItem(entry) ? (
              <button
                key={entry.key}
                type="button"
                role={radio ? 'menuitemradio' : 'menuitem'}
                aria-checked={radio ? entry.checked === true : undefined}
                aria-disabled={entry.disabled || undefined}
                tabIndex={-1}
                className={['menu-item', 'menu__item', entry.danger ? 'menu-item--danger' : '', entry.disabled ? 'menu__item--disabled' : '', entry.detail ? 'menu__item--two-line' : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => select(entry)}
              >
                {entry.icon && <Icon name={entry.icon} size={16} />}
                <span className="menu__text">
                  <span className="menu__label">{entry.label}</span>
                  {entry.detail && <span className="menu__detail">{entry.detail}</span>}
                </span>
                {radio && <Icon name="check" size={16} className={`menu__check${entry.checked ? '' : ' menu__check--hidden'}`} />}
              </button>
            ) : (
              <div key={entry.key} className="popover__divider" role="separator" />
            )
          )}
        </div>
      )}
    </div>
  )
}
