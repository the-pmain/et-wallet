import type { FastifyRequest } from 'fastify'

import { ForbiddenError, UnauthorizedError } from '../lib/errors.ts'
import { ADMIN_ROLE, resolveAdminRole, type AdminRole } from './pin.ts'

export function presentedAdminPin(request: FastifyRequest): string | null {
  const header = request.headers['x-admin-pin']
  const pin = Array.isArray(header) ? header[0] : header

  if (typeof pin !== 'string' || pin.trim() === '') {
    return null
  }

  return pin.trim()
}

export function requireAdminRole(request: FastifyRequest): AdminRole {
  const pin = presentedAdminPin(request)

  if (pin === null) {
    throw new UnauthorizedError('Invalid credentials.')
  }

  const role = resolveAdminRole(pin)

  if (role === null) {
    throw new UnauthorizedError('Invalid credentials.')
  }

  return role
}

export function requireSuperAdmin(request: FastifyRequest): void {
  if (requireAdminRole(request) !== ADMIN_ROLE.Super) {
    throw new ForbiddenError('Insufficient permissions.')
  }
}
