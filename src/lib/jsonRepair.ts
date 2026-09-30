/**
 * Best-effort cleanup for "almost JSON" text: config files with comments,
 * JavaScript object literals, Python `repr` output, and truncated log dumps.
 *
 * The pass is deliberately conservative. Anything it does not recognise is
 * copied through untouched so the validator can still report it honestly,
 * and every change it does make is named in `fixes`.
 */

import { escapeJsonString } from './jsonEngine'

export interface RepairResult {
  text: string
  fixes: string[]
  changed: boolean
}

const FIX_COMMENTS = 'Removed comments'
const FIX_SINGLE_QUOTES = 'Rewrote single-quoted strings'
const FIX_SMART_QUOTES = 'Replaced typographic quotes'
const FIX_KEYS = 'Quoted bare property names'
const FIX_VALUES = 'Quoted bare text values'
const FIX_TRAILING_COMMA = 'Removed trailing commas'
const FIX_MISSING_COMMA = 'Inserted missing commas'
const FIX_LITERALS = 'Normalized Python and JavaScript literals'
const FIX_NUMBERS = 'Normalized number formats'
const FIX_STRAY = 'Removed stray characters'
const FIX_TRUNCATED = 'Completed truncated structures'

const LITERAL_REPLACEMENTS = new Map<string, string>([
  ['True', 'true'],
  ['TRUE', 'true'],
  ['False', 'false'],
  ['FALSE', 'false'],
  ['None', 'null'],
  ['Null', 'null'],
  ['NULL', 'null'],
  ['nil', 'null'],
  ['undefined', 'null'],
  ['NaN', 'null'],
  ['Infinity', 'null'],
])

const OPENING_QUOTES = new Map<string, string[]>([
  ["'", ["'"]],
  ['‘', ['’', "'"]],
  ['’', ['’', "'"]],
  ['“', ['”', '"']],
  ['”', ['”', '"']],
])

const IDENTIFIER_START = /[A-Za-z_$]/
const IDENTIFIER_PART = /[A-Za-z0-9_$.-]/

const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= '0' && char <= '9'

const isWhitespace = (char: string): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r'

const isValueStart = (char: string): boolean =>
  char === '{' ||
  char === '[' ||
  char === '"' ||
  char === '-' ||
  char === '+' ||
  char === '.' ||
  isDigit(char) ||
  OPENING_QUOTES.has(char) ||
  IDENTIFIER_START.test(char)

/** Resolves backslash escapes from loosely quoted (often JS) source text. */
const decodeLooseEscapes = (value: string): string => {
  let result = ''

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (char !== '\\') {
      result += char
      continue
    }

    const next = value[index + 1]
    index += 1

    switch (next) {
      case 'n':
        result += '\n'
        break
      case 'r':
        result += '\r'
        break
      case 't':
        result += '\t'
        break
      case 'b':
        result += '\b'
        break
      case 'f':
        result += '\f'
        break
      case 'u': {
        const hex = value.slice(index + 1, index + 5)

        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16))
          index += 4
          break
        }

        result += 'u'
        break
      }
      default:
        result += next ?? ''
    }
  }

  return result
}

