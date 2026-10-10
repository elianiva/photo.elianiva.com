/**
 * Frame presets and size math for the client-side pipeline (ported from
 * imgutils). A ratio is width / height, so 4:5 is portrait. Pure: the worker
 * and the Download panel's size readout call the same functions.
 */

import type { ExportSettings, Frame } from './schema'

/** The width / height each frame preset means, so 4:5 is portrait. */
export const FRAMES: Record<Frame, number | null> = {
  original: null,
  '1:1': 1,
  '4:5': 4 / 5,
  '5:4': 5 / 4,
  '3:2': 3 / 2,
  '2:3': 2 / 3,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
}

export interface Size {
  readonly width: number
  readonly height: number
}

export type GeometrySettings = Pick<ExportSettings, 'width' | 'frame' | 'borderPercent'>

/** Border width for a target output width. The border sits outside the frame,
 *  so the output width stays on target: 4% at 1080 px is 40 px a side. */
export const borderWidth = (width: number, percent: number): number => {
  const fraction = percent / 100
  return Math.round((fraction / (1 + 2 * fraction)) * width)
}

const fitInside = (source: Size, boxWidth: number, boxHeight: number): Size => {
  const scale = Math.min(1, boxWidth / source.width, boxHeight / source.height)
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  }
}

/** Output canvas, the border band around it, and the photo inside the canvas.
 *  Never upscales: a photo smaller than the target keeps its own size. */
export const outputGeometry = (
  source: Size,
  { width, frame, borderPercent }: GeometrySettings,
): { canvas: Size; border: number; photo: Size } => {
  const ratio = FRAMES[frame]
  const border = borderWidth(width, borderPercent)
  if (ratio === null) {
    const photo = fitInside(source, width - border * 2, Infinity)
    return { canvas: photo, border, photo }
  }
  const innerWidth = width - border * 2
  const canvas = { width: innerWidth, height: Math.max(1, Math.round(innerWidth / ratio)) }
  return { canvas, border, photo: fitInside(source, canvas.width, canvas.height) }
}
