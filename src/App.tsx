import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import { JsonTreeView } from './components/JsonTreeView'
import { QueryPanel } from './components/QueryPanel'
import { StatsPanel } from './components/StatsPanel'
import {
  buildErrorExcerpt,
  byteLength,
  collectStats,
  countLines,
  escapeToStringLiteral,
  formatBytes,
  parseJson,
  sortNodeKeys,
  stringifyNode,
  unescapeFromStringLiteral,
  type JsonNode,
  type SortDirection,
} from './lib/jsonEngine'
import { queryJsonPath } from './lib/jsonPath'
import { repairJson } from './lib/jsonRepair'
import {
  buildTreeRows,
  collectExpandablePaths,
  collectPathsBelowDepth,
} from './lib/jsonTree'
import { SAMPLE_JSON } from './lib/sampleData'

type OutputView = 'tree' | 'formatted' | 'query' | 'stats'
type Theme = 'light' | 'dark'
type IndentKey = '2' | '4' | 'tab'
type NoticeKind = 'info' | 'error'

interface Notice {
  kind: NoticeKind
  message: string
}

const THEME_STORAGE_KEY = 'local-json-theme'
const NOTICE_TIMEOUT_MS = 4000
const INITIAL_ROW_LIMIT = 600
const ROW_LIMIT_STEP = 1500
/** Containers at this depth or deeper start collapsed when a document loads. */
const DEFAULT_OPEN_DEPTH = 2

const INDENT_VALUES: Record<IndentKey, string> = {
  '2': '  ',
  '4': '    ',
  tab: '\t',
}

const VIEW_LABELS: Record<OutputView, string> = {
  tree: 'Tree',
  formatted: 'Text',
  query: 'Query',
  stats: 'Stats',
}

const QUERY_EXAMPLES = [
  '$.sites[*].label',
  '$..readings[0]',
  '$.owner.contact',
  '$.sites[-1].tags[*]',
  '$..id',
]

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') {
    return 'dark'
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)

    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme
    }
  } catch {
    // Ignore storage read issues and fall back to the default theme.
  }

  return 'dark'
}

/**
 * The first paint has to match the collapse state a load action applies, or
 * re-loading the document that is already open would visibly reshape the tree.
 */
const getInitialCollapsed = (): ReadonlySet<string> => {
  const outcome = parseJson(SAMPLE_JSON)

  if (!outcome.ok) {
    return new Set()
  }

  return new Set(collectPathsBelowDepth(outcome.root, DEFAULT_OPEN_DEPTH))
}

const buildLineNumberText = (lineCount: number): string =>
  Array.from({ length: Math.max(1, lineCount) }, (_, index) => `${index + 1}`).join(
    '\n',
  )

