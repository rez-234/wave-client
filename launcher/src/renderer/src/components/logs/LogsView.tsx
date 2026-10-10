import { Fragment, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'

import type { LogLine } from '@shared/ipc'

import { useClipboard } from '../../hooks/useClipboard'
import { formatClock } from '../../lib/format'
import { LEVEL_FILTERS, MAX_RENDERED_LINES, filterLogLines, formatLogText, isLevelFilter, startsLaunch, visibleWindow, type LevelFilter } from '../../lib/logs'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { LogRow } from './LogRow'

interface LogsViewProps {
  lines: LogLine[]
  onExport: () => Promise<string | null>
  onOpenFolder: () => void
  report: (error: unknown) => void
}

/** How close to the bottom (in pixels) still counts as following the output. */
const STICKY_THRESHOLD = 24

/** The game's output, live: filter by level, search, copy or export. */
export function LogsView({ lines, onExport, onOpenFolder, report }: LogsViewProps): JSX.Element {
  const [level, setLevel] = useState<LevelFilter>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  /** While the user reads older lines, the list stops at this seq so it doesn't move. */
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [copied, copy] = useClipboard(report)
  const scroller = useRef<HTMLDivElement>(null)

  const matching = useMemo(() => filterLogLines(lines, level, deferredQuery), [lines, level, deferredQuery])
  const view = useMemo(() => visibleWindow(matching, pausedAt, MAX_RENDERED_LINES), [matching, pausedAt])
  const newer = pausedAt === null ? 0 : matching.length - view.hidden - view.lines.length
  const filtered = level !== 'all' || deferredQuery.trim() !== ''

  // Follow the output: stay at the bottom while not paused.
  useLayoutEffect(() => {
    const element = scroller.current

    if (element && pausedAt === null) {
      element.scrollTop = element.scrollHeight
    }
  }, [view, pausedAt])

  const onScroll = useCallback(() => {
    const element = scroller.current

    if (!element) {
      return
    }

    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= STICKY_THRESHOLD

    if (atBottom) {
      setPausedAt(null)
    } else {
      setPausedAt((current) => current ?? lines.at(-1)?.seq ?? null)
    }
  }, [lines])

  const jumpToLatest = (): void => {
    setPausedAt(null)
    const element = scroller.current

    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }

  const exportLog = (): void => {
    setExporting(true)
    onExport()
      .then((path) => setSavedPath(path))
      .catch(report)
      .finally(() => setExporting(false))
  }

  return (
    <div className="view logs">
      <header className="page-header">
        <h1 className="page-title">Logs</h1>
        <div className="page-header__actions">
          <Button variant="secondary" size="sm" icon={copied ? 'check' : 'copy'} disabled={matching.length === 0} onClick={() => copy(formatLogText(matching))}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="secondary" size="sm" icon="download" disabled={exporting || lines.length === 0} onClick={exportLog}>
            Export…
          </Button>
          <Button variant="secondary" size="sm" icon="folder" onClick={onOpenFolder}>
            Open logs folder
          </Button>
        </div>
      </header>

      <div className="logs__toolbar" role="search">
        <label className="visually-hidden" htmlFor="log-level">
          Show
        </label>
        <div className="select">
          <select
            id="log-level"
            value={level}
            onChange={(event) => {
              if (isLevelFilter(event.target.value)) {
                setLevel(event.target.value)
                setPausedAt(null)
              }
            }}
          >
            {LEVEL_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
          <Icon name="chevronUpDown" size={14} className="select__icon" />
        </div>
        <div className="search">
          <Icon name="search" size={14} className="search__icon" />
          <label className="visually-hidden" htmlFor="log-search">
            Search the log
          </label>
          <input
            id="log-search"
            className="input search__input"
            type="search"
            placeholder="Search messages, threads and loggers"
            value={query}
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value)
              setPausedAt(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault()
                setQuery('')
              }
            }}
          />
        </div>
        <p className="logs__count">
          {filtered
            ? `${matching.length.toLocaleString('en-US')} of ${lines.length.toLocaleString('en-US')} lines`
            : `${lines.length.toLocaleString('en-US')} lines`}
        </p>
      </div>

      {savedPath && (
        <p className="logs__saved" role="status">
          <Icon name="check" size={14} />
          <span>
            Saved to <span className="mono">{savedPath}</span>
          </span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setSavedPath(null)}>
            <Icon name="close" size={12} />
          </button>
        </p>
      )}

      <div className="logs__panel">
        <div ref={scroller} className="logs__scroller" onScroll={onScroll} tabIndex={0} role="log" aria-label="Game output" aria-live="off">
          {view.hidden > 0 && (
            <p className="logs__note">
              Showing the last {MAX_RENDERED_LINES.toLocaleString('en-US')} of {matching.length.toLocaleString('en-US')} lines
            </p>
          )}
          {view.lines.length === 0 ? (
            <p className="logs__empty">
              {lines.length === 0 ? 'Nothing here yet. Start Minecraft and its output will show up here.' : 'No lines match your filter.'}
            </p>
          ) : (
            <ol className="log-lines">
              {view.lines.map((line, i) => (
                <Fragment key={line.seq}>
                  {startsLaunch(line, view.lines[i - 1]) && (
                    <li className="log-launch" role="separator">
                      Launch {line.session} · {formatClock(line.time)}
                    </li>
                  )}
                  <LogRow line={line} />
                </Fragment>
              ))}
            </ol>
          )}
        </div>
        {pausedAt !== null && (
          <button type="button" className="jump-pill" onClick={jumpToLatest}>
            <Icon name="arrowDown" size={14} />
            Jump to latest{newer > 0 ? ` (${newer.toLocaleString('en-US')} new)` : ''}
          </button>
        )}
      </div>
    </div>
  )
}
