import { describe, expect, it } from 'vitest'
import { parseJson, type JsonNode } from './jsonEngine'
import {
  buildTreeRows,
  collectExpandablePaths,
  collectPathsBelowDepth,
  countChildren,
  formatPrimitive,
  isContainer,
  summarizeNode,
} from './jsonTree'

const parseOrThrow = (text: string): JsonNode => {
  const result = parseJson(text)

  if (!result.ok) {
    throw new Error(result.error.message)
  }

  return result.root
}

const root = parseOrThrow('{"a":{"b":[1,2]},"c":true}')

const labels = (rows: ReturnType<typeof buildTreeRows>): string[] =>
  rows.map((row) => row.label)

describe('buildTreeRows', () => {
  it('flattens the document in document order with depths', () => {
    const rows = buildTreeRows(root, new Set(), '')

    expect(labels(rows)).toEqual(['$', 'a', 'b', '0', '1', 'c'])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3, 3, 1])
    expect(rows[0].id).toBe('$')
    expect(rows[2].id).toBe('$["a"]["b"]')
  })

  it('marks containers as expandable and leaves as not', () => {
    const rows = buildTreeRows(root, new Set(), '')

    expect(rows[0]).toMatchObject({ expandable: true, childCount: 2 })
    expect(rows[5]).toMatchObject({ expandable: false, childCount: 0 })
  })

  it('hides the children of collapsed nodes', () => {
    const rows = buildTreeRows(root, new Set(['$["a"]']), '')

    expect(labels(rows)).toEqual(['$', 'a', 'c'])
    expect(rows[1].expanded).toBe(false)
  })

  it('collapses everything when the root is collapsed', () => {
    const rows = buildTreeRows(root, new Set(['$']), '')

    expect(labels(rows)).toEqual(['$'])
  })

  it('keeps matching rows and the ancestors needed to reach them', () => {
    expect(labels(buildTreeRows(root, new Set(), 'c'))).toEqual(['$', 'c'])
    expect(labels(buildTreeRows(root, new Set(), '2'))).toEqual([
      '$',
      'a',
      'b',
      '1',
    ])
  })

  it('shows the whole subtree of a matching key', () => {
    expect(labels(buildTreeRows(root, new Set(), 'b'))).toEqual([
      '$',
      'a',
      'b',
      '0',
      '1',
    ])
  })

  it('reveals filtered matches even inside collapsed nodes', () => {
    const rows = buildTreeRows(root, new Set(['$["a"]', '$["a"]["b"]']), '2')

    expect(labels(rows)).toEqual(['$', 'a', 'b', '1'])
  })

  it('matches values as well as keys, case-insensitively', () => {
    const people = parseOrThrow('[{"name":"Ada"},{"name":"Grace"}]')

    expect(labels(buildTreeRows(people, new Set(), 'ada'))).toEqual([
      '$',
      '0',
      'name',
    ])
  })

  it('returns nothing when the filter matches nothing', () => {
    expect(buildTreeRows(root, new Set(), 'zzz')).toEqual([])
  })
})

describe('path collection', () => {
  it('lists every container path', () => {
    expect(collectExpandablePaths(root)).toEqual([
      '$',
      '$["a"]',
      '$["a"]["b"]',
    ])
  })

  it('lists container paths at or below a depth', () => {
    expect(collectPathsBelowDepth(root, 2)).toEqual(['$["a"]["b"]'])
    expect(collectPathsBelowDepth(root, 0)).toEqual([
      '$',
      '$["a"]',
      '$["a"]["b"]',
    ])
  })

  it('ignores empty containers', () => {
    expect(collectExpandablePaths(parseOrThrow('{"a":{},"b":[]}'))).toEqual([
      '$',
    ])
  })
})

describe('node display helpers', () => {
  it('describes leaf values the way JSON writes them', () => {
    expect(formatPrimitive(parseOrThrow('"x\\ty"'))).toBe('"x\\ty"')
    expect(formatPrimitive(parseOrThrow('1.50'))).toBe('1.50')
    expect(formatPrimitive(parseOrThrow('true'))).toBe('true')
    expect(formatPrimitive(parseOrThrow('null'))).toBe('null')
    expect(formatPrimitive(parseOrThrow('[]'))).toBe('')
  })

  it('summarizes containers with singular and plural counts', () => {
    expect(summarizeNode(parseOrThrow('{"a":1}'))).toBe('1 key')
    expect(summarizeNode(parseOrThrow('{"a":1,"b":2}'))).toBe('2 keys')
    expect(summarizeNode(parseOrThrow('[1]'))).toBe('1 item')
    expect(summarizeNode(parseOrThrow('[1,2]'))).toBe('2 items')
    expect(summarizeNode(parseOrThrow('7'))).toBe('')
  })

  it('reports containers and child counts', () => {
    expect(isContainer(parseOrThrow('{}'))).toBe(true)
    expect(isContainer(parseOrThrow('[]'))).toBe(true)
    expect(isContainer(parseOrThrow('"x"'))).toBe(false)
    expect(countChildren(parseOrThrow('[1,2,3]'))).toBe(3)
    expect(countChildren(parseOrThrow('"x"'))).toBe(0)
  })
})
