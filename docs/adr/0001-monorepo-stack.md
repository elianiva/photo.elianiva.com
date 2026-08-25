# Monorepo stack: pnpm + Turborepo + Foldkit + Effect + Alchemy

We use a pnpm workspace (`packages/*`) with Turborepo (`build` depends on `^build`, `typecheck`/`test` separate, `dev` persistent), Foldkit for the frontend (`packages/web`), Effect for the backend and shared schemas (`packages/api` + `packages/shared`), Tailwind CSS v4 (`@tailwindcss/vite`), and Alchemy (`alchemy.run.ts`) deploying a single Cloudflare `Website.Vite` on `photo.elianiva.com` (prod only). This matches the org conventions in `lutra`/`foldcn`/`saku` and keeps infra, frontend, and domain model in one repo.
