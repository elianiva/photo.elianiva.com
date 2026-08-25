import { Schema as S } from 'effect'

export const HelloResponse = S.Struct({
  message: S.String,
})
export type HelloResponse = typeof HelloResponse.Type

export class ApiError extends S.TaggedError<ApiError>()('ApiError', {
  message: S.String,
  cause: S.optional(S.Unknown),
}) {}
