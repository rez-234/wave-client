/** A Maven coordinate such as "net.fabricmc:fabric-loader:0.19.5" or "org.lwjgl:lwjgl:3.3.3:natives-windows@jar". */
export interface MavenCoordinate {
  group: string
  artifact: string
  version: string
  classifier: string | null
  extension: string
}

export function parseMaven(name: string): MavenCoordinate {
  const at = name.lastIndexOf('@')
  const extension = at > 0 ? name.slice(at + 1) : 'jar'
  const parts = (at > 0 ? name.slice(0, at) : name).split(':')

  if (parts.length < 3 || parts.length > 4 || parts.some((part) => part.length === 0) || extension.length === 0) {
    throw new Error(`Not a Maven coordinate: ${name}`)
  }

  for (const part of [...parts, extension]) {
    // Each part becomes a path segment; refuse anything that could escape the libraries folder.
    if (part.includes('/') || part.includes('\\') || part === '.' || part === '..') {
      throw new Error(`Not a Maven coordinate: ${name}`)
    }
  }

  const [group, artifact, version, classifier] = parts as [string, string, string, string | undefined]
  return { group, artifact, version, classifier: classifier ?? null, extension }
}

/** The repository-relative path, with forward slashes: "net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar". */
export function mavenPath(coordinate: MavenCoordinate): string {
  const file = `${coordinate.artifact}-${coordinate.version}${coordinate.classifier ? `-${coordinate.classifier}` : ''}.${coordinate.extension}`
  return [...coordinate.group.split('.'), coordinate.artifact, coordinate.version, file].join('/')
}

/** The full URL in a repository; path segments are percent-encoded (a '+' in a version must be). */
export function mavenUrl(repository: string, coordinate: MavenCoordinate): string {
  const base = repository.endsWith('/') ? repository : `${repository}/`
  return base + mavenPath(coordinate).split('/').map(encodeURIComponent).join('/')
}

/**
 * The key two libraries share when one replaces the other on the classpath: group, artifact and
 * classifier, without the version.
 */
export function mavenKey(coordinate: MavenCoordinate): string {
  return `${coordinate.group}:${coordinate.artifact}${coordinate.classifier ? `:${coordinate.classifier}` : ''}`
}
