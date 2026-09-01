/**
 * European datetime for admin read-only fields: DD.MM.YYYY, HH:mm:ss (24h).
 */
export function formatAdminTimestamp(iso: string): string {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) {
    return iso
  }

  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export interface IAdminTimestampParts {
  readonly time: string
  readonly date: string
}

/** Splits an ISO timestamp into European time and date parts. */
export function formatAdminTimestampParts(iso: string): IAdminTimestampParts | null {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return {
    time: date.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    date: date.toLocaleDateString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
  }
}
