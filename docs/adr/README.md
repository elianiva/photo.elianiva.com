# Architecture decision records

Every decision here is **accepted** and the code is written to it. When the code
and an ADR disagree, the ADR is the bug — fix the code or supersede the ADR, and
never leave both standing.

| #                                                 | Decision                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [0001](0001-stack-and-contract.md)                | Monorepo stack, two Workers on one hostname, and `packages/shared` owning the contract   |
| [0002](0002-storage-and-image-delivery.md)        | R2 + D1, a flat Photo list with Tags, no CMS, and image delivery as the original's bytes |
| [0003](0003-rpc-contract-and-authorization.md)    | Effect RPC over HTTP, one Access application, in-Worker JWT verification                 |
| [0004](0004-the-worker-is-the-page-host.md)       | The website Worker is the only page host, and reads D1 through the same Layer stack      |
| [0005](0005-test-fakes-on-node-sqlite.md)         | `node:sqlite` and a `Map` behind the Gateway contracts, not miniflare                    |
| [0006](0006-redesign-non-goals-and-vocabulary.md) | The redesign frames deliberately not built, and the vocabulary they collided on          |

The domain language these decisions are written in — Photo, Tag, Rendition,
Status, Ratio, Frame, Archive, Storage, Public read — is `CONTEXT.md`, not
these files. `README.md` carries the route map and the shipping record.
