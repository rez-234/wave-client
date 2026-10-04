import type { LogLevel } from '@shared/ipc'

/** One parsed line of game output, before the launcher numbers it. */
export interface ParsedLog {
  time: number
  level: LogLevel
  thread: string | null
  logger: string | null
  message: string
  throwable?: string
}

const EVENT_START = '<log4j:Event'
const EVENT_END = '</log4j:Event>'
/** Output that never closes an event is given up on and shown as plain text past this size. */
const MAX_PENDING = 1 << 20
const LEVELS = new Set<LogLevel>(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])

/**
 * Parses the game's stdout incrementally. Minecraft's log config writes each record as a
 * log4j XML event; anything else (JVM warnings, output before logging starts, other mods
 * printing directly) comes through as plain lines. Chunks can split anywhere.
 */
export class LogStreamParser {
  private pending = ''

  constructor(private readonly now: () => number = Date.now) {}

  /** Feeds a chunk of output and returns the complete records in it. */
  push(chunk: string): ParsedLog[] {
    this.pending += chunk
    const out: ParsedLog[] = []

    for (;;) {
      const start = this.pending.indexOf(EVENT_START)

      if (start < 0) {
        // No event in sight: emit complete plain lines, keeping a tail that could begin an event.
        const lastNewline = this.pending.lastIndexOf('\n')

        if (lastNewline >= 0) {
          this.plain(this.pending.slice(0, lastNewline), out)
          this.pending = this.pending.slice(lastNewline + 1)
        }

        if (this.pending.length > MAX_PENDING) {
          this.plain(this.pending, out)
          this.pending = ''
        }

        return out
      }

      if (start > 0) {
        this.plain(this.pending.slice(0, start), out)
        this.pending = this.pending.slice(start)
      }

      const end = this.pending.indexOf(EVENT_END)

      if (end < 0) {
        if (this.pending.length > MAX_PENDING) {
          this.plain(this.pending, out)
          this.pending = ''
        }

        return out
      }

      const event = parseEvent(this.pending.slice(0, end + EVENT_END.length))

      if (event) {
        out.push(event)
      } else {
        this.plain(this.pending.slice(0, end + EVENT_END.length), out)
      }

      this.pending = this.pending.slice(end + EVENT_END.length)
    }
  }

  /** Returns whatever is left when the stream ends. */
  flush(): ParsedLog[] {
    const out: ParsedLog[] = []
    this.plain(this.pending, out)
    this.pending = ''
    return out
  }

  private plain(text: string, out: ParsedLog[]): void {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trimEnd()

      if (line.trim().length > 0) {
        out.push(plainLine(line, this.now()))
      }
    }
  }
}

function parseEvent(xml: string): ParsedLog | null {
  const open = /^<log4j:Event\b([^>]*)>/.exec(xml)

  if (!open) {
    return null
  }

  const attributes = parseAttributes(open[1]!)
  const level = (attributes.level ?? 'INFO').toUpperCase()
  const timestamp = Number(attributes.timestamp)
  const message = elementText(xml, 'log4j:Message') ?? ''
  const throwable = elementText(xml, 'log4j:Throwable')

  return {
    time: Number.isFinite(timestamp) ? timestamp : Date.now(),
    level: LEVELS.has(level as LogLevel) ? (level as LogLevel) : 'INFO',
    thread: attributes.thread ?? null,
    logger: attributes.logger ?? null,
    message: message.replace(/\r?\n$/, ''),
    ...(throwable ? { throwable: throwable.replace(/\s+$/, '') } : {})
  }
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {}

  for (const match of text.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]!] = decodeEntities(match[3] ?? match[4] ?? '')
  }

  return attributes
}

/** The text of the first <tag>…</tag>: CDATA sections joined, entities decoded elsewhere. */
function elementText(xml: string, tag: string): string | undefined {
  const start = xml.indexOf(`<${tag}>`)

  if (start < 0) {
    return undefined
  }

  const contentStart = start + tag.length + 2
  const end = xml.indexOf(`</${tag}>`, contentStart)

  if (end < 0) {
    return undefined
  }

  const content = xml.slice(contentStart, end)
  let text = ''
  let index = 0

  // A message containing "]]>" is written as several CDATA sections back to back.
  for (const match of content.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    text += decodeEntities(content.slice(index, match.index)) + match[1]
    index = match.index + match[0].length
  }

  return text + decodeEntities(content.slice(index))
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (entity, code: string) => {
    switch (code) {
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'amp':
        return '&'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default: {
        const value = code.startsWith('#x') ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : entity
      }
    }
  })
}

/** "[12:34:56] [Render thread/INFO]: message" and similar plain-text log lines. */
const PATTERN_LINE = /^\[(?:\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s*\[([^\]/]+)\/([A-Z]+)\](?:\s*\(([^)]*)\))?:?\s?(.*)$/

function plainLine(line: string, time: number): ParsedLog {
  const match = PATTERN_LINE.exec(line)

  if (match && LEVELS.has(match[2] as LogLevel)) {
    return { time, level: match[2] as LogLevel, thread: match[1]!, logger: match[3] ?? null, message: match[4]! }
  }

  return { time, level: guessLevel(line), thread: null, logger: null, message: line }
}

function guessLevel(line: string): LogLevel {
  if (/\b(FATAL|Exception in thread|#\s*A fatal error has been detected)\b/.test(line)) {
    return 'FATAL'
  }

  if (/\b(ERROR|Exception|Error:)\b/.test(line) || /^\s+at [\w$.<>]+\(/.test(line) || /^Caused by: /.test(line)) {
    return 'ERROR'
  }

  if (/\b(WARN|WARNING)\b/.test(line)) {
    return 'WARN'
  }

  return 'INFO'
}
