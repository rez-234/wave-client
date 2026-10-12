import { useCallback, useId, useMemo, useRef, useState, type DragEvent, type JSX } from 'react'

import type { AddModsResult, AppInfo, ModFix, ModView, ProfileView } from '@shared/ipc'

import { useModsReport } from '../../hooks/useModsReport'
import {
  addResultToast,
  folderNote,
  matchesIncludedQuery,
  modrinthSearchUrl,
  modsSummary,
  problemModCount,
  turnOffQuestion,
  visibleMods,
  type ToastContent
} from '../../lib/mods'
import { trashName, versionLabel } from '../../lib/profiles'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { Spinner } from '../ui/Spinner'
import { IncludedRow, ModRow } from './ModRow'

interface ModsTabProps {
  info: AppInfo
  profile: ProfileView
  /** Start with the Problems filter on (from "Review mods"). */
  initialProblemsOnly: boolean
  onToast: (toast: ToastContent) => void
  report: (error: unknown) => void
}

type Confirm = { kind: 'turn-off'; mod: ModView; question: string } | { kind: 'remove'; mod: ModView }

/** Whether a drag carries files from outside (not text or a link from the page). */
function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

/** A profile's mods: turn them on and off, add and remove them, and fix their problems. */
export function ModsTab({ info, profile, initialProblemsOnly, onToast, report }: ModsTabProps): JSX.Element {
  const { report: mods, error, reload, change } = useModsReport(profile.id, true)
  const [query, setQuery] = useState('')
  const [problemsOnly, setProblemsOnly] = useState(initialProblemsOnly)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** dragenter/dragleave fire for every child the pointer crosses; count them to know when it really left. */
  const dragDepth = useRef(0)
  const searchId = useId()
  const readOnly = profile.running
  const profileId = profile.id

  const shown = useMemo(() => (mods ? visibleMods(mods.mods, query, problemsOnly) : []), [mods, query, problemsOnly])
  const included = useMemo(() => (mods && !problemsOnly ? mods.included.filter((mod) => matchesIncludedQuery(mod, query)) : []), [mods, query, problemsOnly])
  const problemCount = mods ? problemModCount(mods.mods) : 0
  const summary = mods ? modsSummary(mods.mods) : null
  const empty = mods !== null && mods.mods.length === 0

  const setEnabled = useCallback(
    (key: string, enabled: boolean) => {
      setPending((current) => new Set(current).add(key))
      change(
        () => window.wave.mods.setEnabled(profileId, key, enabled),
        (next) => next
      )
        .catch(report)
        .finally(() =>
          setPending((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
        )
    },
    [change, profileId, report]
  )

  const onToggle = useCallback(
    (mod: ModView, enabled: boolean) => {
      const question = enabled ? null : turnOffQuestion(mod)

      if (question) {
        setConfirm({ kind: 'turn-off', mod, question })
      } else {
        setEnabled(mod.key, enabled)
      }
    },
    [setEnabled]
  )

  const onRemove = useCallback((mod: ModView) => setConfirm({ kind: 'remove', mod }), [])

  const onFix = useCallback(
    (fix: ModFix) => {
      const mod = mods?.mods.find((item) => item.key === fix.key)

      if (!mod) {
        reload()
      } else if (fix.kind === 'remove') {
        onRemove(mod)
      } else {
        onToggle(mod, fix.kind === 'enable')
      }
    },
    [mods, reload, onRemove, onToggle]
  )

  const onFindOnModrinth = useCallback((modId: string) => void window.wave.app.openExternal(modrinthSearchUrl(modId)).catch(report), [report])

  const add = (run: () => Promise<AddModsResult>): void => {
    setAdding(true)
    change(run, (result) => result.report)
      .then((result) => {
        const toast = addResultToast(result, profile.name, readOnly)

        if (toast) {
          onToast(toast)
        }
      })
      .catch(report)
      .finally(() => setAdding(false))
  }

  const dropProps = {
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      if (hasFiles(event)) {
        event.preventDefault()
        dragDepth.current++
        setDragging(true)
      }
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (hasFiles(event)) {
        // Without this the drop event never comes.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)

      if (dragDepth.current === 0) {
        setDragging(false)
      }
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = Array.from(event.dataTransfer.files)

      if (files.length > 0) {
        add(() => window.wave.mods.addDropped(profileId, files))
      }
    }
  }

  // A folder that can't be used also comes as a profile problem, which says it already.
  const note = mods && mods.profileProblems.length === 0 ? folderNote(mods.folder) : null

  return (
    <div className={`mods${dragging ? ' mods--dragging' : ''}`} {...dropProps}>
      {readOnly && (
        <Alert tone="info" title="Minecraft is running with this profile. Close it to change its mods.">
          You can still add mods. They take effect next time you play.
        </Alert>
      )}

      <div className="mods__toolbar">
        <div className="search mods__search">
          <Icon name="search" size={14} className="search__icon" />
          <label htmlFor={searchId} className="visually-hidden">
            Search mods
          </label>
          <input
            id={searchId}
            className="input search__input"
            type="search"
            placeholder="Search mods"
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault()
                setQuery('')
              }
            }}
          />
        </div>
        <button
          type="button"
          className={`filter-chip${problemsOnly ? ' filter-chip--on' : ''}${problemCount > 0 ? ' filter-chip--alert' : ''}`}
          aria-pressed={problemsOnly}
          disabled={problemCount === 0 && !problemsOnly}
          onClick={() => setProblemsOnly((on) => !on)}
        >
          Problems ({problemCount})
        </button>
        <span className="spacer" />
        <Button variant="secondary" icon="folder" onClick={() => void window.wave.app.openFolder('mods', profileId).catch(report)}>
          Open mods folder
        </Button>
        <Button variant="primary" icon="plus" disabled={adding} onClick={() => add(() => window.wave.mods.add(profileId))}>
          {adding ? 'Adding…' : 'Add mods…'}
        </Button>
      </div>

      {summary && !empty && (
        <p className="mods__summary" role="status">
          <span>{summary.text}</span>
          {summary.errors && (
            <button type="button" className="link-button mods__summary-errors" onClick={() => setProblemsOnly(true)}>
              {summary.errors}
            </button>
          )}
          {summary.warnings && (
            <button type="button" className="link-button mods__summary-warnings" onClick={() => setProblemsOnly(true)}>
              {summary.warnings}
            </button>
          )}
        </p>
      )}

      {note && (
        <Alert tone={note.tone} className="mods__alert">
          {note.text}
        </Alert>
      )}
      {mods?.profileProblems.map((problem, i) => (
        <Alert key={`${problem.code}-${i}`} tone={problem.severity === 'error' ? 'danger' : 'warn'} className="mods__alert">
          {problem.message}
          {problem.detail && <span className="mod-problem__detail">{problem.detail}</span>}
        </Alert>
      ))}

      {mods === null ? (
        error ? (
          <Alert tone="danger" actions={<Button size="sm" onClick={reload}>Try again</Button>}>
            {error}
          </Alert>
        ) : (
          <div className="mods__loading" role="status">
            <Spinner size={16} />
            Reading mods…
          </div>
        )
      ) : (
        <>
          {empty && (
            <div className="mods__empty">
              <Icon name="upload" size={28} className="mods__empty-icon" />
              <p className="mods__empty-title">No mods yet</p>
              <p className="mods__empty-text">
                Drop .jar files here, or choose Add mods. Wave Client runs Fabric mods made for {versionLabel(profile.gameVersion, info.gameVersions)}.
              </p>
            </div>
          )}
          {!empty && shown.length === 0 && included.length === 0 && (
            <p className="mods__none">{problemsOnly ? 'No mods with problems match.' : 'No mods match your search.'}</p>
          )}
          {shown.length > 0 && (
            <ul className="card mod-list" aria-label={`Mods in ${profile.name}`}>
              {shown.map((mod) => (
                <ModRow
                  key={mod.key}
                  profileId={profileId}
                  mod={mod}
                  readOnly={readOnly}
                  pending={pending.has(mod.key)}
                  onToggle={onToggle}
                  onRemove={onRemove}
                  onFix={onFix}
                  onFindOnModrinth={onFindOnModrinth}
                />
              ))}
            </ul>
          )}
          {included.length > 0 && (
            <section className="mods__included" aria-labelledby="included-title">
              <h2 id="included-title" className="section-title">
                Included with Wave Client
              </h2>
              <ul className="card mod-list">
                {included.map((mod) => (
                  <IncludedRow key={mod.id} mod={mod} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {dragging && (
        <div className="mods__drop" aria-hidden="true">
          <div className="mods__drop-message">
            <Icon name="upload" size={28} />
            <p>Drop to add to {profile.name}</p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm?.kind === 'turn-off'}
        title={confirm?.kind === 'turn-off' ? confirm.question : ''}
        confirmLabel="Turn off"
        tone="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) {
            setEnabled(confirm.mod.key, false)
          }

          setConfirm(null)
        }}
      >
        Minecraft won't start while turned-on mods are missing something they need. Turn those off too, or turn this one back on before you play.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title={confirm ? `Remove ${confirm.mod.name}?` : ''}
        confirmLabel="Remove"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const mod = confirm?.mod
          setConfirm(null)

          if (mod) {
            setPending((current) => new Set(current).add(mod.key))
            change(
              () => window.wave.mods.remove(profileId, mod.key),
              (next) => next
            )
              .catch(report)
              .finally(() =>
                setPending((current) => {
                  const next = new Set(current)
                  next.delete(mod.key)
                  return next
                })
              )
          }
        }}
      >
        {confirm?.mod.file} goes to the {trashName(info.platform)}.
      </ConfirmDialog>
    </div>
  )
}
