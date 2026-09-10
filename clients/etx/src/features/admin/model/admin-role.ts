export const ADMIN_ROLE = {
  Admin: 'admin',
  Super: 'super',
} as const

export type AdminRole = (typeof ADMIN_ROLE)[keyof typeof ADMIN_ROLE]

export function parseAdminRole(value: unknown): AdminRole | null {
  if (value === ADMIN_ROLE.Admin || value === ADMIN_ROLE.Super) {
    return value
  }

  return null
}
