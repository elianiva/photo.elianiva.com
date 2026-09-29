# Vendored design-system sources

Byte-identical copies of the Brilliant project `photo.elianiva.com`, read by
`scripts/generate-design-tokens.mjs` to write `src/tokens.css`.

| File | Source in the Brilliant project |
|---|---|
| `broadsheet.gen.yaml` | `Styles/.gen/broadsheet.gen.yaml` — the resolved token catalog |
| `broadsheet.ds` | `Styles/broadsheet.ds` — the brand delta |
| `default.ds` | `Styles/default.ds` — the baseline the brand inherits |

Verify a copy is still current before regenerating:

```bash
cmp packages/web/design/broadsheet.gen.yaml ~/Brilliant/photo.elianiva.com/Styles/.gen/broadsheet.gen.yaml
```

Then refresh the vendored files and regenerate:

```bash
cp ~/Brilliant/photo.elianiva.com/Styles/{default.ds,broadsheet.ds} packages/web/design/
cp ~/Brilliant/photo.elianiva.com/Styles/.gen/broadsheet.gen.yaml packages/web/design/
pnpm --filter @photo/web run tokens
```

`broadsheet.gen.yaml` is the authority for every value. The two `.ds` files are
read only for the `color.*` alias table: the catalog carries an alias's value
but not what it points at, and the dark branch of an alias is the dark branch of
its target.

Always regenerate from the app rather than editing `broadsheet.gen.yaml` by
hand. Brilliant writes `.gen/` itself and treats it as an export, and the
generator fails loudly when the catalog holds a token it does not know how to
emit, so a stale copy shows up as a build error instead of a silent gap.
