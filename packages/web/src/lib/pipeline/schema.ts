/**
 * The pipeline's vocabulary, declared once as Schemas: the settings an export
 * takes, the requests the main thread sends a Worker, the answers it sends
 * back, and the errors either side can fail with. The Worker boundary is
 * `postMessage`, so what crosses it is decoded against these rather than cast.
 */

import { Schema as S } from 'effect'

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

/** The browser could not decode the file. */
export class DecodeFailed extends S.TaggedError<DecodeFailed>()('DecodeFailed', {
  message: S.String,
}) {}

/** Resizing, compositing or a codec failed. */
export class EncodeFailed extends S.TaggedError<EncodeFailed>()('EncodeFailed', {
  message: S.String,
}) {}

/** The Web Worker died, timed out, or answered with something unreadable. */
export class WorkerFailed extends S.TaggedError<WorkerFailed>()('WorkerFailed', {
  message: S.String,
}) {}

export const PipelineError = S.Union([DecodeFailed, EncodeFailed, WorkerFailed])
export type PipelineError = typeof PipelineError.Type

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export const OutputFormat = S.Literals(['jpeg', 'webp', 'png'])
export type OutputFormat = typeof OutputFormat.Type

/** The frame presets; the ratio each one means is `FRAMES` in `geometry.ts`. */
export const Frame = S.Literals(['original', '1:1', '4:5', '5:4', '3:2', '2:3', '16:9', '9:16'])
export type Frame = typeof Frame.Type

export const ExportSettings = S.Struct({
  format: OutputFormat,
  /** The target width of the whole output, border included. */
  width: S.Number,
  quality: S.Number,
  frame: Frame,
  /** Border as a percentage of the frame. */
  borderPercent: S.Number,
  method: S.Literals(['lanczos3', 'mitchell', 'catrom', 'triangle']),
  background: S.String,
  borderColor: S.String,
})
export type ExportSettings = typeof ExportSettings.Type

// ---------------------------------------------------------------------------
// the Worker boundary
// ---------------------------------------------------------------------------

const File_ = S.instanceOf(Blob)

export const RenditionsRequest = S.TaggedStruct('renditions', {
  file: File_,
  smallLongEdge: S.Number,
  quality: S.Number,
})

export const ExportRequest = S.TaggedStruct('export', {
  file: File_,
  settings: ExportSettings,
})

export const WorkerRequest = S.Union([RenditionsRequest, ExportRequest])
export type WorkerRequest = typeof WorkerRequest.Type

/** The two WebP renditions from one decode. */
export const RenditionSet = S.Struct({
  small: File_,
  preview: File_,
  width: S.Number,
  height: S.Number,
})
export type RenditionSet = typeof RenditionSet.Type

export const ExportResult = S.Struct({
  blob: File_,
  extension: S.String,
  width: S.Number,
  height: S.Number,
})
export type ExportResult = typeof ExportResult.Type

/** A Worker's answer to one request: its result, or a typed failure. */
export type Answer<A> =
  | { readonly _tag: 'success'; readonly result: A }
  | { readonly _tag: 'failure'; readonly error: PipelineError }

const failure = S.TaggedStruct('failure', { error: PipelineError })

export const RenditionsAnswer = S.Union([
  S.TaggedStruct('success', { result: RenditionSet }),
  failure,
])

export const ExportAnswer = S.Union([S.TaggedStruct('success', { result: ExportResult }), failure])
