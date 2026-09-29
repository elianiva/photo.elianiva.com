#!/usr/bin/env node
/**
 * Converts the resolved Brilliant design-system artifact for the `broadsheet`
 * brand into the Tailwind CSS v4 token layer this package ships.
 *
 * Inputs (vendored byte-identical from the Brilliant project `photo.elianiva.com`):
 *
 *   design/broadsheet.gen.yaml   the resolved token catalog (primitives + semantics)
 *   design/default.ds            the project baseline, source of the inherited tokens
 *   design/broadsheet.ds         the brand delta
 *
 * The `.ds` files are read only for the `color.*` alias table: the resolved
 * artifact carries an alias's value but not what it points at, and the dark
 * branch of an alias is the dark branch of its target.
 *
 * Usage:
 *   node scripts/generate-design-tokens.mjs           write src/tokens.css
 *   node scripts/generate-design-tokens.mjs --check   fail if src/tokens.css is stale
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const designDir = join(packageRoot, 'design')
const outputFile = join(packageRoot, 'src', 'tokens.css')
const checkOnly = process.argv.includes('--check')

// ---------------------------------------------------------------------------
// design-system vocabulary
// ---------------------------------------------------------------------------

/** The nine `boldness` roles, ordered. A dark `mirror` reflects across this band. */
const ROLE_ORDER = ['hint', 'faint', 'subtle', 'soft', 'mid', 'firm', 'bold', 'strong', 'intense']

const isRole = (name) => ROLE_ORDER.includes(name)

/** The role a dark `mirror` lands on: the index reflection across `mid`. */
const mirrorRole = (role) => {
  const index = ROLE_ORDER.indexOf(role)
  return index === -1 ? undefined : ROLE_ORDER[ROLE_ORDER.length - 1 - index]
}

const THEME_EXCLUDE = new Set([
  // A catalog alias whose value (12) would silently retint shadcn's `text-base`.
  'font.size.base',
  // Tailwind's `rounded-none` / `rounded-full` are static utilities, not theme keys.
  'radius.none',
  'radius.full',
])

/**
 * DS path -> CSS custom property, for the tokens that no Tailwind theme
 * namespace covers. Explicit by design: every custom key must appear here or
 * generation fails, so a token can never be silently dropped. `unit` is
 * appended to numeric values (`px` for lengths, none for counts).
 */
const CUSTOM_TOKENS = {
  'breakpoint.tablet': { name: '--breakpoint-tablet', unit: 'px' },
  'breakpoint.desktop': { name: '--breakpoint-desktop', unit: 'px' },
  'layout.content.max': { name: '--layout-content-max', unit: 'px' },
  'layout.margin': { name: '--layout-margin', unit: 'px' },
  'layout.margin.mobile': { name: '--layout-margin-mobile', unit: 'px' },
  'grid.columns': { name: '--grid-columns', unit: '' },
  'grid.columns.mobile': { name: '--grid-columns-mobile', unit: '' },
  'motion.duration.fast': { name: '--motion-duration-fast', unit: 'ms' },
  'motion.duration.base': { name: '--motion-duration-base', unit: 'ms' },
  'motion.duration.slow': { name: '--motion-duration-slow', unit: 'ms' },
  // Brilliant's named easings; the curves live in its engine, not the catalog.
  'motion.ease.in': { name: '--motion-ease-in', unit: '' },
  'motion.ease.out': { name: '--motion-ease-out', unit: '' },
  'motion.ease.in-out': { name: '--motion-ease-in-out', unit: '' },
  'image.preview.long-edge': { name: '--image-preview-long-edge', unit: 'px' },
  'image.preview.quality': { name: '--image-preview-quality', unit: '' },
  'image.full.quality': { name: '--image-full-quality', unit: '' },
  'image.blurhash.x': { name: '--image-blurhash-x', unit: '' },
  'image.blurhash.y': { name: '--image-blurhash-y', unit: '' },
}

/** Fallback stacks appended to the brand faces, so a `font-*` utility never dangles. */
const FAMILY_FALLBACK = {
  '--font-sans': 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  '--font-serif': 'ui-serif, Georgia, "Times New Roman", serif',
  '--font-mono': 'ui-monospace, "SF Mono", Menlo, monospace',
}

