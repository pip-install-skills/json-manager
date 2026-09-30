import { describe, expect, it } from 'vitest'
import { parseJson, stringifyNode } from './jsonEngine'
import { repairJson } from './jsonRepair'

/** Repairs the text and returns it minified, proving the result really parses. */
const repairAndMinify = (text: string): string => {
  const repaired = repairJson(text)
  const result = parseJson(repaired.text)

  if (!result.ok) {
    throw new Error(
      `repaired text is still invalid: ${result.error.message}\n${repaired.text}`,
    )
  }

  return stringifyNode(result.root, '')
}

describe('repairJson', () => {
  it('leaves valid JSON untouched', () => {
    const cases = [
      '{"a":1}',
      '{\n  "a": [1, 2],\n  "b": "x"\n}',
      '[]',
      '{"a":-1.5e-3,"b":0,"c":1.0}',
      '"just a string"',
      '{"note":"a // b and /* c */ stay put"}',
      '{"a":"it\'s fine"}',
    ]

    for (const text of cases) {
      const result = repairJson(text)

      expect(result.changed, text).toBe(false)
      expect(result.fixes, text).toEqual([])
      expect(result.text, text).toBe(text)
    }
  })

  it('removes line and block comments', () => {
    const result = repairJson('{\n  // leading\n  "a": 1 /* inline */\n}')

    expect(result.fixes).toContain('Removed comments')
    expect(repairAndMinify('{\n  // leading\n  "a": 1 /* inline */\n}')).toBe(
      '{"a":1}',
    )
  })

  it('drops trailing commas', () => {
    expect(repairJson('[1,2,]').text).toBe('[1,2]')
    expect(repairAndMinify('{"a":1,}')).toBe('{"a":1}')
    expect(repairAndMinify('{"a":[1,2,],}')).toBe('{"a":[1,2]}')
    expect(repairJson('[1,2,]').fixes).toContain('Removed trailing commas')
  })

  it('rewrites single-quoted strings', () => {
    expect(repairAndMinify("{'a': 'b'}")).toBe('{"a":"b"}')
    expect(repairAndMinify("{'a': 'say \"hi\"'}")).toBe('{"a":"say \\"hi\\""}')
    expect(repairAndMinify("{'a': 'it\\'s here'}")).toBe('{"a":"it\'s here"}')
    expect(repairJson("{'a':'b'}").fixes).toContain(
      'Rewrote single-quoted strings',
    )
  })

  it('replaces typographic quotes', () => {
    const result = repairJson('{“a”: “b”}')

    expect(result.fixes).toContain('Replaced typographic quotes')
    expect(repairAndMinify('{“a”: “b”}')).toBe('{"a":"b"}')
  })

  it('quotes bare keys and bare values', () => {
    expect(repairAndMinify('{a: 1, b_2: "x"}')).toBe('{"a":1,"b_2":"x"}')
    expect(repairAndMinify('{a: bare}')).toBe('{"a":"bare"}')
    expect(repairJson('{a:1}').fixes).toContain('Quoted bare property names')
    expect(repairJson('{"a":bare}').fixes).toContain('Quoted bare text values')
  })

  it('normalizes Python and JavaScript literals', () => {
    expect(repairAndMinify("{'ok': True, 'no': False, 'gone': None}")).toBe(
      '{"ok":true,"no":false,"gone":null}',
    )
    expect(repairAndMinify('{"a": undefined, "b": NaN, "c": Infinity}')).toBe(
      '{"a":null,"b":null,"c":null}',
    )
    expect(repairAndMinify('{"a": -Infinity}')).toBe('{"a":null}')
  })

  it('keeps real booleans and nulls as they are', () => {
    expect(repairJson('{"a":true,"b":false,"c":null}').changed).toBe(false)
  })

  it('inserts commas that are missing between values', () => {
    expect(repairAndMinify('[{"a":1} {"b":2}]')).toBe('[{"a":1},{"b":2}]')
    expect(repairAndMinify('{"a":1 "b":2}')).toBe('{"a":1,"b":2}')
    expect(repairAndMinify('["a" "b"]')).toBe('["a","b"]')
    expect(repairJson('{"a":1 "b":2}').fixes).toContain(
      'Inserted missing commas',
    )
  })

  it('normalizes number formats', () => {
    expect(repairAndMinify('{"a": +1, "b": .5, "c": 007, "d": 0x1f}')).toBe(
      '{"a":1,"b":0.5,"c":7,"d":31}',
    )
    expect(repairAndMinify('{"a": 1.}')).toBe('{"a":1}')
    expect(repairAndMinify('{"a": -0x10}')).toBe('{"a":-16}')
    expect(repairJson('{"a":007}').fixes).toContain('Normalized number formats')
  })

  it('completes truncated documents', () => {
    expect(repairAndMinify('{"a": [1, 2')).toBe('{"a":[1,2]}')
    expect(repairAndMinify('{"a":')).toBe('{"a":null}')
    expect(repairAndMinify('{"a": "unfinished')).toBe('{"a":"unfinished"}')
    expect(repairJson('{"a": [1').fixes).toContain(
      'Completed truncated structures',
    )
  })

  it('drops stray semicolons from copied source', () => {
    expect(repairAndMinify('{"a": 1};')).toBe('{"a":1}')
    expect(repairJson('{"a":1};').fixes).toContain('Removed stray characters')
  })

  it('handles a realistic config file in one pass', () => {
    const source = `{
  // service configuration
  'name': 'edge-worker',
  retries: 3,
  timeouts: [1000, 2500,],
  verbose: True,
  fallback: None,
  /* trailing block comment */
}`

    expect(repairAndMinify(source)).toBe(
      '{"name":"edge-worker","retries":3,"timeouts":[1000,2500],"verbose":true,"fallback":null}',
    )
  })

  it('reports every fix it applied without duplicates', () => {
    const result = repairJson("{a: 1, b: 'two', /* c */ d: [3,],}")

    expect(new Set(result.fixes).size).toBe(result.fixes.length)
    expect(result.fixes.length).toBeGreaterThan(2)
  })
})
