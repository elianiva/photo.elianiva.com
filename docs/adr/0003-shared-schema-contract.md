# Shared Effect Schema contract

`packages/shared` owns the API and domain schemas (`HelloResponse`, `ApiError`, `Photo`, `Collection`, `PhotoId`/`CollectionId` brands) via `effect/Schema`. Both `packages/web` and `packages/api` depend on it as `workspace:*` and consume it as TS source via `paths` (`@photo/shared` → `../shared/src/index.ts`) — no build step, Vite transforms it on the fly. The scaffold ships mock `mockPhotos`/`mockCollections` decoded via `S.decodeSync`; the next iteration replaces them with a CMS fetch that still decodes through the same schemas.

We introduced `packages/shared` from day one (even for a Hello placeholder) so the contract boundary is established before any CMS choice locks the domain shape.