/** `font.family*` -> the Tailwind font-family utility it backs. */
const FAMILY_TOKENS = [
  ['font.family', '--font-sans'],
  ['font.family.sans', '--font-sans'],
  ['font.family.serif', '--font-serif'],
  ['font.family.mono', '--font-mono'],
]

/**
 * The foldcn/shadcn semantic contract this package's `components/ui` speaks.
 * Each name is bound to the broadsheet role that carries its meaning, so the
 * component layer re-tints with the brand and flips with the theme.
 */
const CONTRACT = [
  ['background', 'color.surface'],
  ['foreground', 'color.text.primary'],
  ['card', 'color.surface.container'],
  ['card-foreground', 'color.on-surface'],
  ['popover', 'color.surface'],
  ['popover-foreground', 'color.on-surface'],
  ['primary', 'color.primary'],
  ['primary-foreground', 'color.on-primary'],
  ['secondary', 'color.surface.container'],
  ['secondary-foreground', 'color.on-surface'],
  ['muted', 'color.surface.container'],
  ['muted-foreground', 'color.text.secondary'],
  ['accent', 'color.surface.hover'],
  ['accent-foreground', 'color.on-surface'],
  ['destructive', 'color.error'],
  ['destructive-foreground', 'color.on-error'],
  ['border', 'color.outline'],
  ['input', 'color.outline'],
  ['ring', 'color.focus'],
]

// ---------------------------------------------------------------------------
// read the artifact
// ---------------------------------------------------------------------------

const resolvedSource = readFileSync(join(designDir, 'broadsheet.gen.yaml'), 'utf8')
const resolvedHash = createHash('sha256').update(resolvedSource).digest('hex')
const catalog = parseYaml(resolvedSource)

const primitives = new Map()
const semantics = new Map()
const composites = new Map()
const shadowLayers = new Map()
let hiddenPalettes = []
let pinnedTokens = []

for (const [key, value] of Object.entries(catalog)) {
  if (key === '$hide' || key === '$pin') {
    if (key === '$hide') hiddenPalettes = value ?? []
    else pinnedTokens = value ?? []
    continue
  }
  if (Array.isArray(value)) {
    shadowLayers.set(key, value)
    continue
  }
  if (value !== null && typeof value === 'object') {
    const fields = Object.keys(value)
    if (fields.includes('$default')) {
      const extra = fields.filter((field) => field !== '$default')
      if (extra.length > 0) {
        throw new Error(
          `${key}: expected only $default, found ${extra.join(', ')}. ` +
            'Mode-keyed branches need explicit light/dark emission in this generator.',
        )
      }
      semantics.set(key, value.$default)
      continue
    }
    composites.set(key, value)
    continue
  }
  primitives.set(key, value)
}

/** `color.*` alias table, baseline first so the brand delta wins. */
const aliasLine = /^(color\.[\w.-]+):\s*([\w.-]+)\s*(?:\/\/.*)?$/
const aliases = new Map()
const aliasFiles = ['default.ds', 'broadsheet.ds'].map((file) =>
  readFileSync(join(designDir, file), 'utf8'),
)
for (const file of aliasFiles) {
  for (const line of file.split('\n')) {
    const match = aliasLine.exec(line)
    if (match) aliases.set(match[1], match[2])
  }
}

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

const paletteOrder = []
const paletteStops = new Map() // palette -> Map(stop -> value)
const paletteRoles = new Map() // palette -> Map(role -> light value)
const barePalettes = new Set()

// A palette is a prefix whose `.500` stop is a color. Checking the stop rather
// than the name keeps scale families such as `visibility` (whose nine stops
// share the boldness role names) out of the palette layer.
const isHex = (value) => typeof value === 'string' && value.startsWith('#')
for (const [key, value] of primitives) {
  const stop = /^([a-z]+)\.(\d+)$/.exec(key)
  if (!stop) continue
  const palette = stop[1]
  if (!isHex(primitives.get(`${palette}.500`))) continue
  if (!paletteStops.has(palette)) {
    paletteStops.set(palette, new Map())
    paletteOrder.push(palette)
  }
  paletteStops.get(palette).set(stop[2], value)
}
for (const [key, value] of primitives) {
  if (/^[a-z]+$/.test(key) && isHex(value)) barePalettes.add(key)
}
for (const [key, value] of semantics) {
  const role = /^([a-z]+)\.([a-z]+)$/.exec(key)
  if (!role || !isRole(role[2]) || !paletteStops.has(role[1])) continue
  const [, palette, name] = role
  if (!paletteRoles.has(palette)) paletteRoles.set(palette, new Map())
  paletteRoles.get(palette).set(name, value)
}

