- no need to do e2e testing unless asked
- dev server: `pnpm dev` → site on http://localhost:5173, API Worker on http://localhost:13371 (requires Cloudflare secrets in the environment). One instance at a time: both ports are fixed and `strictPort` is on. The two are separate origins in dev only; in production the API Worker is a route on the site's hostname at `/api/*`, so the browser is same-origin and `pnpm dev` is the only stage that needs CORS.
- rigorous agent workflows: use `/poteto-mode` (pstack skills vendored in `.agents/skills/`)
- UI verification: `.agents/skills/verify-photo/` (doctor: `bash .agents/skills/verify-photo/scripts/doctor.sh`)
- image delivery: no zone image resizing (Free plan, not editable). Every image is the original from R2 via `/api/image/<key>`; there is no `thumbUrl`/`srcSet` and nothing may reintroduce `/cdn-cgi/image`.
- don't try to kill dev server if exists, just use it, don't try to restart because it will cause problems and duplicates

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
