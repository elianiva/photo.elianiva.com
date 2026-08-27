export const apiOrigin = (): string => {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('localhost')) {
    return 'https://photo-api.localhost'
  }
  return 'https://photo-api.elianiva.com'
}

export const apiUrl = (path: string): string => `${apiOrigin()}${path}`