const errors = []

/** Dark branch of a palette role: the light value of its mirror partner. */
const darkRoleValue = (palette, role) => {
  const partner = mirrorRole(role)
  const partnerValue = paletteRoles.get(palette)?.get(partner)
  if (partnerValue === undefined) {
    errors.push(`${palette}.${role}: no mirror partner ${palette}.${partner} in the catalog`)
    return semantics.get(`${palette}.${role}`)
  }
  return partnerValue
}

/** Source custom property for a `color.*` role, e.g. `--role-text-primary`. */
const roleVar = (key) => `--role-${key.replace(/^color\./, '').replace(/\./g, '-')}`

/** The Tailwind-facing name for a `color.*` role, e.g. `--color-role-text-primary`. */
const colorRoleVar = (key) => `--color-${roleVar(key).slice(2)}`

// `color.*` split by whether the catalog themes it.
const themedColorRoles = [] // semantics: mode-keyed, mirror along the alias target
const flatColorRoles = [] // primitives: mode-independent
for (const [key, value] of semantics) {
  if (!key.startsWith('color.')) continue
  const target = aliases.get(key)
  if (target === undefined) {
    errors.push(`${key}: no \`${key}: <target>\` alias in default.ds or broadsheet.ds`)
    continue
  }
  const palette = target.split('.')[0]
  const role = target.slice(palette.length + 1)
  if (isRole(role) && paletteRoles.has(palette)) {
    themedColorRoles.push({ key, value, dark: darkRoleValue(palette, role), target })
  } else if (paletteStops.get(palette)?.has(role)) {
    // Alias to a raw stop: the stop is mode-independent, so both branches agree.
    themedColorRoles.push({ key, value, dark: value, target })
  } else {
    errors.push(`${key}: alias target ${target} is neither a palette role nor a stop`)
  }
}
for (const [key, value] of primitives) {
  if (key.startsWith('color.')) flatColorRoles.push({ key, value })
}

if (errors.length > 0) throw new Error(`unresolved design tokens:\n  ${errors.join('\n  ')}`)

// Family name -> the utility var that carries it, for the typography composites.
const familyByName = new Map()
for (const [dsKey, cssVar] of FAMILY_TOKENS) {
  const name = primitives.get(dsKey)
  if (typeof name === 'string' && !familyByName.has(name)) familyByName.set(name, cssVar)
}

// Every catalog key this script will emit. Anything left over is a hard error.
const handled = new Set([...barePalettes])
for (const [palette, stops] of paletteStops) {
  for (const stop of stops.keys()) handled.add(`${palette}.${stop}`)
}
for (const [palette, roles] of paletteRoles) {
  for (const role of roles.keys()) handled.add(`${palette}.${role}`)
}
for (const [key] of FAMILY_TOKENS) handled.add(key)
for (const key of Object.keys(CUSTOM_TOKENS)) handled.add(key)
for (const key of shadowLayers.keys()) handled.add(key)
for (const key of composites.keys()) handled.add(key)
for (const { key } of themedColorRoles) handled.add(key)
for (const { key } of flatColorRoles) handled.add(key)

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------

const lines = []
const push = (...values) => lines.push(...values)

const px = (value, unit = 'px') => (typeof value === 'number' ? `${value}${unit}` : String(value))
const dash = (name) => name.replace(/\./g, '-')

// --- 1. palette primitives --------------------------------------------------

push(
  '/* ---------------------------------------------------------------------------',
  ' * 1. Palette primitives (mode-independent)',
  ' *',
  ' * `name.50` .. `name.950` as the catalog emits them. The bare palette alias',
  ' * (`$red`) equals the `.500` stop, so it is not repeated — which also keeps',
  ' * `primary`, `secondary` and `accent` free for the foldcn contract (section 5).',
  ' * -------------------------------------------------------------------------- */',
  '@theme {',
)
for (const palette of paletteOrder) {
  for (const [stop, value] of paletteStops.get(palette)) {
    push(`  --color-${palette}-${stop}: ${value};`)
  }
  push('')
}
lines.pop()
push('}', '')

