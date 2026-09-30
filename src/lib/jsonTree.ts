/**
 * Turns the node tree into a flat list of visible rows. Keeping the flattening
 * outside React means expand/collapse and filtering stay cheap, and the view
 * layer only ever maps over an array.
 */

import {
  appendIndexToPath,
  appendKeyToPath,
  escapeJsonString,
  type JsonNode,
} from './jsonEngine'

export type RowLabelKind = 'root' | 'key' | 'index'

export interface TreeRow {
  /** Canonical JSONPath of this node, also used as its identity. */
  id: string
  depth: number
  label: string
  labelKind: RowLabelKind
  node: JsonNode
  childCount: number
  expandable: boolean
  expanded: boolean
}

export const countChildren = (node: JsonNode): number => {
  if (node.kind === 'object') {
    return node.entries.length
  }

  if (node.kind === 'array') {
    return node.items.length
  }

  return 0
}

export const isContainer = (node: JsonNode): boolean =>
  node.kind === 'object' || node.kind === 'array'

/** Display text for a leaf value; strings keep their JSON escaping visible. */
export const formatPrimitive = (node: JsonNode): string => {
  switch (node.kind) {
    case 'string':
      return escapeJsonString(node.value)
    case 'number':
      return node.raw
    case 'boolean':
      return node.value ? 'true' : 'false'
    case 'null':
      return 'null'
    default:
      return ''
  }
}

export const summarizeNode = (node: JsonNode): string => {
  if (node.kind === 'object') {
    return node.entries.length === 1 ? '1 key' : `${node.entries.length} keys`
  }

  if (node.kind === 'array') {
    return node.items.length === 1 ? '1 item' : `${node.items.length} items`
  }

  return ''
}

const matchesTerm = (label: string, node: JsonNode, term: string): boolean => {
  if (label.toLowerCase().includes(term)) {
    return true
  }

  if (node.kind === 'string') {
    return node.value.toLowerCase().includes(term)
  }

  if (node.kind === 'number') {
    return node.raw.toLowerCase().includes(term)
  }

  if (node.kind === 'boolean') {
    return (node.value ? 'true' : 'false').includes(term)
  }

  if (node.kind === 'null') {
    return 'null'.includes(term)
  }

  return false
}

/**
 * Paths to keep when filtering: every match, everything inside a match, and
 * every ancestor needed to reach one.
 */
const collectVisiblePaths = (root: JsonNode, term: string): Set<string> => {
  const visible = new Set<string>()

  const walk = (
    node: JsonNode,
    path: string,
    label: string,
    insideMatch: boolean,
  ): boolean => {
    const selfMatches = insideMatch || matchesTerm(label, node, term)
    let hasKeptChild = false

    if (node.kind === 'object') {
      for (const entry of node.entries) {
        const kept = walk(
          entry.node,
          appendKeyToPath(path, entry.key),
          entry.key,
          selfMatches,
        )
        hasKeptChild = hasKeptChild || kept
      }
    } else if (node.kind === 'array') {
      node.items.forEach((item, index) => {
        const kept = walk(
          item,
          appendIndexToPath(path, index),
          String(index),
          selfMatches,
        )
        hasKeptChild = hasKeptChild || kept
      })
    }

    if (selfMatches || hasKeptChild) {
      visible.add(path)

      return true
    }

    return false
  }

  walk(root, '$', '$', false)

  return visible
}

export const buildTreeRows = (
  root: JsonNode,
  collapsed: ReadonlySet<string>,
  filter: string,
): TreeRow[] => {
  const term = filter.trim().toLowerCase()
  const visible = term.length > 0 ? collectVisiblePaths(root, term) : null
  const rows: TreeRow[] = []

  const walk = (
    node: JsonNode,
    path: string,
    depth: number,
    label: string,
    labelKind: RowLabelKind,
  ): void => {
    if (visible !== null && !visible.has(path)) {
      return
    }

    const childCount = countChildren(node)
    const expandable = childCount > 0
    // While filtering, matches are always revealed regardless of saved state.
    const expanded =
      expandable && (visible !== null || !collapsed.has(path))

    rows.push({
      id: path,
      depth,
      label,
      labelKind,
      node,
      childCount,
      expandable,
      expanded,
    })

    if (!expanded) {
      return
    }

    if (node.kind === 'object') {
      for (const entry of node.entries) {
        walk(
          entry.node,
          appendKeyToPath(path, entry.key),
          depth + 1,
          entry.key,
          'key',
        )
      }

      return
    }

    if (node.kind === 'array') {
      node.items.forEach((item, index) => {
        walk(
          item,
          appendIndexToPath(path, index),
          depth + 1,
          String(index),
          'index',
        )
      })
    }
  }

  walk(root, '$', 0, '$', 'root')

  return rows
}

/** Every container path, used by "collapse all". */
export const collectExpandablePaths = (root: JsonNode): string[] => {
  const paths: string[] = []

  const walk = (node: JsonNode, path: string): void => {
    if (countChildren(node) === 0) {
      return
    }

    paths.push(path)

    if (node.kind === 'object') {
      for (const entry of node.entries) {
        walk(entry.node, appendKeyToPath(path, entry.key))
      }

      return
    }

    if (node.kind === 'array') {
      node.items.forEach((item, index) => {
        walk(item, appendIndexToPath(path, index))
      })
    }
  }

  walk(root, '$')

  return paths
}

/**
 * Container paths at or below `openDepth`, so a freshly loaded document opens
 * to a readable outline instead of thousands of rows.
 */
export const collectPathsBelowDepth = (
  root: JsonNode,
  openDepth: number,
): string[] => {
  const paths: string[] = []

  const walk = (node: JsonNode, path: string, depth: number): void => {
    if (countChildren(node) === 0) {
      return
    }

    if (depth >= openDepth) {
      paths.push(path)
    }

    if (node.kind === 'object') {
      for (const entry of node.entries) {
        walk(entry.node, appendKeyToPath(path, entry.key), depth + 1)
      }

      return
    }

    if (node.kind === 'array') {
      node.items.forEach((item, index) => {
        walk(item, appendIndexToPath(path, index), depth + 1)
      })
    }
  }

  walk(root, '$', 0)

  return paths
}
