import { describe, expect, it } from 'vitest'
import { formatCaptureTitle } from './exif-title'

describe('formatCaptureTitle', () => {
  it('writes the capture time as a sortable, filename-safe title', () => {
    expect(formatCaptureTitle(new Date(2026, 7, 31, 14, 22, 5))).toBe('2026-08-31 14.22.05')
    expect(formatCaptureTitle(new Date(2026, 0, 2, 3, 4, 9))).toBe('2026-01-02 03.04.09')
  })
})
