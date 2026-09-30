/**
 * Hand-written JSON reader/writer.
 *
 * `JSON.parse` is avoided on purpose: it drops the original property order for
 * integer-like keys, collapses duplicate keys silently, loses the exact text of
 * large numbers, and reports errors differently in every engine. Parsing into an
 * explicit node tree keeps the document loss-free and gives precise
 * line/column diagnostics.
 */

export interface JsonEntry {
  key: string
  node: JsonNode
}

export type JsonNode =
  | { kind: 'object'; entries: JsonEntry[] }
  | { kind: 'array'; items: JsonNode[] }
  | { kind: 'string'; value: string }
  | { kind: 'number'; raw: string; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }

export type JsonNodeKind = JsonNode['kind']

export interface JsonParseFailure {
  message: string
  line: number
  column: number
  position: number
}

export interface JsonParseWarning {
  message: string
  path: string
}

export type JsonParseResult =
  | { ok: true; root: JsonNode; warnings: JsonParseWarning[] }
  | { ok: false; error: JsonParseFailure }

export interface JsonStats {
  objects: number
  arrays: number
  strings: number
  numbers: number
  booleans: number
  nulls: number
  properties: number
  uniqueKeys: number
  maxDepth: number
  totalNodes: number
}

export type SortDirection = 'asc' | 'desc'

/** Guards against stack overflow on hostile or generated input. */
const MAX_DEPTH = 400

const BOM = 0xfeff

const textEncoder = new TextEncoder()

class JsonSyntaxError extends Error {
  readonly position: number

  constructor(message: string, position: number) {
    super(message)
    this.name = 'JsonSyntaxError'
    this.position = position
  }
}

const isDigit = (code: number): boolean => code >= 48 && code <= 57

const isHexDigit = (code: number): boolean =>
  isDigit(code) ||
  (code >= 97 && code <= 102) ||
  (code >= 65 && code <= 70)

const describeCharacter = (char: string | undefined): string =>
  char === undefined ? 'end of input' : `"${char}"`

const toUnicodeEscape = (code: number): string =>
  `\\u${code.toString(16).padStart(4, '0')}`

/**
 * True when `value` holds a character that cannot be copied straight through:
 * a quote, a backslash, a control character, or any surrogate code unit.
 */
const needsEscaping = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code < 0x20 || code === 0x22 || code === 0x5c) {
      return true
    }

    if (code >= 0xd800 && code <= 0xdfff) {
      return true
    }
  }

  return false
}

/** Quotes and escapes `value` as a JSON string literal. */
export const escapeJsonString = (value: string): string => {
  if (!needsEscaping(value)) {
    return `"${value}"`
  }

  let output = '"'

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    switch (char) {
      case '"':
        output += '\\"'
        break
      case '\\':
        output += '\\\\'
        break
      case '\b':
        output += '\\b'
        break
      case '\f':
        output += '\\f'
        break
      case '\n':
        output += '\\n'
        break
      case '\r':
        output += '\\r'
        break
      case '\t':
        output += '\\t'
        break
      default: {
        const code = value.charCodeAt(index)

        if (code < 0x20) {
          output += toUnicodeEscape(code)
          break
        }

        // Keep well-formed surrogate pairs intact and escape lone surrogates so
        // the result is always valid UTF-8 encodable JSON.
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = value.charCodeAt(index + 1)

          if (next >= 0xdc00 && next <= 0xdfff) {
            output += char + value[index + 1]
            index += 1
          } else {
            output += toUnicodeEscape(code)
          }

          break
        }

        if (code >= 0xdc00 && code <= 0xdfff) {
          output += toUnicodeEscape(code)
          break
        }

        output += char
      }
    }
  }

  return `${output}"`
}

/** Canonical path form used everywhere in the app: `$["users"][0]["name"]`. */
export const appendKeyToPath = (path: string, key: string): string =>
  `${path}[${escapeJsonString(key)}]`

export const appendIndexToPath = (path: string, index: number): string =>
  `${path}[${index}]`

/** Converts a character offset into 1-based line and column numbers. */
export const locateOffset = (
  text: string,
  offset: number,
): { line: number; column: number } => {
  const limit = Math.max(0, Math.min(offset, text.length))
  let line = 1
  let lineStart = 0

  for (let cursor = 0; cursor < limit; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) {
      line += 1
      lineStart = cursor + 1
    }
  }

  return { line, column: limit - lineStart + 1 }
}