// --- 2. scales and elevation ------------------------------------------------

/**
 * Every numeric family the catalog declares, split into the stops Tailwind can
 * name — non-numeric names take the namespace, so `font.size.md` becomes
 * `--text-md` — and the stops it cannot, which land in section 3.
 */
const SCALE_FAMILIES = [
  { ds: 'font.size', theme: '--text-', plain: '--font-size', unit: 'px' },
  { ds: 'font.weight', theme: '--font-weight-', plain: '--font-weight', unit: '' },
  { ds: 'font.lineHeight', theme: '--leading-', plain: '--line-height', unit: '' },
  { ds: 'font.letterSpacing', theme: '--tracking-', plain: '--letter-spacing', unit: 'em' },
  // `spacing` stays out of `@theme` on purpose. Tailwind resolves `w-*`,
  // `min-w-*` and `max-w-*` against `--width`/`--spacing`/`--container` in that
  // order, so a theme key such as `--spacing-xl` shadows `--container-xl` and
  // silently turns `max-w-xl` into a 24px box. Plain custom properties keep the
  // scale reachable as `p-(--spacing-md)` without hijacking a Tailwind scale.
  { ds: 'spacing', theme: null, plain: '--spacing', unit: 'px' },
  { ds: 'radius', theme: '--radius-', plain: '--radius', unit: 'px' },
  { ds: 'visibility', theme: null, plain: '--visibility', unit: '' },
  { ds: 'stroke.width', theme: null, plain: '--stroke-width', unit: 'px' },
]
const scaleStops = new Map()
for (const family of SCALE_FAMILIES) {
  const named = []
  const plain = []
  const rows = [...semantics, ...primitives].filter(([key]) => key.startsWith(`${family.ds}.`))
  for (const [key, value] of rows) {
    const name = key.slice(family.ds.length + 1)
    if (/^[\d.]+$/.test(name) || THEME_EXCLUDE.has(key)) plain.push([name, value])
    else named.push([name, value])
  }
  // Ascending by value: for every one of these families the value already runs
  // in scale order, and it interleaves the catalog's positional stops with the
  // named ones in a readable way.
  const byValue = (a, b) => a[1] - b[1]
  scaleStops.set(family.ds, { family, named: named.sort(byValue), plain: plain.sort(byValue) })
}

push(
  '/* ---------------------------------------------------------------------------',
  ' * 2. Scales and elevation (mode-independent)',
  ' *',
  " * Namespaces are Tailwind's, so every named stop is reachable as a utility:",
  ' * font.family -> font-*, font.size -> text-*, font.weight -> font-*,',
  ' * font.lineHeight -> leading-*, font.letterSpacing -> tracking-*,',
  ' * radius -> rounded-*, shadow -> shadow-*, breakpoint -> variants.',
  ' * Every other stop, positional or not, lands in section 3 as a plain custom',
  ' * property reached with arbitrary-value syntax: `p-(--spacing-md)`,',
  ' * `border-(length:--stroke-width-mid)`. The spacing scale has to live there —',
  ' * see the note on `spacing` in the generator.',
  ' *',
  ' * The design system paints every shadow with an outer `drop()`, so `shadow.inner`',
  ' * is an outer shadow despite its name; it is emitted as authored.',
  ' * -------------------------------------------------------------------------- */',
  '@theme {',
  '  /* families */',
)
const emittedFamilies = new Set()
for (const [dsKey, cssVar] of FAMILY_TOKENS) {
  const name = primitives.get(dsKey)
  if (typeof name !== 'string') continue
  // `font.family.sans` is an alias of `font.family`; one utility is enough.
  if (dsKey !== 'font.family' && name === primitives.get('font.family')) continue
  if (emittedFamilies.has(cssVar)) continue
  emittedFamilies.add(cssVar)
  push(`  ${cssVar}: '${name}', ${FAMILY_FALLBACK[cssVar]};`)
}
for (const { family, named } of scaleStops.values()) {
  if (!family.theme || named.length === 0) continue
  push('', `  /* ${family.ds} */`)
  for (const [name, value] of named) {
    handled.add(`${family.ds}.${name}`)
    push(`  ${family.theme}${dash(name)}: ${px(value, family.unit)};`)
  }
}
push('', '  /* elevation */')
for (const [name, layers] of shadowLayers) {
  const shadow = layers
    .map((layer) => {
      const offsetX = layer.x === undefined ? '0' : `${layer.x}px`
      const offsetY = `${layer.y}px`
      const blur = `${layer.blur ?? 0}px`
      const spread = layer.spread === undefined ? '' : ` ${layer.spread}px`
      return `${offsetX} ${offsetY} ${blur}${spread} ${layer.color}`
    })
    .join(', ')
  push(`  --shadow-${name.slice('shadow.'.length)}: ${shadow};`)
}
push('', '  /* breakpoints */')
for (const [dsKey, custom] of Object.entries(CUSTOM_TOKENS)) {
  if (!custom.name.startsWith('--breakpoint-')) continue
  push(`  ${custom.name}: ${px(semantics.get(dsKey) ?? primitives.get(dsKey), custom.unit)};`)
}
push('}', '')

