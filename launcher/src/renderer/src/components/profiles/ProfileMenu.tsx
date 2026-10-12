import { useRef, useState, type JSX } from 'react'

import type { ProfileView } from '@shared/ipc'

import { errorMessage } from '../../lib/errors'
import { duplicateName, trashName } from '../../lib/profiles'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Dialog } from '../ui/Dialog'
import { Icon } from '../ui/Icon'
import { Menu, type MenuEntry } from '../ui/Menu'
import { NameDialog, type NameDialogRequest } from './NameDialog'

interface ProfileMenuProps {
  profile: ProfileView
  profiles: readonly ProfileView[]
  platform: string
  /** A copy was made: show it. */
  onCreated: (profile: ProfileView) => void
  /** The profile is gone (after Delete). */
  onDeleted: () => void
  report: (error: unknown) => void
  /** Extra classes for the "More" button. */
  className?: string
}

/** The "More" button of a profile (Rename, Duplicate, Open folder, Delete) and the dialogs they open. */
export function ProfileMenu({ profile, profiles, platform, onCreated, onDeleted, report, className }: ProfileMenuProps): JSX.Element {
  const [naming, setNaming] = useState<NameDialogRequest | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Moving to the trash failed: the reason, and whether deleting outright is under way. */
  const [deleteFailed, setDeleteFailed] = useState<{ message: string; busy: boolean } | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const cancelPermanent = useRef<HTMLButtonElement>(null)
  const trash = trashName(platform)
  const only = profiles.length <= 1

  const remove = (permanently: boolean): void => {
    setDeleteFailed((current) => (current ? { ...current, busy: true } : current))
    window.wave.profiles
      .remove(profile.id, permanently ? { permanently: true } : undefined)
      .then(() => {
        setDeleteFailed(null)
        onDeleted()
      })
      .catch((error: unknown) => setDeleteFailed({ message: errorMessage(error), busy: false }))
  }

  const items: MenuEntry[] = [
    {
      key: 'rename',
      label: 'Rename',
      icon: 'pencil',
      onSelect: () =>
        setNaming({
          title: `Rename ${profile.name}`,
          confirmLabel: 'Rename',
          initialName: profile.name,
          exceptId: profile.id,
          run: (name) => (name === profile.name ? Promise.resolve() : window.wave.profiles.update(profile.id, { name }))
        })
    },
    {
      key: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      onSelect: () =>
        setNaming({
          title: `Duplicate ${profile.name}`,
          confirmLabel: 'Duplicate',
          initialName: duplicateName(profile.name, profiles),
          option: { label: 'Include worlds', initial: false },
          run: (name, worlds) => window.wave.profiles.create({ name, copy: { from: profile.id, what: 'everything', worlds } }).then(onCreated)
        })
    },
    { key: 'folder', label: 'Open folder', icon: 'folder', onSelect: () => void window.wave.app.openFolder('game', profile.id).catch(report) },
    { kind: 'divider', key: 'divider' },
    {
      key: 'delete',
      label: 'Delete…',
      icon: 'trash',
      danger: true,
      disabled: only || profile.running,
      detail: only ? "It's your only profile" : profile.running ? 'Close Minecraft first' : undefined,
      onSelect: () => setConfirmDelete(true)
    }
  ]

  return (
    <>
      <Menu
        label={`${profile.name} actions`}
        align="end"
        items={items}
        trigger={(props) => (
          <button
            {...props}
            ref={(element) => {
              props.ref.current = element
              trigger.current = element
            }}
            type="button"
            className={['icon-button', 'icon-button--md', className].filter(Boolean).join(' ')}
            aria-label={`More actions for ${profile.name}`}
          >
            <Icon name="more" size={18} />
          </button>
        )}
      />

      <NameDialog request={naming} profiles={profiles} onClose={() => setNaming(null)} />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${profile.name}?`}
        confirmLabel={`Move to ${trash}`}
        tone="danger"
        returnFocusTo={trigger}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          remove(false)
        }}
      >
        {profile.name}'s folder, with its worlds, mods and settings, goes to the {trash}. You can restore it from there.
      </ConfirmDialog>

      <Dialog
        open={deleteFailed !== null}
        title={`Couldn't delete ${profile.name}`}
        busy={deleteFailed?.busy}
        initialFocus={cancelPermanent}
        returnFocusTo={trigger}
        onClose={() => setDeleteFailed(null)}
        actions={
          <>
            <Button ref={cancelPermanent} variant="secondary" onClick={() => setDeleteFailed(null)} disabled={deleteFailed?.busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => remove(true)} disabled={deleteFailed?.busy}>
              Delete permanently…
            </Button>
          </>
        }
      >
        <p className="selectable">{deleteFailed?.message}</p>
        <p className="dialog__note">Deleting permanently can't be undone. You'll be asked once more, with what the folder holds.</p>
      </Dialog>
    </>
  )
}
