import { describe, expect, it } from 'vitest'
import {
  buildErrorExcerpt,
  collectStats,
  countLines,
  escapeJsonString,
  escapeToStringLiteral,
  formatBytes,
  locateOffset,
  parseJson,
  sortNodeKeys,
  stringifyNode,
  unescapeFromStringLiteral,
  type JsonNode,
} from './jsonEngine'

const parseOrThrow = (text: string): JsonNode => {
  const result = parseJson(text)

  if (!result.ok) {
    throw new Error(`${result.error.message} at ${result.error.line}:${result.error.column}`)
  }

  return result.root
}

const minify = (text: string): string => stringifyNode(parseOrThrow(text), '')

describe('parseJson', () => {
  it('reads every JSON value type', () => {
    const root = parseOrThrow(
      '{"s":"x","n":-1.5e3,"t":true,"f":false,"z":null,"a":[],"o":{}}',
    )

    expect(root.kind).toBe('object')

    if (root.kind !== 'object') {
      return
    }

    expect(root.entries.map((entry) => entry.node.kind)).toEqual([
      'string',
      'number',
      'boolean',
      'boolean',
      'null',
      'array',
      'object',
    ])
  })

  it('keeps the original property order for integer-like keys', () => {
    const root = parseOrThrow('{"10":"a","2":"b","1":"c"}')

    expect(root.kind === 'object' && root.entries.map((entry) => entry.key)).toEqual(
      ['10', '2', '1'],
    )
  })

  it('preserves the exact text of numbers beyond double precision', () => {
    expect(minify('{"n":9007199254740993}')).toBe('{"n":9007199254740993}')
    expect(minify('{"n":1.0}')).toBe('{"n":1.0}')
    expect(minify('{"n":1e400}')).toBe('{"n":1e400}')
  })

  it('keeps duplicate properties and reports them as warnings', () => {
    const result = parseJson('{"a":1,"a":2}')

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(result.root.kind === 'object' && result.root.entries).toHaveLength(2)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].path).toBe('$["a"]')
  })

  it('decodes escape sequences including surrogate pairs', () => {
    const root = parseOrThrow('"tab\\tquote\\"\\u0041\\ud83d\\ude00"')

    expect(root.kind === 'string' && root.value).toBe('tab\tquote"A\u{1f600}')
  })

  it('accepts a leading byte order mark', () => {
    expect(minify('﻿{"a":1}')).toBe('{"a":1}')
  })

  it('reports the line and column of a missing comma', () => {
    const result = parseJson('{\n  "a": 1\n  "b": 2\n}')

    expect(result.ok).toBe(false)

    if (result.ok) {
      return
    }

    expect(result.error.line).toBe(3)
    expect(result.error.column).toBe(3)
    expect(result.error.message).toContain('Expected "," or "}"')
  })

  it('points at the opening quote of an unterminated string', () => {
    const result = parseJson('{"a": "abc')

    expect(result.ok).toBe(false)

    if (result.ok) {
      return
    }

    expect(result.error.message).toBe('This string is never closed')
    expect(result.error.position).toBe(6)
  })

  it('rejects the usual almost-JSON mistakes', () => {
    const cases = [
      '[1,2,]',
      "{'a':1}",
      '{a:1}',
      '{"a":1,}',
      '{"a":01}',
      '{"a":1} extra',
      '',
      '   ',
    ]

    for (const text of cases) {
      expect(parseJson(text).ok, text).toBe(false)
    }
  })

  it('rejects unescaped control characters in strings', () => {
    const result = parseJson('"line\nbreak"')

    expect(result.ok).toBe(false)

    if (result.ok) {
      return
    }

    expect(result.error.message).toContain('Control characters')
  })

  it('stops instead of recursing without bound', () => {
    const result = parseJson('['.repeat(5000) + ']'.repeat(5000))

    expect(result.ok).toBe(false)

    if (result.ok) {
      return
    }

    expect(result.error.message).toContain('deeper than')
  })
})

