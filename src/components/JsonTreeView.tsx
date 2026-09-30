import type { JsonNode } from '../lib/jsonEngine'
import {
  formatPrimitive,
  summarizeNode,
  type TreeRow,
} from '../lib/jsonTree'

interface JsonTreeViewProps {
  rows: TreeRow[]
  hiddenCount: number
  onToggle: (path: string) => void
  onCopyPath: (path: string) => void
  onCopyValue: (node: JsonNode) => void
  onShowMore: () => void
}

const INDENT_STEP = 16
const BASE_INDENT = 8

const containerGlyph = (node: JsonNode, expanded: boolean): string => {
  const [open, close] = node.kind === 'object' ? ['{', '}'] : ['[', ']']

  return expanded ? open : `${open} … ${close}`
}

export const JsonTreeView = ({
  rows,
  hiddenCount,
  onToggle,
  onCopyPath,
  onCopyValue,
  onShowMore,
}: JsonTreeViewProps) => (
  <div className="tree-view">
    {rows.map((row, position) => {
      const container = row.node.kind === 'object' || row.node.kind === 'array'

      return (
        <div
          key={`${row.id}:${position}`}
          className={`tree-row ${container ? 'container' : 'leaf'}`}
          style={{ paddingLeft: `${BASE_INDENT + row.depth * INDENT_STEP}px` }}
        >
          {row.expandable ? (
            <button
              type="button"
              className="tree-twisty"
              onClick={() => onToggle(row.id)}
              aria-expanded={row.expanded}
              aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${row.label}`}
            >
              {row.expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="tree-twisty placeholder" aria-hidden="true" />
          )}

          <span className={`tree-label label-${row.labelKind}`}>
            {row.label}
          </span>
          <span className="tree-colon">:</span>

          {container ? (
            <>
              <span className="tree-brace">
                {containerGlyph(row.node, row.expanded)}
              </span>
              <span className="tree-count">{summarizeNode(row.node)}</span>
            </>
          ) : (
            <span className={`tree-value value-${row.node.kind}`}>
              {formatPrimitive(row.node)}
            </span>
          )}

          <span className="tree-actions">
            <button
              type="button"
              onClick={() => onCopyPath(row.id)}
              title={`Copy path ${row.id}`}
            >
              path
            </button>
            <button
              type="button"
              onClick={() => onCopyValue(row.node)}
              title="Copy this value as JSON"
            >
              value
            </button>
          </span>
        </div>
      )
    })}

    {hiddenCount > 0 ? (
      <div className="tree-more">
        <span>
          {hiddenCount.toLocaleString()} more{' '}
          {hiddenCount === 1 ? 'row' : 'rows'} hidden for performance.
        </span>
        <button type="button" onClick={onShowMore}>
          Render more rows
        </button>
      </div>
    ) : null}
  </div>
)
