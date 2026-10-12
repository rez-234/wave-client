import { useState, type JSX } from 'react'

import type { ProfileView } from '@shared/ipc'

import { selectBlocker } from '../../lib/profiles'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'

interface UseForPlayProps {
  profile: ProfileView
  busy: boolean
  report: (error: unknown) => void
}

/** "Selected" for the profile Play launches; a button to make it so for the others. */
export function UseForPlay({ profile, busy, report }: UseForPlayProps): JSX.Element {
  const [pending, setPending] = useState(false)
  const blocker = selectBlocker(profile, busy)

  if (profile.selected) {
    return (
      <span className="badge badge--accent">
        <Icon name="check" size={14} />
        Selected for Play
      </span>
    )
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      icon="play"
      disabled={blocker !== null || pending}
      title={blocker ?? undefined}
      aria-label={`Use ${profile.name} for Play`}
      onClick={() => {
        setPending(true)
        window.wave.profiles
          .select(profile.id)
          .catch(report)
          .finally(() => setPending(false))
      }}
    >
      Use for Play
    </Button>
  )
}
