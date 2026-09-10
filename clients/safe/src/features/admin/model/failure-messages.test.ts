import { describe, expect, it } from 'vitest'

import {
  FAILURE_MESSAGE_CUSTOM,
  FAILURE_MESSAGE_NONE,
  failureMessageSelectValue,
  isCustomFailureMessage,
} from './failure-messages'

describe('failureMessageSelectValue', () => {
  it('empty stays None, a known value a preset, a foreign one Custom', () => {
    expect(failureMessageSelectValue(null)).toBe(FAILURE_MESSAGE_NONE)
    expect(failureMessageSelectValue('Blocked by admin')).toBe('Blocked by admin')
    expect(failureMessageSelectValue('Node timed out')).toBe(FAILURE_MESSAGE_CUSTOM)
    expect(isCustomFailureMessage('Node timed out')).toBe(true)
    expect(isCustomFailureMessage('Blocked by admin')).toBe(false)
  })
})