/** Renders the offending source line with a caret under the error column. */
export const buildErrorExcerpt = (
  text: string,
  line: number,
  column: number,
  width = 96,
): string => {
  const lineText = text.split(/\r\n|\r|\n/)[line - 1] ?? ''
  const windowStart = Math.max(0, column - 1 - Math.floor(width / 2))
  const visible = lineText.slice(windowStart, windowStart + width)
  const caretOffset = Math.max(0, column - 1 - windowStart)

  return `${visible}\n${' '.repeat(caretOffset)}^`
}

export const parseJson = (text: string): JsonParseResult => {
  const warnings: JsonParseWarning[] = []
  let index = text.charCodeAt(0) === BOM ? 1 : 0
  let depth = 0

  const fail = (message: string, at: number = index): never => {
    throw new JsonSyntaxError(message, at)
  }

  const skipWhitespace = (): void => {
    while (index < text.length) {
      const code = text.charCodeAt(index)

      if (code === 32 || code === 9 || code === 10 || code === 13) {
        index += 1
        continue
      }

      return
    }
  }

  const readEscape = (): string => {
    const char = text[index]
    index += 1

    switch (char) {
      case '"':
        return '"'
      case '\\':
        return '\\'
      case '/':
        return '/'
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      case 'u': {
        for (let offset = 0; offset < 4; offset += 1) {
          if (!isHexDigit(text.charCodeAt(index + offset))) {
            return fail(
              'A \\u escape needs exactly four hexadecimal digits',
              index - 2,
            )
          }
        }

        const code = Number.parseInt(text.slice(index, index + 4), 16)
        index += 4

        return String.fromCharCode(code)
      }
      default:
        return fail(
          `Unsupported escape sequence "\\${char ?? ''}"`,
          index - 2,
        )
    }
  }

  const readString = (): string => {
    const openedAt = index
    index += 1

    let result = ''
    let chunkStart = index

    for (;;) {
      if (index >= text.length) {
        return fail('This string is never closed', openedAt)
      }

      const char = text[index]

      if (char === '"') {
        result += text.slice(chunkStart, index)
        index += 1

        return result
      }

      if (char === '\\') {
        result += text.slice(chunkStart, index)
        index += 1
        result += readEscape()
        chunkStart = index
        continue
      }

      if (text.charCodeAt(index) < 0x20) {
        return fail(
          'Control characters inside strings must be escaped',
          index,
        )
      }

      index += 1
    }
  }

  const readNumber = (): JsonNode => {
    const start = index

    if (text[index] === '-') {
      index += 1
    }

    if (text[index] === '0') {
      index += 1
    } else if (isDigit(text.charCodeAt(index))) {
      while (isDigit(text.charCodeAt(index))) {
        index += 1
      }
    } else {
      return fail('Expected a digit to start this number', index)
    }

    if (text[index] === '.') {
      index += 1

      if (!isDigit(text.charCodeAt(index))) {
        return fail('Expected a digit after the decimal point', index)
      }

      while (isDigit(text.charCodeAt(index))) {
        index += 1
      }
    }

    if (text[index] === 'e' || text[index] === 'E') {
      index += 1

      if (text[index] === '+' || text[index] === '-') {
        index += 1
      }

      if (!isDigit(text.charCodeAt(index))) {
        return fail('Expected a digit in the number exponent', index)
      }

      while (isDigit(text.charCodeAt(index))) {
        index += 1
      }
    }

    const raw = text.slice(start, index)

    return { kind: 'number', raw, value: Number(raw) }
  }

  const readObject = (path: string): JsonNode => {
    const openedAt = index
    index += 1

    const entries: JsonEntry[] = []
    const seenKeys = new Set<string>()

    skipWhitespace()

    if (text[index] === '}') {
      index += 1

      return { kind: 'object', entries }
    }

    for (;;) {
      skipWhitespace()

      if (index >= text.length) {
        return fail('This object is never closed', openedAt)
      }

      if (text[index] !== '"') {
        return fail(
          `Expected a double-quoted property name but found ${describeCharacter(text[index])}`,
          index,
        )
      }

      const key = readString()

      if (seenKeys.has(key)) {
        warnings.push({
          message: `Duplicate property name ${escapeJsonString(key)}`,
          path: `${path}[${escapeJsonString(key)}]`,
        })
      } else {
        seenKeys.add(key)
      }

      skipWhitespace()

      if (text[index] !== ':') {
        return fail(
          `Expected ":" after the property name but found ${describeCharacter(text[index])}`,
          index,
        )
      }

      index += 1
      skipWhitespace()
      entries.push({
        key,
        node: readValue(`${path}[${escapeJsonString(key)}]`),
      })
      skipWhitespace()

      const char = text[index]

      if (char === ',') {
        index += 1
        continue
      }

      if (char === '}') {
        index += 1

        return { kind: 'object', entries }
      }

      return fail(
        `Expected "," or "}" after the property value but found ${describeCharacter(char)}`,
        index,
      )
    }
  }

  const readArray = (path: string): JsonNode => {
    const openedAt = index
    index += 1

    const items: JsonNode[] = []

    skipWhitespace()

    if (text[index] === ']') {
      index += 1

      return { kind: 'array', items }
    }

    for (;;) {
      skipWhitespace()

      if (index >= text.length) {
        return fail('This array is never closed', openedAt)
      }

      items.push(readValue(`${path}[${items.length}]`))
      skipWhitespace()

      const char = text[index]

      if (char === ',') {
        index += 1
        continue
      }

      if (char === ']') {
        index += 1

        return { kind: 'array', items }
      }

      return fail(
        `Expected "," or "]" after the array item but found ${describeCharacter(char)}`,
        index,
      )
    }
  }

  const readValue = (path: string): JsonNode => {
    depth += 1

    if (depth > MAX_DEPTH) {
      return fail(
        `Nesting is deeper than the supported ${MAX_DEPTH} levels`,
        index,
      )
    }

    const node = readValueAtCursor(path)
    depth -= 1

    return node
  }

  const readValueAtCursor = (path: string): JsonNode => {
    const char = text[index]

    if (char === '{') {
      return readObject(path)
    }

    if (char === '[') {
      return readArray(path)
    }

    if (char === '"') {
      return { kind: 'string', value: readString() }
    }

    if (char === '-' || isDigit(text.charCodeAt(index))) {
      return readNumber()
    }

    if (text.startsWith('true', index)) {
      index += 4

      return { kind: 'boolean', value: true }
    }

    if (text.startsWith('false', index)) {
      index += 5

      return { kind: 'boolean', value: false }
    }

    if (text.startsWith('null', index)) {
      index += 4

      return { kind: 'null' }
    }

    return fail(
      `Expected a value but found ${describeCharacter(char)}`,
      index,
    )
  }

  try {
    skipWhitespace()

    if (index >= text.length) {
      fail('There is nothing to parse yet', index)
    }

    const root = readValue('$')
    skipWhitespace()

    if (index < text.length) {
      fail(
        `Unexpected ${describeCharacter(text[index])} after the top-level value`,
        index,
      )
    }

    return { ok: true, root, warnings }
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      const position = Math.max(0, Math.min(error.position, text.length))
      const { line, column } = locateOffset(text, position)

      return {
        ok: false,
        error: { message: error.message, line, column, position },
      }
    }

    throw error
  }
}

