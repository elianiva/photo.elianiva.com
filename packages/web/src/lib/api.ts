/**
 * The API Worker is an origin of its own in every stage: the ad-hoc
 * `photo-api.elianiva.com` in production, and its `dev.port` from
 * `alchemy.run.ts` on the dev server (the site's Vite dev server is 5173).
 */
const prodApiOrigin = 'https://photo-api.elianiva.com'
const devApiOrigin = 'http://localhost:13371'

export const apiOrigin = (): string => {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('localhost')) {
    return devApiOrigin
  }
  return prodApiOrigin
}

export const apiUrl = (path: string): string => `${apiOrigin()}${path}`
