/**
 * A practical subset of JSONPath evaluated directly against the node tree, so
 * results keep the original property order and number text.
 *
 * Supported syntax:
 *   $                     the whole document
 *   .name / ['name']      a property
 *   [0] / [-1]            an array item, negative counts from the end
 *   [0,2] / ['a','b']     a union of items or properties
 *   [1:4] / [::2]         an array slice with optional step
 *   * / [*]               every child
 *   ..name / ..*          recursive descent
 */

import {
  appendIndexToPath,
  appendKeyToPath,
  type JsonNode,
} from './jsonEngine'

export interface JsonPathMatch {
  path: string
  pointer: string
  node: JsonNode
}

export type JsonPathResult =
  | { ok: true; matches: JsonPathMatch[]; truncated: boolean }
  | { ok: false; message: string }

type Selector =
  | { type: 'names'; names: string[] }
  | { type: 'indices'; indices: number[] }
  | { type: 'slice'; start: number | null; end: number | null; step: number }
  | { type: 'wildcard' }

interface PathSegment {
  deep: boolean
  selector: Selector
}

export type ParsedJsonPath =
  | { ok: true; segments: PathSegment[] }
  | { ok: false; message: string }

type PathStep =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }

interface Candidate {
  steps: PathStep[]
  node: JsonNode
}

/** Keeps `$..*` on a large document from locking up the UI. */
const MATCH_LIMIT = 5000

const INTEGER_PATTERN = /^-?\d+$/

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const resolveIndex = (value: number, length: number): number =>
  value < 0 ? value + length : value

const unquote = (value: string): string => {
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

/** Splits on `separator` while ignoring separators inside quoted parts. */
const splitOutsideQuotes = (body: string, separator: string): string[] => {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]

    if (quote !== null) {
      current += char

      if (char === '\\') {
        current += body[index + 1] ?? ''
        index += 1
      } else if (char === quote) {
        quote = null
      }

      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }

    if (char === separator) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  parts.push(current)

  return parts
}

