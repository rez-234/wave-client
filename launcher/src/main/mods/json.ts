/**
 * JSON as Fabric Loader reads fabric.mod.json and fabric_loader_dependencies.json: its bundled
 * Gson JsonReader with lenient = false. That is stricter than people expect (no comments, no
 * trailing commas, no single quotes) and laxer than JSON.parse in a few places Fabric relies on
 * or tolerates: one leading byte order mark is skipped, anything after the root value is never
 * read, true/false/null may be upper case, \' and an escaped line break are valid escapes, and
 * control characters inside strings are kept. Objects keep their keys in order, duplicates
 * included, because Fabric's parsers act on each key as it comes.
 */

export type JsonValue =
  | { type: 'object'; entries: Array<[string, JsonValue]> }
  | { type: 'array'; items: JsonValue[] }
  | { type: 'string'; value: string }
  | { type: 'number'; raw: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }

export class JsonSyntaxError extends Error {
  constructor(message: string, at: number) {
    super(`${message} at character ${at + 1}`)
    this.name = 'JsonSyntaxError'
  }
}

/** Gson's own guard is the Java stack; a fixed depth keeps a hostile file from overflowing ours. */
const MAX_DEPTH = 512

export function parseFabricJson(text: string): JsonValue {
  const reader = new Reader(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  return reader.value(0)
}

class Reader {
  private pos = 0

  constructor(private readonly s: string) {}

  value(depth: number): JsonValue {
    if (depth > MAX_DEPTH) {
      this.fail('Nested too deeply')
    }

    const c = this.nextNonWhitespace()

    switch (c) {
      case '{':
        return this.object(depth)
      case '[':
        return this.array(depth)
      case '"':
        return { type: 'string', value: this.string() }
      case undefined:
        return this.fail('End of input')
      default:
        this.pos--
        return this.literal()
    }
  }

  private object(depth: number): JsonValue {
    const entries: Array<[string, JsonValue]> = []
    let c = this.nextNonWhitespace()

    if (c === '}') {
      return { type: 'object', entries }
    }

    for (;;) {
      if (c !== '"') {
        this.fail('Expected name')
      }

      const name = this.string()

      if (this.nextNonWhitespace() !== ':') {
        this.fail("Expected ':'")
      }

      entries.push([name, this.value(depth + 1)])
      c = this.nextNonWhitespace()

      if (c === '}') {
        return { type: 'object', entries }
      }

      if (c !== ',') {
        this.fail('Unterminated object')
      }

      c = this.nextNonWhitespace()
    }
  }

  private array(depth: number): JsonValue {
    const items: JsonValue[] = []
    let c = this.nextNonWhitespace()

    if (c === ']') {
      return { type: 'array', items }
    }

    this.pos--

    for (;;) {
      c = this.peekNonWhitespace()

      if (c === ',' || c === ']' || c === ';') {
        // ",]" and "[,": Gson reads an empty value only when lenient.
        this.fail('Unexpected value')
      }

      items.push(this.value(depth + 1))
      c = this.nextNonWhitespace()

      if (c === ']') {
        return { type: 'array', items }
      }

      if (c !== ',') {
        this.fail('Unterminated array')
      }
    }
  }

  /** After the opening quote. */
  private string(): string {
    let out = ''
    let start = this.pos

    for (;;) {
      const i = this.pos

      if (i >= this.s.length) {
        this.fail('Unterminated string')
      }

      const c = this.s[i]
      this.pos++

      if (c === '"') {
        return out + this.s.slice(start, i)
      }

      if (c === '\\') {
        out += this.s.slice(start, i) + this.escape()
        start = this.pos
      }
    }
  }

  private escape(): string {
    const c = this.s[this.pos++]

    switch (c) {
      case 'u': {
        const hex = this.s.slice(this.pos, this.pos + 4)

        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.fail('Invalid escape sequence')
        }

        this.pos += 4
        return String.fromCharCode(parseInt(hex, 16))
      }
      case 't':
        return '\t'
      case 'b':
        return '\b'
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 'f':
        return '\f'
      case '\n':
      case "'":
      case '"':
      case '\\':
      case '/':
        return c
      default:
        return this.fail(c === undefined ? 'Unterminated escape sequence' : 'Invalid escape sequence')
    }
  }

  /** true/false/null (any mix of upper and lower case per letter, like Gson) or a number. */
  private literal(): JsonValue {
    const rest = this.s.slice(this.pos)

    for (const [word, value] of [
      ['true', { type: 'boolean', value: true }],
      ['false', { type: 'boolean', value: false }],
      ['null', { type: 'null' }]
    ] as const) {
      const candidate = rest.slice(0, word.length)

      if (candidate.toLowerCase() === word && [...candidate].every((ch, k) => ch === word[k] || ch === word[k]!.toUpperCase()) && !isLiteral(rest[word.length])) {
        this.pos += word.length
        return value
      }
    }

    const match = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(rest)

    if (match && !isLiteral(rest[match[0].length])) {
      this.pos += match[0].length
      return { type: 'number', raw: match[0] }
    }

    // An unquoted string: lenient only.
    return this.fail(rest.length === 0 ? 'End of input' : 'Expected value')
  }

  private nextNonWhitespace(): string | undefined {
    while (this.pos < this.s.length) {
      const c = this.s[this.pos++]!

      if (c !== ' ' && c !== '\n' && c !== '\t' && c !== '\r') {
        if (c === '/' || c === '#') {
          // Comments: lenient only.
          this.fail('Comments are not allowed')
        }

        return c
      }
    }

    return undefined
  }

  private peekNonWhitespace(): string | undefined {
    const c = this.nextNonWhitespace()
    if (c !== undefined) this.pos--
    return c
  }

  private fail(message: string): never {
    throw new JsonSyntaxError(message, Math.max(0, this.pos - 1))
  }
}

/** Characters that may continue an unquoted literal (Gson isLiteral). End of input ends it. */
function isLiteral(c: string | undefined): boolean {
  return c !== undefined && !'{}[]:, \t\f\r\n/\\;#='.includes(c)
}

/** A value from JSON.parse, in the same shape (keys in JavaScript's order, which differs only for numeric keys). */
export function fromJs(value: unknown): JsonValue {
  if (value === null) return { type: 'null' }
  if (typeof value === 'string') return { type: 'string', value }
  if (typeof value === 'number') return { type: 'number', raw: String(value) }
  if (typeof value === 'boolean') return { type: 'boolean', value }
  if (Array.isArray(value)) return { type: 'array', items: value.map(fromJs) }
  if (typeof value === 'object') return { type: 'object', entries: Object.entries(value).map(([k, v]) => [k, fromJs(v)]) }
  return { type: 'null' }
}
