import { describe, expect, it } from 'vitest'
import { canChangePrize, deriveEventStatus, trimmedMean, validateUrl } from '../../src/db/schema'

describe('Dogfood 2026 core acceptance', () => {
  it('enforces prize integrity', () => { expect(canChangePrize('SUBMISSION', 1000, 999)).toBe(false) })
  it('derives submission phase from server time', () => { const now = new Date('2026-05-20'); expect(deriveEventStatus({ status: 'REGISTRATION', submissionStart: new Date('2026-05-19'), submissionDeadline: new Date('2026-05-21'), judgingEndTime: new Date('2026-05-22'), publicVotingEndTime: new Date('2026-05-23') }, now)).toBe('SUBMISSION') })
  it('validates secure project URLs and normalized scores', () => { expect(validateUrl('https://github.com/dogfood/app')).toBe(true); expect(trimmedMean([1, 2, 3, 4, 100])).toBe(3) })
})