// --- 3. numeric catalog stops ----------------------------------------------

push(
  '/* ---------------------------------------------------------------------------',
  ' * 3. Numeric catalog stops (mode-independent)',
  ' *',
  " * The positional stops Brilliant's catalog generator emits alongside the",
  ' * authored scales, plus the spacing scale. None of them carry a Tailwind',
  ' * namespace, so they are plain custom properties reached through',
  ' * arbitrary-value syntax, e.g. `max-w-(--layout-content-max)`,',
  ' * `p-(--spacing-md)`, `border-(length:--stroke-width-mid)`.',
  ' * -------------------------------------------------------------------------- */',
  ':root {',
)
for (const { family, named, plain } of scaleStops.values()) {
  // A family with no Tailwind namespace has nothing to distinguish, so its
  // named roles sit here beside the positional stops.
  const rows = (family.theme ? plain : [...named, ...plain]).sort((a, b) => a[1] - b[1])
  if (rows.length === 0) continue
  push(`  /* ${family.ds} */`)
  for (const [name, value] of rows) {
    handled.add(`${family.ds}.${name}`)
    push(`  ${family.plain}-${dash(name)}: ${px(value, family.unit)};`)
  }
  push('')
}
lines.pop()
push('', '  /* custom tokens */')
for (const [dsKey, custom] of Object.entries(CUSTOM_TOKENS)) {
  if (custom.name.startsWith('--breakpoint-')) continue
  push(`  ${custom.name}: ${px(primitives.get(dsKey) ?? semantics.get(dsKey), custom.unit)};`)
}
push('}', '')

// --- 4. semantic color roles -----------------------------------------------

push(
  '/* ---------------------------------------------------------------------------',
  ' * 4. Semantic color roles, light and dark',
  ' *',
  ' * A `boldness` role mirrors across the nine-role band in the dark theme, so',
  ' * `neutral.hint` takes the light value of `neutral.intense`, and so on. These',
  ' * are plain custom properties bridged into Tailwind with `@theme inline`,',
  ' * which is what makes the utility follow the active theme.',
  ' * -------------------------------------------------------------------------- */',
  ':root {',
)
for (const palette of paletteOrder) {
  for (const [role, value] of paletteRoles.get(palette) ?? []) {
    push(`  --${palette}-${role}: ${value};`)
  }
}
push('', '  /* color.* roles */')
for (const { key, value } of themedColorRoles) push(`  ${roleVar(key)}: ${value};`)
push('', '  /* color.* roles the design system does not theme */')
for (const { key, value } of flatColorRoles) push(`  ${roleVar(key)}: ${value};`)
push('}', '', '.dark {')
for (const palette of paletteOrder) {
  for (const role of paletteRoles.get(palette)?.keys() ?? []) {
    push(`  --${palette}-${role}: ${darkRoleValue(palette, role)};`)
  }
}
push('', '  /* color.* roles */')
for (const { key, dark } of themedColorRoles) push(`  ${roleVar(key)}: ${dark};`)
push('}', '', '@theme inline {')
for (const palette of paletteOrder) {
  for (const role of paletteRoles.get(palette)?.keys() ?? []) {
    push(`  --color-${palette}-${role}: var(--${palette}-${role});`)
  }
}
for (const { key } of [...themedColorRoles, ...flatColorRoles]) {
  push(`  ${colorRoleVar(key)}: var(${roleVar(key)});`)
}
push('}', '')

