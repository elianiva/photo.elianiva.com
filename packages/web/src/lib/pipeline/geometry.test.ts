import { describe, expect, it } from 'vitest'
import { borderWidth, outputGeometry } from './geometry'

describe('borderWidth', () => {
  it('takes its share of the target width: 4% at 1080 is 40 px a side', () => {
    expect(borderWidth(1080, 4)).toBe(40)
    expect(borderWidth(1080, 0)).toBe(0)
  })
})

describe('outputGeometry', () => {
  const source = { width: 6000, height: 4000 }

  it('follows the photo when there is no frame', () => {
    const g = outputGeometry(source, { width: 1600, frame: 'original', borderPercent: 0 })
    expect(g.canvas).toEqual({ width: 1600, height: 1067 })
    expect(g.photo).toEqual(g.canvas)
  })

  it('frames a landscape photo inside a 4:5 portrait canvas at the target width', () => {
    const g = outputGeometry(source, { width: 1080, frame: '4:5', borderPercent: 0 })
    expect(g.canvas).toEqual({ width: 1080, height: 1350 })
    expect(g.photo).toEqual({ width: 1080, height: 720 })
  })

  it('keeps the output width on target with a border, and never upscales', () => {
    const g = outputGeometry(
      { width: 600, height: 400 },
      { width: 1080, frame: '1:1', borderPercent: 4 },
    )
    expect(g.border).toBe(40)
    expect(g.canvas.width + g.border * 2).toBe(1080)
    expect(g.photo).toEqual({ width: 600, height: 400 })
  })
})
