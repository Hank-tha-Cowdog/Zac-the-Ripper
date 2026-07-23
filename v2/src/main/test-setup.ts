import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { afterAll, beforeAll } from 'vitest'
import { _setLogDirForTesting } from './util/logger'
import { _setEventLogDirForTesting } from './util/event-log'

// Global test setup: redirect the app logger's file sinks to a throwaway
// temp directory for the whole test run. Without this, any test that
// transitively triggers a log call (nearly all of them — logger.ts and
// event-log.ts are imported by most main-process modules) writes into the
// user's real ~/Library/Logs/Zac the Ripper/ directory.
let testLogDir: string

beforeAll(() => {
  testLogDir = mkdtempSync(join(tmpdir(), 'ztr-test-logs-'))
  _setLogDirForTesting(testLogDir)
  _setEventLogDirForTesting(testLogDir)
})

afterAll(() => {
  _setLogDirForTesting(null)
  _setEventLogDirForTesting(null)
  try {
    rmSync(testLogDir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup — not worth failing the test run over
  }
})
