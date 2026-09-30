import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the workspace and validates the sample document', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Local JSON Manager' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Valid JSON')).toBeInTheDocument()
  })

  it('shows the sample document as a tree', () => {
    render(<App />)

    expect(screen.getByText('workspace')).toBeInTheDocument()
    expect(screen.getByText('"field-inventory"')).toBeInTheDocument()
  })

  it('opens the sample at the depth a load action would use', () => {
    const { container } = render(<App />)
    const visibleRows = () => container.querySelectorAll('.tree-row').length
    const initialRows = visibleRows()

    // Containers below the default depth start closed, so `sites[0]` is shut
    // and the values inside it are out of view.
    expect(screen.queryByText('"North Ridge"')).not.toBeInTheDocument()

    // Re-loading the document that is already open must not reshape the tree.
    fireEvent.click(screen.getByRole('button', { name: 'Sample' }))

    expect(visibleRows()).toBe(initialRows)
  })

  it('keeps the gutter numbering one line per line of source', () => {
    const { container } = render(<App />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '{\n  "a": 1,\n  "b": 2\n}' },
    })

    const gutter = container.querySelector('.editor-gutter')
    const editor = container.querySelector('.editor-input textarea')

    expect(gutter?.textContent).toBe('1\n2\n3\n4')
    // Soft wrapping would let one line occupy two rows and knock every number
    // below it out of step with the line it labels.
    expect(editor).toHaveClass('no-wrap')
  })

  it('reports the position where invalid JSON breaks', () => {
    render(<App />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '{"a" 1}' },
    })

    expect(screen.getByText('Invalid JSON')).toBeInTheDocument()
    expect(screen.getByText('Line 1, column 6')).toBeInTheDocument()
  })

  it('renders formatted output in the text view', () => {
    render(<App />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '{"a":[1,2]}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))

    // The default matcher collapses whitespace, which is exactly what this
    // assertion is about, so keep the text as rendered.
    expect(
      screen.getByText('{\n  "a": [\n    1,\n    2\n  ]\n}', {
        normalizer: (text) => text,
      }),
    ).toBeInTheDocument()
  })

  it('repairs almost-JSON in place', () => {
    render(<App />)

    const editor = screen.getByRole('textbox')
    fireEvent.change(editor, { target: { value: "{a: 1, /* x */ b: [2,],}" } })

    expect(screen.getByText('Invalid JSON')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Repair' }))

    expect(screen.getByText('Valid JSON')).toBeInTheDocument()
    expect(editor).toHaveValue('{"a": 1,  "b": [2]}')
  })

  it('filters the tree to matching nodes', () => {
    render(<App />)

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'harbour' },
    })

    expect(screen.getByText('"Harbour Yard"')).toBeInTheDocument()
    expect(screen.queryByText('"North Ridge"')).not.toBeInTheDocument()
  })
})