describe('stringifyNode', () => {
  it('pretty prints with the requested indent', () => {
    const root = parseOrThrow('{"a":[1,2],"b":{"c":"d"}}')

    expect(stringifyNode(root, '  ')).toBe(
      ['{', '  "a": [', '    1,', '    2', '  ],', '  "b": {', '    "c": "d"', '  }', '}'].join(
        '\n',
      ),
    )
  })

  it('keeps empty containers on one line', () => {
    expect(stringifyNode(parseOrThrow('{"a":{},"b":[]}'), '  ')).toBe(
      '{\n  "a": {},\n  "b": []\n}',
    )
  })

  it('round-trips a formatted document back to the same minified text', () => {
    const source = '{"a":[1,{"b":null}],"c":"x"}'
    const formatted = stringifyNode(parseOrThrow(source), '\t')

    expect(minify(formatted)).toBe(source)
  })
})

describe('escapeJsonString', () => {
  it('escapes the characters JSON requires', () => {
    expect(escapeJsonString('plain')).toBe('"plain"')
    expect(escapeJsonString('line\nbreak')).toBe('"line\\nbreak"')
    expect(escapeJsonString('quote" and \\ slash')).toBe(
      '"quote\\" and \\\\ slash"',
    )
    expect(escapeJsonString('\u0001')).toBe('"\\u0001"')
  })

  it('keeps valid surrogate pairs and escapes lone surrogates', () => {
    expect(escapeJsonString('\u{1f600}')).toBe('"\u{1f600}"')
    expect(escapeJsonString('\ud800')).toBe('"\\ud800"')
    expect(escapeJsonString('\udc00')).toBe('"\\udc00"')
  })
})

describe('sortNodeKeys', () => {
  it('sorts nested object keys without touching array order', () => {
    const root = parseOrThrow('{"b":{"d":1,"c":2},"a":[{"z":1,"y":2}]}')

    expect(stringifyNode(sortNodeKeys(root, 'asc'), '')).toBe(
      '{"a":[{"y":2,"z":1}],"b":{"c":2,"d":1}}',
    )
  })

  it('supports descending order', () => {
    const root = parseOrThrow('{"a":1,"b":2,"c":3}')

    expect(stringifyNode(sortNodeKeys(root, 'desc'), '')).toBe(
      '{"c":3,"b":2,"a":1}',
    )
  })
})

describe('collectStats', () => {
  it('counts nodes, properties, and depth', () => {
    const stats = collectStats(parseOrThrow('{"a":1,"b":[true,null,"x"]}'))

    expect(stats).toMatchObject({
      objects: 1,
      arrays: 1,
      strings: 1,
      numbers: 1,
      booleans: 1,
      nulls: 1,
      properties: 2,
      uniqueKeys: 2,
      maxDepth: 3,
      totalNodes: 6,
    })
  })

  it('treats a bare value as a single node', () => {
    expect(collectStats(parseOrThrow('42'))).toMatchObject({
      numbers: 1,
      totalNodes: 1,
      maxDepth: 1,
    })
  })
})

describe('escaping helpers', () => {
  it('round-trips a document through a string literal', () => {
    const source = '{"a":"b\\nc"}'
    const literal = escapeToStringLiteral(source)
    const result = unescapeFromStringLiteral(literal)

    expect(result.ok && result.text).toBe(source)
  })

  it('unescapes text that is missing its outer quotes', () => {
    const result = unescapeFromStringLiteral('a\\nb')

    expect(result.ok && result.text).toBe('a\nb')
  })

  it('explains why unescaping failed', () => {
    const result = unescapeFromStringLiteral('   ')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('nothing to unescape')
  })
})

describe('text helpers', () => {
  it('locates offsets across line endings', () => {
    expect(locateOffset('ab\ncd', 0)).toEqual({ line: 1, column: 1 })
    expect(locateOffset('ab\ncd', 3)).toEqual({ line: 2, column: 1 })
    expect(locateOffset('ab\r\ncd', 5)).toEqual({ line: 2, column: 2 })
  })

  it('draws a caret under the reported column', () => {
    expect(buildErrorExcerpt('{"a" 1}', 1, 6)).toBe('{"a" 1}\n     ^')
  })

  it('counts lines and formats byte sizes', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('a')).toBe(1)
    expect(countLines('a\nb\r\nc')).toBe(3)
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
  })
})
