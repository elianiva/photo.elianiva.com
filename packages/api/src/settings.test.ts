import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { InvalidInput, type SiteSection } from '@photo/shared'
import { decodeSections, encodeSections } from './settings'

const NAV: ReadonlyArray<SiteSection> = [
  { kind: 'all', label: 'All' },
  { kind: 'tag', label: 'Street', target: 'street' },
  { kind: 'series', label: 'Series', target: 'istiklal-ferries' },
  { kind: 'page', label: 'About', target: 'about' },
]

const decode = (raw: string | null) => Effect.runPromise(Effect.flip(decodeSections(raw)))

describe('sections codec', () => {
  it('round-trips every section kind through the column', async () => {
    const stored = encodeSections(NAV)

    expect(await Effect.runPromise(decodeSections(stored))).toEqual(NAV)
  })

  it('reads an unauthored column as an empty nav', async () => {
    expect(await Effect.runPromise(decodeSections(null))).toEqual([])
  })

  it('fails on malformed JSON instead of publishing an empty nav', async () => {
    expect(await decode('ALL · STREET · LANDSCAPE')).toEqual(
      new InvalidInput({ message: 'settings.sections is not valid JSON' }),
    )
  })

  it('fails on JSON that is not a list of sections', async () => {
    const error = await decode('[{"kind":"tag","label":"Street"}]')

    expect(error).toBeInstanceOf(InvalidInput)
    expect(error.message).toContain('not a sections list')
  })

  it('fails on a section carrying a target its kind cannot use', async () => {
    const error = await decode('[{"kind":"all","label":"All","target":"street"}]')

    expect(error).toBeInstanceOf(InvalidInput)
    expect(error.message).toContain('not a sections list')
  })

  it('fails on a target that is not a slug', async () => {
    const error = await decode('[{"kind":"tag","label":"Street","target":"Not A Slug"}]')

    expect(error).toBeInstanceOf(InvalidInput)
  })
})
