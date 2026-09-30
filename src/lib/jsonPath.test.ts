import { describe, expect, it } from 'vitest'
import { parseJson, stringifyNode, type JsonNode } from './jsonEngine'
import { parseJsonPath, queryJsonPath } from './jsonPath'

const DOCUMENT = `{
  "store": {
    "books": [
      { "title": "First", "price": 10, "tags": ["a", "b"] },
      { "title": "Second", "price": 20, "tags": [] },
      { "title": "Third", "price": 30, "tags": ["c"] }
    ],
    "open": true
  },
  "id": 7
}`

const parsed = parseJson(DOCUMENT)

if (!parsed.ok) {
  throw new Error('the test fixture must be valid JSON')
}

const root: JsonNode = parsed.root

const matches = (expression: string) => {
  const result = queryJsonPath(root, expression)

  if (!result.ok) {
    throw new Error(result.message)
  }

  return result.matches
}

const values = (expression: string): string[] =>
  matches(expression).map((match) => stringifyNode(match.node, ''))

describe('queryJsonPath', () => {
  it('returns the whole document for the root', () => {
    const result = matches('$')

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('$')
    expect(result[0].pointer).toBe('')
  })

  it('walks named properties', () => {
    expect(values('$.store.open')).toEqual(['true'])
    expect(values('$.id')).toEqual(['7'])
  })

  it('reads array items by index, including from the end', () => {
    expect(values('$.store.books[0].title')).toEqual(['"First"'])
    expect(values('$.store.books[-1].title')).toEqual(['"Third"'])
    expect(values('$.store.books[9].title')).toEqual([])
  })

  it('expands wildcards', () => {
    expect(values('$.store.books[*].price')).toEqual(['10', '20', '30'])
    expect(values('$.store.*').length).toBe(2)
  })

  it('supports unions of indices and of names', () => {
    expect(values('$.store.books[0,2].title')).toEqual(['"First"', '"Third"'])
    expect(values("$.store.books[0]['title','price']")).toEqual([
      '"First"',
      '10',
    ])
  })

  it('supports slices with an optional step', () => {
    expect(values('$.store.books[1:3].title')).toEqual([
      '"Second"',
      '"Third"',
    ])
    expect(values('$.store.books[:2].title')).toEqual(['"First"', '"Second"'])
    expect(values('$.store.books[::2].title')).toEqual(['"First"', '"Third"'])
    expect(values('$.store.books[::-1].title')).toEqual([
      '"Third"',
      '"Second"',
      '"First"',
    ])
    expect(values('$.store.books[-2:].title')).toEqual([
      '"Second"',
      '"Third"',
    ])
  })

  it('descends recursively', () => {
    expect(values('$..title')).toEqual(['"First"', '"Second"', '"Third"'])
    expect(values('$..tags[*]')).toEqual(['"a"', '"b"', '"c"'])
    expect(values('$..price')).toEqual(['10', '20', '30'])
  })

  it('never reports the root for a deep wildcard', () => {
    const result = matches('$..*')

    expect(result.length).toBeGreaterThan(0)
    expect(result.every((match) => match.path !== '$')).toBe(true)
  })

  it('accepts bracket notation and a missing root', () => {
    expect(values('$["store"]["books"][0]["title"]')).toEqual(['"First"'])
    expect(values("$['store']['books'][0]['title']")).toEqual(['"First"'])
    expect(values('store.books[0].title')).toEqual(['"First"'])
    expect(values('.id')).toEqual(['7'])
  })

  it('reports canonical paths and JSON pointers', () => {
    const [match] = matches('$.store.books[0].title')

    expect(match.path).toBe('$["store"]["books"][0]["title"]')
    expect(match.pointer).toBe('/store/books/0/title')
  })

  it('round-trips its own canonical path', () => {
    const [match] = matches('$..tags[0]')

    expect(values(match.path)).toEqual(['"a"'])
  })

  it('returns no matches for paths that do not exist', () => {
    expect(values('$.missing.deeper')).toEqual([])
    expect(values('$.store.open.nope')).toEqual([])
  })

  it('does not treat object keys as array indices', () => {
    expect(values('$.store[0]')).toEqual([])
  })

  it('escapes pointer segments', () => {
    const nested = parseJson('{"a/b":{"c~d":1}}')

    expect(nested.ok).toBe(true)

    if (!nested.ok) {
      return
    }

    const result = queryJsonPath(nested.root, '$..["c~d"]')

    expect(result.ok && result.matches[0].pointer).toBe('/a~1b/c~0d')
  })
})

describe('parseJsonPath', () => {
  it('rejects malformed expressions with a readable reason', () => {
    const cases: [string, string][] = [
      ['', 'Enter a path'],
      ['$.store[', 'Missing a closing'],
      ['$.', 'Expected a property name'],
      ['$..', 'Expected a property name'],
      ['$.a[]', 'Empty brackets'],
      ['$.a[1:2:0]', 'cannot be 0'],
      ['$.a[1:2:3:4]', 'at most'],
      ['$.a[0,]', 'empty entries'],
    ]

    for (const [expression, expected] of cases) {
      const result = parseJsonPath(expression)

      expect(result.ok, expression).toBe(false)

      if (!result.ok) {
        expect(result.message, expression).toContain(expected)
      }
    }
  })

  it('accepts the root on its own', () => {
    const result = parseJsonPath('$')

    expect(result.ok && result.segments).toEqual([])
  })
})