function App() {
  const [sourceText, setSourceText] = useState(SAMPLE_JSON)
  const [view, setView] = useState<OutputView>('tree')
  const [indentKey, setIndentKey] = useState<IndentKey>('2')
  const [wrapOutput, setWrapOutput] = useState(true)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [collapsed, setCollapsed] =
    useState<ReadonlySet<string>>(getInitialCollapsed)
  const [treeFilter, setTreeFilter] = useState('')
  const [rowLimit, setRowLimit] = useState(INITIAL_ROW_LIMIT)
  const [queryExpression, setQueryExpression] = useState('$.sites[*].label')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLPreElement>(null)

  const indent = INDENT_VALUES[indentKey]

  const parsed = useMemo(() => parseJson(sourceText), [sourceText])
  const root = parsed.ok ? parsed.root : null
  const warnings = parsed.ok ? parsed.warnings : []

  const formattedText = useMemo(
    () => (root ? stringifyNode(root, indent) : ''),
    [root, indent],
  )
  const minifiedText = useMemo(
    () => (root ? stringifyNode(root, '') : ''),
    [root],
  )
  const stats = useMemo(() => (root ? collectStats(root) : null), [root])

  const treeRows = useMemo(
    () => (root ? buildTreeRows(root, collapsed, treeFilter) : []),
    [root, collapsed, treeFilter],
  )
  const visibleRows = useMemo(
    () => treeRows.slice(0, rowLimit),
    [treeRows, rowLimit],
  )

  const queryResult = useMemo(() => {
    if (!root || view !== 'query' || queryExpression.trim().length === 0) {
      return null
    }

    return queryJsonPath(root, queryExpression)
  }, [root, view, queryExpression])

  const lineCount = countLines(sourceText)
  const lineNumbers = useMemo(
    () => buildLineNumberText(lineCount),
    [lineCount],
  )
  const sourceBytes = byteLength(sourceText)
  const hasContent = sourceText.trim().length > 0

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Ignore storage write issues.
    }
  }, [theme])

  useEffect(() => {
    if (notice === null) {
      return
    }

    const timer = window.setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [notice])

  const announce = useCallback((kind: NoticeKind, message: string) => {
    setNotice({ kind, message })
  }, [])

  /** Replaces the document and resets the view state that belongs to it. */
  const loadDocument = useCallback((text: string) => {
    setSourceText(text)
    setTreeFilter('')
    setRowLimit(INITIAL_ROW_LIMIT)

    const outcome = parseJson(text)
    setCollapsed(
      outcome.ok
        ? new Set(collectPathsBelowDepth(outcome.root, DEFAULT_OPEN_DEPTH))
        : new Set(),
    )
  }, [])

  const requireRoot = (): JsonNode | null => {
    if (root === null) {
      announce('error', 'Fix the JSON before running that action.')

      return null
    }

    return root
  }

  const formatDocument = () => {
    const current = requireRoot()

    if (current === null) {
      return
    }

    setSourceText(stringifyNode(current, indent))
    announce('info', 'Document formatted.')
  }

  const minifyDocument = () => {
    const current = requireRoot()

    if (current === null) {
      return
    }

    setSourceText(stringifyNode(current, ''))
    announce('info', 'Whitespace removed.')
  }

  const sortDocument = (direction: SortDirection) => {
    const current = requireRoot()

    if (current === null) {
      return
    }

    setSourceText(stringifyNode(sortNodeKeys(current, direction), indent))
    announce(
      'info',
      `Keys sorted ${direction === 'asc' ? 'A to Z' : 'Z to A'}.`,
    )
  }

  const repairDocument = () => {
    if (!hasContent) {
      announce('error', 'Paste some JSON first.')

      return
    }

    const result = repairJson(sourceText)

    if (!result.changed) {
      announce('info', 'Nothing to repair.')

      return
    }

    setSourceText(result.text)
    announce('info', `Repaired: ${result.fixes.join(', ').toLowerCase()}.`)
  }

  const escapeDocument = () => {
    if (!hasContent) {
      announce('error', 'Paste some JSON first.')

      return
    }

    setSourceText(escapeToStringLiteral(sourceText))
    announce('info', 'Document wrapped as an escaped string literal.')
  }

  const unescapeDocument = () => {
    const result = unescapeFromStringLiteral(sourceText)

    if (!result.ok) {
      announce('error', result.message)

      return
    }

    setSourceText(result.text)
    announce('info', 'String literal unescaped.')
  }

  const clearDocument = () => {
    loadDocument('')
    announce('info', 'Workspace cleared.')
  }

  const loadSample = () => {
    loadDocument(SAMPLE_JSON)
    announce('info', 'Sample document loaded.')
  }

  const readFile = async (file: File) => {
    loadDocument(await file.text())
    announce('info', `Loaded ${file.name} from this device.`)
  }

  const handleFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]

    if (!file) {
      return
    }

    await readFile(file)
    input.value = ''
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)

    const file = event.dataTransfer.files?.[0]

    if (file) {
      await readFile(file)
    }
  }

  const copyText = async (text: string, label: string) => {
    if (text.length === 0) {
      announce('error', 'There is nothing to copy yet.')

      return
    }

    try {
      await navigator.clipboard.writeText(text)
      announce('info', `${label} copied to the clipboard.`)
    } catch {
      announce('error', 'The browser blocked clipboard access.')
    }
  }

  const downloadDocument = () => {
    const current = requireRoot()

    if (current === null) {
      return
    }

    const blob = new Blob([stringifyNode(current, indent)], {
      type: 'application/json;charset=utf-8',
    })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `local-json-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
    announce('info', 'Saved to your downloads folder.')
  }

  const toggleTheme = () => {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }

  const toggleRow = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current)

      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }

      return next
    })
  }

  const expandAll = () => {
    setCollapsed(new Set())
  }

  const collapseAll = () => {
    if (root === null) {
      return
    }

    const paths = collectExpandablePaths(root)
    // The root itself stays open so the document never looks empty.
    setCollapsed(new Set(paths.filter((path) => path !== '$')))
  }

  const jumpToError = () => {
    if (parsed.ok) {
      return
    }

    const editor = editorRef.current

    if (!editor) {
      return
    }

    const { position, line } = parsed.error
    editor.focus()
    editor.setSelectionRange(position, Math.min(position + 1, sourceText.length))

    const approximateLineHeight = editor.scrollHeight / Math.max(1, lineCount)
    editor.scrollTop = Math.max(0, (line - 3) * approximateLineHeight)

    if (gutterRef.current) {
      gutterRef.current.scrollTop = editor.scrollTop
    }
  }

  const syncGutterScroll = () => {
    if (editorRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = editorRef.current.scrollTop
    }
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="brand">
          <p className="brand-kicker">Private local JSON workspace</p>
          <h1>Local JSON Manager</h1>
          <p className="brand-subtitle">
            View, format, validate, repair, and query JSON without a single
            byte leaving this device.
          </p>
        </div>
        <div className="site-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={
              theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
            }
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <p className="site-note">All processing stays in your browser.</p>
        </div>
      </header>

      <header className="hero">
        <div className="hero-content">
          <p className="eyebrow">Offline-first JSON tooling</p>
          <h2>Readable trees, precise errors, no uploads</h2>
          <p className="subtitle">
            The tree keeps large documents navigable, the validator points at
            the exact line and column, and the repair pass rescues
            almost-JSON such as config files with comments or trailing commas.
          </p>
        </div>
        <div className="privacy-box">
          <h2>Privacy Guardrails</h2>
          <ul>
            <li>Parsing and querying run fully in-browser.</li>
            <li>File imports use local `File` APIs only.</li>
            <li>No telemetry or external endpoints in runtime.</li>
          </ul>
        </div>
      </header>

      <section className="toolbar">
        <div className="toolbar-block">
          <span className="toolbar-title">View</span>
          <div className="segmented-control">
            {(Object.keys(VIEW_LABELS) as OutputView[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={view === candidate ? 'active' : ''}
                onClick={() => setView(candidate)}
              >
                {VIEW_LABELS[candidate]}
              </button>
            ))}
          </div>

          <div className="indent-row">
            <label>
              <span className="field-label">Indent</span>
              <select
                value={indentKey}
                onChange={(event) =>
                  setIndentKey(event.target.value as IndentKey)
                }
              >
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="tab">Tab</option>
              </select>
            </label>
            <label className="inline-checkbox">
              <input
                type="checkbox"
                checked={wrapOutput}
                onChange={() => setWrapOutput((current) => !current)}
              />
              Wrap long output lines
            </label>
          </div>
        </div>

        <div className="toolbar-block action-block">
          <span className="toolbar-title">Transform</span>
          <div className="button-row">
            <button type="button" onClick={formatDocument} disabled={!parsed.ok}>
              Format
            </button>
            <button type="button" onClick={minifyDocument} disabled={!parsed.ok}>
              Remove whitespace
            </button>
            <button
              type="button"
              onClick={() => sortDocument('asc')}
              disabled={!parsed.ok}
            >
              Sort A–Z
            </button>
            <button
              type="button"
              onClick={() => sortDocument('desc')}
              disabled={!parsed.ok}
            >
              Sort Z–A
            </button>
          </div>
          <div className="button-row">
            <button type="button" onClick={repairDocument}>
              Repair
            </button>
            <button type="button" onClick={escapeDocument}>
              Escape
            </button>
            <button type="button" onClick={unescapeDocument}>
              Unescape
            </button>
          </div>
        </div>

        <div className="toolbar-block action-block">
          <span className="toolbar-title">Document</span>
          <div className="button-row">
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Load JSON file
            </button>
            <button type="button" onClick={loadSample}>
              Sample
            </button>
            <button type="button" onClick={clearDocument}>
              Clear
            </button>
          </div>
          <div className="button-row">
            <button
              type="button"
              onClick={() => copyText(formattedText, 'Formatted JSON')}
              disabled={!parsed.ok}
            >
              Copy formatted
            </button>
            <button
              type="button"
              onClick={() => copyText(minifiedText, 'Minified JSON')}
              disabled={!parsed.ok}
            >
              Copy minified
            </button>
            <button
              type="button"
              onClick={downloadDocument}
              disabled={!parsed.ok}
            >
              Download .json
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept=".json,.jsonc,.geojson,.ndjson,.txt,application/json"
          onChange={handleFileInput}
        />
      </section>

      {notice !== null ? (
        <p className={`notice notice-${notice.kind}`} role="status">
          {notice.message}
        </p>
      ) : null}

      <section className="workspace">
        <article className="editor-card">
          <header>
            <h2>JSON Input</h2>
            <div className="editor-meta">
              <span>{lineCount.toLocaleString()} lines</span>
              <span>{formatBytes(sourceBytes)}</span>
              {hasContent ? (
                <span
                  className={`badge ${parsed.ok ? 'badge-valid' : 'badge-invalid'}`}
                >
                  {parsed.ok ? 'Valid JSON' : 'Invalid JSON'}
                </span>
              ) : null}
            </div>
          </header>

          <div
            className={`editor-input ${dragActive ? 'drag-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <pre aria-hidden="true" className="editor-gutter" ref={gutterRef}>
              {lineNumbers}
            </pre>
            <textarea
              ref={editorRef}
              spellCheck={false}
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              onScroll={syncGutterScroll}
              // The gutter numbers logical lines, so the editor must not soft
              // wrap: a wrapped line would push every number below it out of
              // step with the line it labels. Long lines scroll sideways.
              className="no-wrap"
              placeholder="Paste JSON here, or drop a .json file onto this panel"
            />
          </div>

          {!parsed.ok && hasContent ? (
            <div className="error-box">
              <div className="error-head">
                <strong>
                  Line {parsed.error.line}, column {parsed.error.column}
                </strong>
                <button type="button" onClick={jumpToError}>
                  Jump to error
                </button>
              </div>
              <p>{parsed.error.message}</p>
              <pre className="error-excerpt">
                {buildErrorExcerpt(
                  sourceText,
                  parsed.error.line,
                  parsed.error.column,
                )}
              </pre>
              <p className="error-hint">
                Try <strong>Repair</strong> for comments, trailing commas,
                single quotes, or truncated output.
              </p>
            </div>
          ) : null}
        </article>

        <article className="result-card">
          <header className="result-header">
            <h2>{VIEW_LABELS[view]}</h2>
            {stats !== null ? (
              <div className="stats">
                <span className="stat nodes">
                  {stats.totalNodes.toLocaleString()} nodes
                </span>
                <span className="stat depth">depth {stats.maxDepth}</span>
                <span className="stat size">{formatBytes(sourceBytes)}</span>
                {warnings.length > 0 ? (
                  <span className="stat warn">
                    {warnings.length}{' '}
                    {warnings.length === 1 ? 'warning' : 'warnings'}
                  </span>
                ) : null}
              </div>
            ) : null}
          </header>

          {root === null || stats === null ? (
            <p className="empty-state">
              {hasContent
                ? 'The document cannot be read yet. Fix the error on the left, or run Repair.'
                : 'Paste JSON into the panel on the left to explore it here.'}
            </p>
          ) : view === 'tree' ? (
            <>
              <div className="tree-controls">
                <input
                  type="search"
                  value={treeFilter}
                  placeholder="Filter keys and values"
                  onChange={(event) => setTreeFilter(event.target.value)}
                />
                <button type="button" onClick={expandAll}>
                  Expand all
                </button>
                <button type="button" onClick={collapseAll}>
                  Collapse all
                </button>
              </div>

              {treeRows.length === 0 ? (
                <p className="empty-state">Nothing matches that filter.</p>
              ) : (
                <JsonTreeView
                  rows={visibleRows}
                  hiddenCount={treeRows.length - visibleRows.length}
                  onToggle={toggleRow}
                  onCopyPath={(path) => copyText(path, 'Path')}
                  onCopyValue={(node) =>
                    copyText(stringifyNode(node, indent), 'Value')
                  }
                  onShowMore={() =>
                    setRowLimit((current) => current + ROW_LIMIT_STEP)
                  }
                />
              )}
            </>
          ) : view === 'formatted' ? (
            <pre
              className={`output-code ${wrapOutput ? 'wrap' : 'no-wrap'}`}
            >
              {formattedText}
            </pre>
          ) : view === 'query' ? (
            <QueryPanel
              expression={queryExpression}
              examples={QUERY_EXAMPLES}
              result={queryResult}
              onExpressionChange={setQueryExpression}
              onCopyPath={(path) => copyText(path, 'Path')}
              onCopyValue={(node) =>
                copyText(stringifyNode(node, indent), 'Value')
              }
            />
          ) : (
            <StatsPanel
              stats={stats}
              warnings={warnings}
              sourceBytes={sourceBytes}
              minifiedBytes={byteLength(minifiedText)}
            />
          )}
        </article>
      </section>

      <footer className="site-footer">
        <p>Local JSON Manager is designed for private, offline-safe workflows.</p>
        <p className="footer-secondary">
          Tip: use Tree to explore, Query to pull values out, and Repair to
          rescue almost-JSON.
        </p>
      </footer>
    </main>
  )
}

export default App
