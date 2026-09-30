import {
  formatBytes,
  type JsonParseWarning,
  type JsonStats,
} from '../lib/jsonEngine'

interface StatsPanelProps {
  stats: JsonStats
  warnings: JsonParseWarning[]
  sourceBytes: number
  minifiedBytes: number
}

interface Tile {
  label: string
  value: string
}

export const StatsPanel = ({
  stats,
  warnings,
  sourceBytes,
  minifiedBytes,
}: StatsPanelProps) => {
  const saved = sourceBytes - minifiedBytes
  const savedShare =
    sourceBytes > 0 ? Math.round((saved / sourceBytes) * 100) : 0

  const tiles: Tile[] = [
    { label: 'Total nodes', value: stats.totalNodes.toLocaleString() },
    { label: 'Max depth', value: stats.maxDepth.toLocaleString() },
    { label: 'Objects', value: stats.objects.toLocaleString() },
    { label: 'Arrays', value: stats.arrays.toLocaleString() },
    { label: 'Properties', value: stats.properties.toLocaleString() },
    { label: 'Unique keys', value: stats.uniqueKeys.toLocaleString() },
    { label: 'Strings', value: stats.strings.toLocaleString() },
    { label: 'Numbers', value: stats.numbers.toLocaleString() },
    { label: 'Booleans', value: stats.booleans.toLocaleString() },
    { label: 'Nulls', value: stats.nulls.toLocaleString() },
    { label: 'Current size', value: formatBytes(sourceBytes) },
    { label: 'Minified size', value: formatBytes(minifiedBytes) },
  ]

  return (
    <div className="stats-panel">
      <div className="stat-grid">
        {tiles.map((tile) => (
          <div className="stat-tile" key={tile.label}>
            <span className="stat-tile-label">{tile.label}</span>
            <strong className="stat-tile-value">{tile.value}</strong>
          </div>
        ))}
      </div>

      {saved > 0 ? (
        <p className="stats-note">
          Minifying this document would save {formatBytes(saved)} ({savedShare}
          %).
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <div className="warning-box">
          <h3>
            {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
          </h3>
          <ul>
            {warnings.map((warning) => (
              <li key={`${warning.path}-${warning.message}`}>
                <span>{warning.message}</span>
                <code>{warning.path}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="stats-note">
          No duplicate property names were found in this document.
        </p>
      )}
    </div>
  )
}
