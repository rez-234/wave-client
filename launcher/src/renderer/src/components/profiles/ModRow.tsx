import { memo, type JSX } from 'react'

import type { IncludedMod, ModFix, ModView } from '@shared/ipc'

import { formatBytes } from '../../lib/format'
import { hasError, modStateText, orderedProblems } from '../../lib/mods'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Menu } from '../ui/Menu'
import { Switch } from '../ui/Switch'
import { ModIcon } from './ModIcon'

interface ModRowProps {
  profileId: string
  mod: ModView
  /** Minecraft is running with this profile: the switch and Remove are off. */
  readOnly: boolean
  /** A change to this mod is on its way. */
  pending: boolean
  onToggle: (mod: ModView, enabled: boolean) => void
  onRemove: (mod: ModView) => void
  onFix: (fix: ModFix) => void
  onFindOnModrinth: (modId: string) => void
}

/** One jar in the mods folder: what it is, whether it's on, and what's wrong with it. */
export const ModRow = memo(function ModRow({ profileId, mod, readOnly, pending, onToggle, onRemove, onFix, onFindOnModrinth }: ModRowProps): JSX.Element {
  const state = modStateText(mod)
  const problems = orderedProblems(mod.problems)
  const tone = hasError(mod) ? ' mod-row--error' : ''

  return (
    <li className={`mod-row${mod.enabled ? '' : ' mod-row--off'}${!mod.loads && mod.enabled ? ' mod-row--ignored' : ''}${tone}`}>
      <div className="mod-row__main">
        <span className="mod-row__icon">
          <ModIcon profileId={profileId} modKey={mod.key} name={mod.name} size={mod.size} hasIcon={mod.hasIcon} />
        </span>
        <div className="mod-row__text">
          <p className="mod-row__title">
            <span className="mod-row__name">{mod.name}</span>
            {mod.version && <span className="mod-row__version">{mod.version}</span>}
            {state && <span className={`badge${mod.enabled ? ' badge--muted' : ''}`}>{state}</span>}
          </p>
          <p className="mod-row__file" title={`${mod.file} · ${formatBytes(mod.size)}`}>
            {mod.file}
          </p>
        </div>
        <div className="mod-row__controls">
          <Switch checked={mod.enabled} label={`${mod.name}, ${mod.enabled ? 'on' : 'off'}`} disabled={readOnly || pending} onChange={(enabled) => onToggle(mod, enabled)} />
          <Menu
            label={`${mod.name} actions`}
            align="end"
            items={[
              {
                key: 'remove',
                label: 'Remove…',
                icon: 'trash',
                danger: true,
                disabled: readOnly || pending,
                detail: readOnly ? 'Close Minecraft first' : undefined,
                onSelect: () => onRemove(mod)
              }
            ]}
            trigger={(props) => (
              <button {...props} type="button" className="icon-button icon-button--md" aria-label={`More actions for ${mod.name}`}>
                <Icon name="more" size={18} />
              </button>
            )}
          />
        </div>
      </div>
      {problems.length > 0 && (
        <ul className="mod-problems" aria-label={`Problems with ${mod.name}`}>
          {problems.map((problem, i) => (
            <li key={`${problem.code}-${i}`} className={`mod-problem mod-problem--${problem.severity}`}>
              <Icon name="alert" size={14} className="mod-problem__icon" />
              <span className="visually-hidden">{problem.severity === 'error' ? 'Error: ' : 'Warning: '}</span>
              <span className="mod-problem__text">
                {problem.message}
                {problem.detail && <span className="mod-problem__detail">{problem.detail}</span>}
              </span>
              {(problem.fix || (problem.code === 'missing' && problem.modId)) && (
                <span className="mod-problem__actions">
                  {problem.fix && (
                    <Button variant="secondary" size="sm" disabled={readOnly} onClick={() => problem.fix && onFix(problem.fix)}>
                      {problem.fix.label}
                    </Button>
                  )}
                  {problem.code === 'missing' && problem.modId && (
                    <Button variant="ghost" size="sm" trailingIcon="external" onClick={() => problem.modId && onFindOnModrinth(problem.modId)}>
                      Find on Modrinth
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
})

/** Wave Client or Fabric API: always loaded, so no switch and no Remove. */
export function IncludedRow({ mod }: { mod: IncludedMod }): JSX.Element {
  return (
    <li className="mod-row mod-row--included">
      <div className="mod-row__main">
        <span className="mod-row__icon">
          <span className="mod-icon mod-icon--included" aria-hidden="true">
            <span className="mod-icon__letter">{mod.id === 'waveclient' ? 'W' : 'F'}</span>
          </span>
        </span>
        <div className="mod-row__text">
          <p className="mod-row__title">
            <span className="mod-row__name">{mod.name}</span>
            <span className="mod-row__version">{mod.version}</span>
          </p>
          <p className="mod-row__file">Included with Wave Client</p>
        </div>
        <div className="mod-row__controls">
          <span className="mod-row__always">Always on</span>
        </div>
      </div>
    </li>
  )
}
