/**
 * Cabinet header label: a name from the email, never the record id.
 *
 * THE RECORD ID NEVER APPEARS IN THE HEADER. It is a storage key, not
 * how the person presents themselves. The screen shows name, email,
 * and the month they joined.
 */

const LOCAL_PART_SEPARATOR = /[._-]+/u

export function displayNameFromEmail(email: string | null): string {
  if (email === null || email.trim() === '') {
    return 'Account'
  }

  const at = email.indexOf('@')
  const local = at === -1 ? email : email.slice(0, at)
  const withoutAlias = local.split('+')[0] ?? local
  const words = withoutAlias.split(LOCAL_PART_SEPARATOR).filter((part) => part.length > 0)

  if (words.length === 0) {
    return 'Account'
  }

  return words.map(titleCase).join(' ')
}

export function formatMemberSince(createdAt: string): string | null {
  const date = new Date(createdAt)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)

  return `Since ${month}`
}

function titleCase(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
}
