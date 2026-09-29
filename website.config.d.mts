/**
 * Shape only — the values live in `website.config.mjs`, which both
 * `alchemy.run.ts` and `scripts/build-website.mjs` read at runtime. Declaring
 * the type here keeps the shared contract importable from TypeScript without
 * a `tsx`/`allowJs` dependency.
 */
export declare const websiteWorker: {
  readonly rootDir: string
  readonly main: string
  readonly viteEnvironments: { readonly entry: string }
  readonly compatibility: { readonly date: string; readonly flags: ReadonlyArray<string> }
}
