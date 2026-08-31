const prodApiOrigin = 'https://photo-api.elianiva.com'
const localApiOrigin = 'https://photo-api.localhost'

export const apiOrigin = (): string => {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('localhost')) {
    return localApiOrigin
  }
  return prodApiOrigin
}

export const apiUrl = (path: string): string => `${apiOrigin()}${path}`
