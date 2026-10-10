import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX } from 'react'

import type { AccountView } from '@shared/ipc'

import { useDismiss } from '../hooks/useDismiss'
import { Avatar } from './ui/Avatar'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Icon } from './ui/Icon'

interface AccountSwitcherProps {
  accounts: AccountView[]
  onSelect: (account: AccountView) => void
  onAddAccount: () => void
  onSignOut: (account: AccountView) => void
}

/** The current account at the bottom of the sidebar, with a popover to switch, add or sign out. */
export function AccountSwitcher({ accounts, onSelect, onAddAccount, onSignOut }: AccountSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<AccountView | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const refs = useMemo(() => [trigger, popover], [])
  const popoverId = useId()
  const current = accounts.find((account) => account.selected) ?? null

  const close = useCallback((returnFocus = true) => {
    setOpen(false)

    if (returnFocus) {
      trigger.current?.focus()
    }
  }, [])

  useDismiss(open, refs, (reason) => close(reason === 'escape'))

  // Keyboard users land on the current account (or the first one) when the popover opens.
  useEffect(() => {
    if (open) {
      const target = popover.current?.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? popover.current?.querySelector<HTMLButtonElement>('button')
      target?.focus()
    }
  }, [open])

  if (accounts.length === 0) {
    return (
      <div className="account-switcher account-switcher--empty">
        <p className="account-switcher__empty-text">Not signed in</p>
        <button type="button" className="btn btn--secondary btn--sm account-switcher__sign-in" onClick={onAddAccount}>
          Sign in
        </button>
      </div>
    )
  }

  const run = (action: () => void): void => {
    close()
    action()
  }

  return (
    <div className="account-switcher">
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {current ? <Avatar name={current.name} size={32} muted={current.status === 'expired'} /> : <span className="avatar avatar--empty" aria-hidden="true" />}
        <span className="account-trigger__text">
          <span className="account-trigger__name">{current ? current.name : 'Choose an account'}</span>
          <span className={`account-trigger__status${current?.status === 'expired' ? ' account-trigger__status--warn' : ''}`}>
            {!current ? `${accounts.length} signed in` : current.status === 'expired' ? 'Sign-in expired' : 'Microsoft account'}
          </span>
        </span>
        <Icon name="chevronUpDown" size={16} className="account-trigger__chevron" />
      </button>
      {open && (
        <div ref={popover} id={popoverId} className="popover account-popover" role="dialog" aria-label="Accounts">
          <p className="popover__heading">Accounts</p>
          <ul className="account-popover__list">
            {accounts.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  className={`account-option${account.selected ? ' account-option--selected' : ''}`}
                  aria-current={account.selected ? 'true' : undefined}
                  onClick={() => run(() => onSelect(account))}
                >
                  <Avatar name={account.name} size={28} muted={account.status === 'expired'} />
                  <span className="account-option__text">
                    <span className="account-option__name">{account.name}</span>
                    {account.status === 'expired' ? (
                      <span className="account-option__status account-option__status--warn">Sign in again</span>
                    ) : account.selected ? (
                      <span className="account-option__status">Current account</span>
                    ) : (
                      <span className="account-option__status">Switch to this account</span>
                    )}
                  </span>
                  {account.selected && <Icon name="check" size={16} className="account-option__check" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="popover__divider" />
          <button type="button" className="menu-item" onClick={() => run(onAddAccount)}>
            <Icon name="plus" size={16} />
            Add account
          </button>
          {current && (
            <button
              type="button"
              className="menu-item menu-item--danger"
              onClick={() => {
                setOpen(false)
                setConfirming(current)
              }}
            >
              <Icon name="signOut" size={16} />
              Sign out of {current.name}
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? `Sign out of ${confirming.name}?` : 'Sign out?'}
        confirmLabel="Sign out"
        returnFocusTo={trigger}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const account = confirming
          setConfirming(null)

          if (account) {
            onSignOut(account)
          }
        }}
      >
        Wave Client will forget this account. You can sign in again at any time.
      </ConfirmDialog>
    </div>
  )
}