export const repairJson = (text: string): RepairResult => {
  const parts: string[] = []
  const fixes: string[] = []
  const openStack: string[] = []
  let index = 0
  let lastSignificant = ''

  const addFix = (fix: string): void => {
    if (!fixes.includes(fix)) {
      fixes.push(fix)
    }
  }

  const emit = (value: string): void => {
    if (value.length === 0) {
      return
    }

    parts.push(value)
    const trimmed = value.trimEnd()

    if (trimmed.length > 0) {
      lastSignificant = trimmed[trimmed.length - 1]
    }
  }

  /** Next meaningful character, looking past whitespace and comments. */
  const peekSignificant = (from: number): string | undefined => {
    let cursor = from

    while (cursor < text.length) {
      const char = text[cursor]

      if (isWhitespace(char)) {
        cursor += 1
        continue
      }

      if (char === '/' && text[cursor + 1] === '/') {
        const newline = text.indexOf('\n', cursor)
        cursor = newline === -1 ? text.length : newline + 1
        continue
      }

      if (char === '/' && text[cursor + 1] === '*') {
        const close = text.indexOf('*/', cursor + 2)
        cursor = close === -1 ? text.length : close + 2
        continue
      }

      return char
    }

    return undefined
  }

  /** True when a value may not directly follow what was emitted last. */
  const needsSeparator = (): boolean =>
    lastSignificant === '}' ||
    lastSignificant === ']' ||
    lastSignificant === '"' ||
    /[0-9A-Za-z]/.test(lastSignificant)

  const copyDoubleQuoted = (): void => {
    const start = index
    index += 1

    while (index < text.length) {
      const char = text[index]

      if (char === '\\') {
        index += 2
        continue
      }

      if (char === '"') {
        index += 1
        emit(text.slice(start, index))

        return
      }

      index += 1
    }

    // Truncated input: close the string so the rest can still be read.
    emit(`${text.slice(start, index)}"`)
    addFix(FIX_TRUNCATED)
  }

  const rewriteLooseQuoted = (opener: string): void => {
    const closers = OPENING_QUOTES.get(opener)!
    index += 1

    const start = index
    let closed = false

    while (index < text.length) {
      const char = text[index]

      if (char === '\\') {
        index += 2
        continue
      }

      if (closers.includes(char)) {
        closed = true
        break
      }

      index += 1
    }

    const body = text.slice(start, index)

    if (closed) {
      index += 1
    } else {
      addFix(FIX_TRUNCATED)
    }

    emit(escapeJsonString(decodeLooseEscapes(body)))
    addFix(opener === "'" ? FIX_SINGLE_QUOTES : FIX_SMART_QUOTES)
  }

  const readIdentifier = (): string => {
    const start = index

    while (index < text.length && IDENTIFIER_PART.test(text[index])) {
      index += 1
    }

    return text.slice(start, index)
  }

  const rewriteNumber = (): void => {
    const start = index
    let sign = ''

    if (text[index] === '+') {
      index += 1
      addFix(FIX_NUMBERS)
    } else if (text[index] === '-') {
      index += 1
      sign = '-'
    }

    if (text.startsWith('Infinity', index)) {
      index += 'Infinity'.length
      emit('null')
      addFix(FIX_LITERALS)

      return
    }

    if (
      text[index] === '0' &&
      (text[index + 1] === 'x' || text[index + 1] === 'X')
    ) {
      const hexStart = index + 2
      let cursor = hexStart

      while (cursor < text.length && /[0-9a-fA-F]/.test(text[cursor])) {
        cursor += 1
      }

      if (cursor > hexStart) {
        const value = Number.parseInt(text.slice(hexStart, cursor), 16)
        index = cursor
        emit(`${sign}${value}`)
        addFix(FIX_NUMBERS)

        return
      }
    }

    let digits = ''

    while (isDigit(text[index])) {
      digits += text[index]
      index += 1
    }

    let fraction = ''
    let sawDot = false

    if (text[index] === '.') {
      sawDot = true
      index += 1

      while (isDigit(text[index])) {
        fraction += text[index]
        index += 1
      }
    }

    let exponent = ''

    if (text[index] === 'e' || text[index] === 'E') {
      const exponentStart = index
      let cursor = index + 1
      let exponentSign = ''

      if (text[cursor] === '+' || text[cursor] === '-') {
        exponentSign = text[cursor]
        cursor += 1
      }

      let exponentDigits = ''

      while (isDigit(text[cursor])) {
        exponentDigits += text[cursor]
        cursor += 1
      }

      if (exponentDigits.length > 0) {
        exponent = `e${exponentSign}${exponentDigits}`
        index = cursor
      } else {
        index = exponentStart
      }
    }

    if (digits.length === 0 && fraction.length === 0) {
      // Not a number after all - hand the characters back untouched.
      index = start
      emit(text[index])
      index += 1
      addFix(FIX_STRAY)

      return
    }

    const normalizedDigits =
      digits.length === 0 ? '0' : digits.replace(/^0+(?=\d)/, '')
    const normalized = `${sign}${normalizedDigits}${
      fraction.length > 0 ? `.${fraction}` : ''
    }${exponent}`

    if (normalized !== text.slice(start, index) || (sawDot && fraction.length === 0)) {
      addFix(FIX_NUMBERS)
    }

    emit(normalized)
  }

  while (index < text.length) {
    const char = text[index]

    if (isWhitespace(char)) {
      emit(char)
      index += 1
      continue
    }

    if (char === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index)
      index = newline === -1 ? text.length : newline
      addFix(FIX_COMMENTS)
      continue
    }

    if (char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2)
      index = close === -1 ? text.length : close + 2
      addFix(FIX_COMMENTS)
      continue
    }

    if (char === ',') {
      const next = peekSignificant(index + 1)

      if (next === undefined || next === '}' || next === ']') {
        index += 1
        addFix(FIX_TRAILING_COMMA)
        continue
      }

      emit(',')
      index += 1
      continue
    }

    if (char === ';') {
      index += 1
      addFix(FIX_STRAY)
      continue
    }

    if (needsSeparator() && isValueStart(char)) {
      emit(',')
      addFix(FIX_MISSING_COMMA)
    }

    if (char === '{' || char === '[') {
      openStack.push(char === '{' ? '}' : ']')
      emit(char)
      index += 1
      continue
    }

    if (char === '}' || char === ']') {
      if (openStack.length > 0) {
        openStack.pop()
      }

      emit(char)
      index += 1
      continue
    }

    if (char === ':') {
      emit(':')
      index += 1
      continue
    }

    if (char === '"') {
      copyDoubleQuoted()
      continue
    }

    if (OPENING_QUOTES.has(char)) {
      rewriteLooseQuoted(char)
      continue
    }

    if (char === '+' || char === '-' || isDigit(char) || char === '.') {
      rewriteNumber()
      continue
    }

    if (IDENTIFIER_START.test(char)) {
      const word = readIdentifier()

      if (word === 'true' || word === 'false' || word === 'null') {
        emit(word)
        continue
      }

      const replacement = LITERAL_REPLACEMENTS.get(word)

      if (replacement !== undefined) {
        emit(replacement)
        addFix(FIX_LITERALS)
        continue
      }

      emit(escapeJsonString(word))
      addFix(peekSignificant(index) === ':' ? FIX_KEYS : FIX_VALUES)
      continue
    }

    // Unrecognised: keep it so the validator can point at the real problem.
    emit(char)
    index += 1
  }

  if (lastSignificant === ':') {
    emit('null')
    addFix(FIX_TRUNCATED)
  }

  while (openStack.length > 0) {
    emit(openStack.pop()!)
    addFix(FIX_TRUNCATED)
  }

  const repaired = parts.join('')

  return {
    text: repaired,
    fixes,
    changed: repaired !== text,
  }
}
