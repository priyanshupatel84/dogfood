import { describe, expect, it } from 'vitest'
import { classifyEventTab, isShowcaseEvent } from '../../src/lib/hackathons'
import { isActiveNavItem } from '../../src/lib/nav'

describe('hackathon tabs', () => {
  it('lists open events as live', () => {
    expect(classifyEventTab('REGISTRATION')).toBe('live')
    expect(classifyEventTab('SUBMISSION')).toBe('live')
  })

  it('lists unopened events as upcoming', () => {
    expect(classifyEventTab('DRAFT')).toBe('upcoming')
  })

  it('lists judged and closed events as past', () => {
    expect(classifyEventTab('JUDGING')).toBe('past')
    expect(classifyEventTab('PUBLIC_VOTING')).toBe('past')
    expect(classifyEventTab('ARCHIVED')).toBe('past')
  })
})

describe('homepage showcase filter', () => {
  it('shows live and upcoming events, never past ones', () => {
    expect(isShowcaseEvent('live')).toBe(true)
    expect(isShowcaseEvent('upcoming')).toBe(true)
    expect(isShowcaseEvent('past')).toBe(false)
  })
})

describe('navbar active page', () => {
  it('matches each page to its own link', () => {
    expect(isActiveNavItem('/', '/')).toBe(true)
    expect(isActiveNavItem('/hackathons', '/hackathons')).toBe(true)
    expect(isActiveNavItem('/projects', '/projects')).toBe(true)
  })

  it('does not highlight Home on subpages', () => {
    expect(isActiveNavItem('/', '/hackathons')).toBe(false)
    expect(isActiveNavItem('/', '/projects')).toBe(false)
  })

  it('keeps the section highlighted on event detail pages', () => {
    expect(isActiveNavItem('/hackathons', '/hackathons/nebula-build-week')).toBe(true)
    expect(isActiveNavItem('/projects', '/hackathons')).toBe(false)
  })
})