// --- 5. the foldcn / shadcn contract ---------------------------------------

push(
  '/* ---------------------------------------------------------------------------',
  ' * 5. foldcn / shadcn contract',
  ' *',
  ' * `components/ui` is the vendored foldcn registry, so these names stay put.',
  ' * Each one is bound to a broadsheet role, which is why they re-tint with the',
  ' * brand and flip under `.dark` without a second dark block here.',
  ' * -------------------------------------------------------------------------- */',
  ':root {',
)
for (const [name, role] of CONTRACT) push(`  --${name}: var(${roleVar(role)});`)
push('}', '', '@theme inline {')
for (const [name] of CONTRACT) push(`  --color-${name}: var(--${name});`)
push('}', '')

// --- 6. typography composites ---------------------------------------------

push(
  '/* ---------------------------------------------------------------------------',
  ' * 6. Typography composites',
  ' *',
  ' * A composite is one decision: family, size, weight, leading and tracking set',
  ' * together, exactly as `typography.*` declares it in the design system.',
  ' * -------------------------------------------------------------------------- */',
)
for (const [key, fields] of composites) {
  const name = `type-${key.slice('typography.'.length).replace(/\./g, '-')}`
  const declarations = []
  if (fields.fontFamily !== undefined) {
    const cssVar = familyByName.get(fields.fontFamily)
    if (!cssVar) throw new Error(`${key}: unknown font family ${fields.fontFamily}`)
    declarations.push(['font-family', `var(${cssVar})`])
  }
  for (const [field, cssProperty, unit] of [
    ['fontSize', 'font-size', 'px'],
    ['fontWeight', 'font-weight', ''],
    ['lineHeight', 'line-height', ''],
    ['letterSpacing', 'letter-spacing', 'em'],
  ]) {
    if (fields[field] === undefined) continue
    declarations.push([cssProperty, `${fields[field]}${unit}`])
  }
  push(`@utility ${name} {`)
  for (const [property, value] of declarations) push(`  ${property}: ${value};`)
  push('}', '')
}
lines.pop()

// --- completeness gate ------------------------------------------------------

const unhandled = [...primitives.keys(), ...semantics.keys()].filter((key) => !handled.has(key))
if (unhandled.length > 0) {
  throw new Error(
    `the catalog holds tokens this generator does not emit:\n  ${unhandled.join('\n  ')}\n` +
      'Teach the generator about them (CUSTOM_TOKENS for a new family) rather than dropping them.',
  )
}

// --- assemble ---------------------------------------------------------------

const paletteRoleCount = [...paletteRoles.values()].reduce((total, roles) => total + roles.size, 0)
const header = [
  '/**',
  ' * GENERATED — DO NOT EDIT.',
  ' *',
  ' * The `broadsheet` design system of the Brilliant project `photo.elianiva.com`,',
  ' * converted to Tailwind CSS v4. Edit `design/*` or the generator, never this file.',
  ' *',
  ` *   source   packages/web/design/broadsheet.gen.yaml  (sha256 ${resolvedHash.slice(0, 16)})`,
  ' *   generate pnpm --filter @photo/web run tokens',
  ' *',
  ` * ${paletteOrder.length} palettes · ${paletteRoleCount} palette roles · ` +
    `${themedColorRoles.length + flatColorRoles.length} color.* roles · ` +
    `${composites.size} typography composites · ${shadowLayers.size} shadows`,
  ' *',
  ` * Hidden in Brilliant's picker (\`hide:\`): ${hiddenPalettes.join(', ')}`,
  ` * Pinned in Brilliant's picker (\`pin:\`): ${pinnedTokens.length} tokens`,
  ' */',
  '',
].join('\n')

const output = `${header}${lines.join('\n')}\n`

if (checkOnly) {
  if (readFileSync(outputFile, 'utf8') !== output) {
    console.error('src/tokens.css is stale — run `pnpm --filter @photo/web run tokens`')
    process.exit(1)
  }
  console.log('src/tokens.css is up to date')
} else {
  writeFileSync(outputFile, output)
  console.log(
    `wrote src/tokens.css — ${paletteOrder.length} palettes, ${paletteRoleCount} palette roles, ` +
      `${composites.size} typography composites, ${output.split('\n').length} lines`,
  )
}