/**
 * Serializes a node tree. An empty `indent` produces minified output.
 */
export const stringifyNode = (node: JsonNode, indent: string): string => {
  const parts: string[] = []
  const pretty = indent.length > 0
  const separator = pretty ? ': ' : ':'

  const write = (current: JsonNode, level: number): void => {
    switch (current.kind) {
      case 'object': {
        if (current.entries.length === 0) {
          parts.push('{}')

          return
        }

        const inner = pretty ? `\n${indent.repeat(level + 1)}` : ''
        parts.push('{')

        for (let position = 0; position < current.entries.length; position += 1) {
          const entry = current.entries[position]

          if (position > 0) {
            parts.push(',')
          }

          parts.push(inner, escapeJsonString(entry.key), separator)
          write(entry.node, level + 1)
        }

        parts.push(pretty ? `\n${indent.repeat(level)}}` : '}')

        return
      }
      case 'array': {
        if (current.items.length === 0) {
          parts.push('[]')

          return
        }

        const inner = pretty ? `\n${indent.repeat(level + 1)}` : ''
        parts.push('[')

        for (let position = 0; position < current.items.length; position += 1) {
          if (position > 0) {
            parts.push(',')
          }

          parts.push(inner)
          write(current.items[position], level + 1)
        }

        parts.push(pretty ? `\n${indent.repeat(level)}]` : ']')

        return
      }
      case 'string':
        parts.push(escapeJsonString(current.value))

        return
      case 'number':
        parts.push(current.raw)

        return
      case 'boolean':
        parts.push(current.value ? 'true' : 'false')

        return
      case 'null':
        parts.push('null')
    }
  }

  write(node, 0)

  return parts.join('')
}

