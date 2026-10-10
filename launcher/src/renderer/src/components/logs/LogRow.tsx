import { memo, type JSX } from 'react'

import type { LogLine } from '@shared/ipc'

import { formatClock } from '../../lib/format'
import { levelTone } from '../../lib/logs'

/** One line of output: time, level, where it came from (dimmed), the message and any stack trace. */
export const LogRow = memo(function LogRow({ line }: { line: LogLine }): JSX.Element {
  const tone = levelTone(line.level)
  const source = [line.thread, line.logger].filter((part): part is string => typeof part === 'string' && part !== '').join(' / ')

  return (
    <li className={`log-line log-line--${tone}`}>
      <span className="log-line__time">{formatClock(line.time)}</span>
      <span className="log-line__level">{line.level}</span>
      <span className="log-line__content">
        {source && <span className="log-line__source">[{source}] </span>}
        <span className="log-line__message">{line.message}</span>
        {line.throwable && (
          <details className="log-line__throwable">
            <summary>Stack trace</summary>
            <pre>{line.throwable}</pre>
          </details>
        )}
      </span>
    </li>
  )
})
