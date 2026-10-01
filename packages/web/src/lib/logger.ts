/**
 * The Workers' logger.
 *
 * `RpcServer` already opens a span per RPC, so the two RPC groups have been
 * timed and named since ADR 0003. Nothing was reading them: the default logger
 * is not a Worker logger, and a span nobody can see is not observability. This
 * module is the missing half — one `Logger` both Workers run with, so a span
 * surfaces as a structured line `wrangler tail` prints.
 *
 * `consoleJson` rather than the console-shaped loggers because a Worker's
 * output is a log pipeline, not a terminal: one JSON object per line is what
 * `wrangler tail` and any host's log store can filter on, and a formatted
 * human string is not.
 *
 * A reference layer (`Layer<never>`), so providing it is a no-op when something
 * above already set a Logger — which is what lets a test provide
 * `Logger.make(...)` over it without this being in the way.
 */

import { Logger } from 'effect'

/** The Workers' logger: structured JSON lines on the platform's stdout. */
export const WorkerLoggerLive = Logger.layer([Logger.consoleJson])
