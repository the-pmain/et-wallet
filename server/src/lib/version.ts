/**
 * Comparison of `MAJOR.MINOR.PATCH` versions.
 *
 * WHY NO LIBRARY. Full semver includes pre-release tags and build
 * metadata with non-trivial ordering. App versions are simpler, and
 * ten tested lines are clearer than a dependency whose edge cases
 * you have to take on faith. If pre-releases are needed — take a
 * library, do not add rules here.
 *
 * NUMERIC COMPARISON, NOT STRING. String compare ranks `0.10.0`
 * below `0.9.0`, and the app calls a fresh version outdated — or,
 * worse, an outdated one supported.
 */

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/u

interface IVersionParts {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/** Whether the string is `MAJOR.MINOR.PATCH`. */
export function isValidVersion(value: string): boolean {
  return VERSION_PATTERN.test(value)
}

/**
 * Parses a version.
 *
 * @throws Error if the string is not `MAJOR.MINOR.PATCH`.
 */
export function parseVersion(value: string): IVersionParts {
  const match = VERSION_PATTERN.exec(value)

  if (match === null) {
    throw new Error(`Version must look like MAJOR.MINOR.PATCH, received: ${value}`)
  }

  /* Groups exist by construction of the regex, but index checks are
     on in the compiler settings, and bypassing them with a cast would
     disable exactly the protection they exist for. */
  const [, major = '0', minor = '0', patch = '0'] = match

  return { major: Number(major), minor: Number(minor), patch: Number(patch) }
}

/**
 * Compares two versions.
 *
 * @returns Negative if `left` is below `right`, zero if equal,
 *          positive if `left` is above.
 * @throws Error if either string is malformed.
 */
export function compareVersions(left: string, right: string): number {
  const first = parseVersion(left)
  const second = parseVersion(right)

  if (first.major !== second.major) {
    return first.major - second.major
  }

  if (first.minor !== second.minor) {
    return first.minor - second.minor
  }

  return first.patch - second.patch
}
