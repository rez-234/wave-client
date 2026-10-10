import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'

import { formatMemory } from '../../lib/format'
import { memoryRange } from '../../lib/settings'
import { SettingRow } from './SettingRow'

interface MemorySettingProps {
  memoryMb: number
  totalMemoryMb: number
  limits: { min: number; max: number } | undefined
  disabled: boolean
  onSave: (memoryMb: number) => Promise<unknown>
}

/** Waits this long after the slider stops moving before saving, so dragging doesn't write the file on every step. */
const SAVE_DELAY_MS = 300

export function MemorySetting({ memoryMb, totalMemoryMb, limits, disabled, onSave }: MemorySettingProps): JSX.Element {
  const range = memoryRange(limits)
  const [draft, setDraft] = useState<number | null>(null)
  const timer = useRef<number | null>(null)
  const value = draft ?? memoryMb
  const fixed = range.max <= range.min

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
      }
    },
    []
  )

  const change = (next: number): void => {
    setDraft(next)

    if (timer.current !== null) {
      window.clearTimeout(timer.current)
    }

    timer.current = window.setTimeout(() => {
      timer.current = null
      // Whatever happens, show what the main process has afterwards.
      void onSave(next).finally(() => setDraft((current) => (current === next ? null : current)))
    }, SAVE_DELAY_MS)
  }

  return (
    <SettingRow
      id="memory"
      htmlFor="memory-slider"
      label="Memory"
      stacked
      aside={
        <output className="setting-row__value" htmlFor="memory-slider">
          {formatMemory(value)}
        </output>
      }
      description={
        fixed
          ? 'This computer has little memory, so Minecraft gets 1 GB.'
          : `How much memory Minecraft may use. Recommended: 4–6 GB. This computer has ${formatMemory(totalMemoryMb)}.`
      }
    >
      <input
        id="memory-slider"
        className="slider"
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={Math.min(range.max, Math.max(range.min, value))}
        disabled={disabled || fixed}
        aria-describedby="memory-description"
        aria-valuetext={formatMemory(value)}
        style={
          { '--fill': `${fixed ? 100 : ((Math.min(range.max, Math.max(range.min, value)) - range.min) / (range.max - range.min)) * 100}%` } as CSSProperties
        }
        onChange={(event) => change(Number(event.target.value))}
      />
      <div className="slider__scale" aria-hidden="true">
        <span>{formatMemory(range.min)}</span>
        <span>{formatMemory(range.max)}</span>
      </div>
    </SettingRow>
  )
}