const isQuoted = (value: string): boolean =>
  value.length >= 2 &&
  ((value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")))

const parseSliceBound = (
  value: string,
): { ok: true; bound: number | null } | { ok: false; message: string } => {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return { ok: true, bound: null }
  }

  if (!INTEGER_PATTERN.test(trimmed)) {
    return { ok: false, message: `"${trimmed}" is not a whole number` }
  }

  return { ok: true, bound: Number.parseInt(trimmed, 10) }
}

const parseBracketBody = (
  body: string,
): { ok: true; selector: Selector } | { ok: false; message: string } => {
  const trimmed = body.trim()

  if (trimmed.length === 0) {
    return { ok: false, message: 'Empty brackets - use [0], [*], or [\'name\']' }
  }

  if (trimmed === '*') {
    return { ok: true, selector: { type: 'wildcard' } }
  }

  const sliceParts = splitOutsideQuotes(trimmed, ':')

  if (sliceParts.length > 1) {
    if (sliceParts.length > 3) {
      return { ok: false, message: 'A slice takes at most [start:end:step]' }
    }

    const start = parseSliceBound(sliceParts[0])

    if (!start.ok) {
      return start
    }

    const end = parseSliceBound(sliceParts[1])

    if (!end.ok) {
      return end
    }

    const step = parseSliceBound(sliceParts[2] ?? '')

    if (!step.ok) {
      return step
    }

    if (step.bound === 0) {
      return { ok: false, message: 'A slice step cannot be 0' }
    }

    return {
      ok: true,
      selector: {
        type: 'slice',
        start: start.bound,
        end: end.bound,
        step: step.bound ?? 1,
      },
    }
  }

  const parts = splitOutsideQuotes(trimmed, ',').map((part) => part.trim())

  if (parts.some((part) => part.length === 0)) {
    return { ok: false, message: 'A union cannot contain empty entries' }
  }

  if (parts.every((part) => INTEGER_PATTERN.test(part))) {
    return {
      ok: true,
      selector: {
        type: 'indices',
        indices: parts.map((part) => Number.parseInt(part, 10)),
      },
    }
  }

  return {
    ok: true,
    selector: {
      type: 'names',
      names: parts.map((part) =>
        isQuoted(part) ? unquote(part.slice(1, -1)) : part,
      ),
    },
  }
}

export const parseJsonPath = (expression: string): ParsedJsonPath => {
  const trimmed = expression.trim()

  if (trimmed.length === 0) {
    return {
      ok: false,
      message: 'Enter a path such as $.users[0].name',
    }
  }

  // Be forgiving about a missing root: `users[0]` and `.users[0]` both work.
  const source =
    trimmed[0] === '$'
      ? trimmed
      : trimmed[0] === '.' || trimmed[0] === '['
        ? `$${trimmed}`
        : `$.${trimmed}`

  const segments: PathSegment[] = []
  let index = 1

  const readBracket = ():
    | { ok: true; selector: Selector }
    | { ok: false; message: string } => {
    index += 1

    const start = index
    let quote: string | null = null

    while (index < source.length) {
      const char = source[index]

      if (quote !== null) {
        if (char === '\\') {
          index += 2
          continue
        }

        if (char === quote) {
          quote = null
        }

        index += 1
        continue
      }

      if (char === '"' || char === "'") {
        quote = char
        index += 1
        continue
      }

      if (char === ']') {
        const body = source.slice(start, index)
        index += 1

        return parseBracketBody(body)
      }

      index += 1
    }

    return { ok: false, message: 'Missing a closing "]"' }
  }

  const readName = (): string => {
    const start = index

    while (index < source.length) {
      const char = source[index]

      if (char === '.' || char === '[' || char === ']' || /\s/.test(char)) {
        break
      }

      index += 1
    }

    return source.slice(start, index)
  }

  while (index < source.length) {
    const char = source[index]

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (char === '[') {
      const bracket = readBracket()

      if (!bracket.ok) {
        return bracket
      }

      segments.push({ deep: false, selector: bracket.selector })
      continue
    }

    if (char !== '.') {
      return {
        ok: false,
        message: `Unexpected "${char}" at position ${index + 1}`,
      }
    }

    index += 1
    const deep = source[index] === '.'

    if (deep) {
      index += 1
    }

    if (source[index] === '[') {
      const bracket = readBracket()

      if (!bracket.ok) {
        return bracket
      }

      segments.push({ deep, selector: bracket.selector })
      continue
    }

    if (source[index] === '*') {
      index += 1
      segments.push({ deep, selector: { type: 'wildcard' } })
      continue
    }

    const name = readName()

    if (name.length === 0) {
      return {
        ok: false,
        message: `Expected a property name after "${deep ? '..' : '.'}"`,
      }
    }

    segments.push({ deep, selector: { type: 'names', names: [name] } })
  }

  if (segments.length === 0 && source !== '$') {
    return { ok: false, message: 'Could not read that path' }
  }

  return { ok: true, segments }
}

const formatPath = (steps: PathStep[]): string =>
  steps.reduce(
    (path, step) =>
      step.kind === 'key'
        ? appendKeyToPath(path, step.key)
        : appendIndexToPath(path, step.index),
    '$',
  )

/** RFC 6901 JSON Pointer, handy for pasting into other tooling. */
const formatPointer = (steps: PathStep[]): string => {
  if (steps.length === 0) {
    return ''
  }

  return steps
    .map((step) =>
      step.kind === 'key'
        ? `/${step.key.replace(/~/g, '~0').replace(/\//g, '~1')}`
        : `/${step.index}`,
    )
    .join('')
}

const childrenOf = (candidate: Candidate): Candidate[] => {
  const { node, steps } = candidate

  if (node.kind === 'object') {
    return node.entries.map((entry) => ({
      steps: [...steps, { kind: 'key', key: entry.key } as PathStep],
      node: entry.node,
    }))
  }

  if (node.kind === 'array') {
    return node.items.map((item, index) => ({
      steps: [...steps, { kind: 'index', index } as PathStep],
      node: item,
    }))
  }

  return []
}

const collectDescendants = (candidate: Candidate): Candidate[] => {
  const collected: Candidate[] = []
  const walk = (current: Candidate): void => {
    collected.push(current)

    for (const child of childrenOf(current)) {
      walk(child)
    }
  }

  walk(candidate)

  return collected
}

const applySelector = (
  candidate: Candidate,
  selector: Selector,
  output: Candidate[],
): void => {
  const { node, steps } = candidate

  switch (selector.type) {
    case 'wildcard':
      output.push(...childrenOf(candidate))

      return
    case 'names': {
      if (node.kind !== 'object') {
        return
      }

      for (const name of selector.names) {
        for (const entry of node.entries) {
          if (entry.key === name) {
            output.push({
              steps: [...steps, { kind: 'key', key: entry.key }],
              node: entry.node,
            })
          }
        }
      }

      return
    }
    case 'indices': {
      if (node.kind !== 'array') {
        return
      }

      for (const rawIndex of selector.indices) {
        const index = resolveIndex(rawIndex, node.items.length)

        if (index >= 0 && index < node.items.length) {
          output.push({
            steps: [...steps, { kind: 'index', index }],
            node: node.items[index],
          })
        }
      }

      return
    }
    case 'slice': {
      if (node.kind !== 'array') {
        return
      }

      const length = node.items.length
      const { step } = selector

      if (step > 0) {
        const start = clamp(
          selector.start === null ? 0 : resolveIndex(selector.start, length),
          0,
          length,
        )
        const end = clamp(
          selector.end === null ? length : resolveIndex(selector.end, length),
          0,
          length,
        )

        for (let index = start; index < end; index += step) {
          output.push({
            steps: [...steps, { kind: 'index', index }],
            node: node.items[index],
          })
        }

        return
      }

      const start = clamp(
        selector.start === null
          ? length - 1
          : resolveIndex(selector.start, length),
        -1,
        length - 1,
      )
      const end =
        selector.end === null
          ? -1
          : clamp(resolveIndex(selector.end, length), -1, length - 1)

      for (let index = start; index > end; index += step) {
        output.push({
          steps: [...steps, { kind: 'index', index }],
          node: node.items[index],
        })
      }
    }
  }
}

export const queryJsonPath = (
  root: JsonNode,
  expression: string,
): JsonPathResult => {
  const parsed = parseJsonPath(expression)

  if (!parsed.ok) {
    return parsed
  }

  let current: Candidate[] = [{ steps: [], node: root }]

  for (const segment of parsed.segments) {
    const sources = segment.deep
      ? current.flatMap((candidate) => collectDescendants(candidate))
      : current
    const next: Candidate[] = []

    for (const candidate of sources) {
      applySelector(candidate, segment.selector, next)
    }

    current = next

    if (current.length === 0) {
      break
    }
  }

  const matches: JsonPathMatch[] = []
  const seenPaths = new Set<string>()

  for (const candidate of current) {
    const path = formatPath(candidate.steps)

    if (seenPaths.has(path)) {
      continue
    }

    seenPaths.add(path)
    matches.push({
      path,
      pointer: formatPointer(candidate.steps),
      node: candidate.node,
    })

    if (matches.length >= MATCH_LIMIT) {
      return { ok: true, matches, truncated: true }
    }
  }

  return { ok: true, matches, truncated: false }
}
