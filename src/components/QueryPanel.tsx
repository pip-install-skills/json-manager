import { stringifyNode, type JsonNode } from '../lib/jsonEngine'
import type { JsonPathResult } from '../lib/jsonPath'

interface QueryPanelProps {
  expression: string
  examples: string[]
  result: JsonPathResult | null
  onExpressionChange: (value: string) => void
  onCopyPath: (path: string) => void
  onCopyValue: (node: JsonNode) => void
}

const PREVIEW_LIMIT = 260

const previewValue = (node: JsonNode): string => {
  const text = stringifyNode(node, '')

  return text.length > PREVIEW_LIMIT
    ? `${text.slice(0, PREVIEW_LIMIT)}…`
    : text
}

export const QueryPanel = ({
  expression,
  examples,
  result,
  onExpressionChange,
  onCopyPath,
  onCopyValue,
}: QueryPanelProps) => (
  <div className="query-panel">
    <label className="query-field">
      <span className="field-label">JSONPath expression</span>
      <input
        type="text"
        value={expression}
        spellCheck={false}
        placeholder="$.sites[*].label"
        onChange={(event) => onExpressionChange(event.target.value)}
      />
    </label>

    <div className="query-examples">
      <span className="field-label">Try</span>
      {examples.map((example) => (
        <button
          key={example}
          type="button"
          className="example-chip"
          onClick={() => onExpressionChange(example)}
        >
          {example}
        </button>
      ))}
    </div>

    {result === null ? (
      <p className="empty-state">
        Load valid JSON to run a path query against it.
      </p>
    ) : !result.ok ? (
      <p className="query-error">{result.message}</p>
    ) : result.matches.length === 0 ? (
      <p className="empty-state">No node matches that path.</p>
    ) : (
      <>
        <p className="query-summary">
          {result.matches.length.toLocaleString()}{' '}
          {result.matches.length === 1 ? 'match' : 'matches'}
          {result.truncated ? ' (showing the first 5,000)' : ''}
        </p>
        <ol className="match-list">
          {result.matches.map((match) => (
            <li key={match.path}>
              <div className="match-head">
                <code className="match-path">{match.path}</code>
                <span className="match-actions">
                  <button type="button" onClick={() => onCopyPath(match.path)}>
                    path
                  </button>
                  <button type="button" onClick={() => onCopyValue(match.node)}>
                    value
                  </button>
                </span>
              </div>
              <code className={`match-value value-${match.node.kind}`}>
                {previewValue(match.node)}
              </code>
              {match.pointer.length > 0 ? (
                <span className="match-pointer">pointer {match.pointer}</span>
              ) : null}
            </li>
          ))}
        </ol>
      </>
    )}
  </div>
)
