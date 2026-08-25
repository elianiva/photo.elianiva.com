# CMS evaluation for photo metadata + image in one place

Requirement: UI that manages both image bytes and metadata (caption, location, takenAt, collection) together, scriptable bulk upload, free tier, auto-resizing.

**Evaluated (Aug 2026 pricing):**
- **Cloudflare R2 + Images**: R2 10GB/1M writes/10M reads/0 egress free; Images 5k unique transforms/mo free, $0.50/1k after, AVIF/WebP auto, S3-scriptable. Best cost at scale, but no CMS UI — needs a head on top.
- **Cloudinary Free**: 25 credits/mo (25k transforms OR 25GB store OR 25GB BW), URL transforms `f_auto,q_auto`, Admin API, multi-CDN. Best single-number free tier with dashboard, but credit math couples storage/bandwidth/transforms.
- **Sanity Free**: 5GB assets / 1GB BW / 500k API req / 2 datasets free (Studio embeddable, GROQ, URL transforms `?w=800&fm=webp`). Single place (assets + docs), scriptable `client.assets.upload()`. 5GB fills fast with RAWs — writes block at cap.
- **Directus / Payload (self-host, MIT)**: $0 software, bring-your-own R2/S3, Sharp transforms `?width=800&format=webp`, REST/GraphQL/JS SDK, single place. Needs hosting (Fly/Hetzner $5–7/mo) but unlimited via R2 zero-egress.
- **Contentful/Dato/Hygraph/Prismic/Strapi Cloud/Supabase**: caps too small for a photo dump (300–10k records, 1GB store) or no free tier in 2026 — rejected.

**Decision: defer CMS binding, keep scaffold CMS-agnostic.**

The scaffold uses mock `Photo`/`Collection` in `@photo/shared`. The domain schemas are the seam — the next PR replaces the mock with a fetch from the chosen CMS and serves images via its CDN (Sanity CDN or R2+Images `srcset`). Recommendation for the follow-up, given the "single place + UI + scriptable + free" constraint and an existing Cloudflare/Alchemy stack:

- **Fastest hosted path**: **Sanity Free** — Studio in `packages/web` or standalone, assets and documents together, zero infra to run. Accept the 5GB ceiling and archive RAWs externally if you exceed it.
- **Cheapest at scale / stays on CF**: **Directus self-hosted + R2 bucket** (Directus S3 driver → R2) + Cloudflare Images for transforms — single UI, unlimited storage via R2, scriptable REST, you pay only for the host.

Neither choice changes the scaffold — `Photo`/`Collection` schemas and the SSR `cache-control` stay the same. Pick one and the wiring PR is one package addition + one fetch in `entry.server.ts`.

Sources: `developers.cloudflare.com/images/pricing`, `developers.cloudflare.com/r2/pricing`, `cloudinary.com/pricing`, `sanity.io/pricing`, `directus.io/pricing`, `payloadcms.com`, `strapi.io/pricing-cloud` (Aug 2026).
