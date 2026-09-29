import { describe, expect, it } from 'vitest'

import { themeForPath } from './theme'

describe('themeForPath', () => {
  it('draws the Desk Library in the light branch', () => {
    expect(themeForPath('/admin')).toBe('light')
    expect(themeForPath('/admin/')).toBe('light')
  })

  it("reserves the Editor's address space for the dark branch", () => {
    expect(themeForPath('/admin/photo')).toBe('dark')
    expect(themeForPath('/admin/photo/kyoto-024')).toBe('dark')
  })

  it('leaves the public front page light', () => {
    expect(themeForPath('/')).toBe('light')
    // A path that merely starts with the same characters is not the Editor.
    expect(themeForPath('/admin/photos')).toBe('light')
  })
})
