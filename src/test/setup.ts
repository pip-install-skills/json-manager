import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only auto-cleans when Vitest globals are enabled, and this
// project imports its test helpers explicitly instead.
afterEach(cleanup)