const compareKeys = (left: string, right: string): number => {
  const lowerLeft = left.toLowerCase()
  const lowerRight = right.toLowerCase()

  if (lowerLeft < lowerRight) {
    return -1
  }

  if (lowerLeft > lowerRight) {
    return 1
  }

  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

/** Recursively sorts object keys; array order is never touched. */
export const sortNodeKeys = (
  node: JsonNode,
  direction: SortDirection = 'asc',
): JsonNode => {
  const factor = direction === 'asc' ? 1 : -1

  if (node.kind === 'object') {
    const entries = node.entries
      .map((entry) => ({ key: entry.key, node: sortNodeKeys(entry.node, direction) }))
      .sort((left, right) => compareKeys(left.key, right.key) * factor)

    return { kind: 'object', entries }
  }

  if (node.kind === 'array') {
    return {
      kind: 'array',
      items: node.items.map((item) => sortNodeKeys(item, direction)),
    }
  }

  return node
}

export const collectStats = (root: JsonNode): JsonStats => {
  const stats: JsonStats = {
    objects: 0,
    arrays: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    properties: 0,
    uniqueKeys: 0,
    maxDepth: 0,
    totalNodes: 0,
  }

  const uniqueKeys = new Set<string>()
  const pending: { node: JsonNode; depth: number }[] = [{ node: root, depth: 1 }]

  while (pending.length > 0) {
    const { node, depth } = pending.pop()!
    stats.totalNodes += 1
    stats.maxDepth = Math.max(stats.maxDepth, depth)

    switch (node.kind) {
      case 'object':
        stats.objects += 1
        stats.properties += node.entries.length

        for (const entry of node.entries) {
          uniqueKeys.add(entry.key)
          pending.push({ node: entry.node, depth: depth + 1 })
        }

        break
      case 'array':
        stats.arrays += 1

        for (const item of node.items) {
          pending.push({ node: item, depth: depth + 1 })
        }

        break
      case 'string':
        stats.strings += 1
        break
      case 'number':
        stats.numbers += 1
        break
      case 'boolean':
        stats.booleans += 1
        break
      case 'null':
        stats.nulls += 1
    }
  }

  stats.uniqueKeys = uniqueKeys.size

  return stats
}

export const countLines = (text: string): number => {
  if (text.length === 0) {
    return 0
  }

  return text.split(/\r\n|\r|\n/).length
}

export const byteLength = (text: string): number =>
  textEncoder.encode(text).length

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Wraps arbitrary text as an escaped JSON string literal. */
export const escapeToStringLiteral = (text: string): string =>
  escapeJsonString(text)

export type UnescapeResult =
  | { ok: true; text: string }
  | { ok: false; message: string }

/** Turns a JSON string literal (quoted or not) back into raw text. */
export const unescapeFromStringLiteral = (text: string): UnescapeResult => {
  const trimmed = text.trim()

  if (trimmed.length === 0) {
    return { ok: false, message: 'There is nothing to unescape yet' }
  }

  const quoted =
    trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1
      ? trimmed
      : `"${trimmed}"`
  const parsed = parseJson(quoted)

  if (!parsed.ok) {
    return {
      ok: false,
      message: `Not a valid escaped string: ${parsed.error.message.toLowerCase()}`,
    }
  }

  if (parsed.root.kind !== 'string') {
    return { ok: false, message: 'Expected a single quoted string literal' }
  }

  return { ok: true, text: parsed.root.value }
}
