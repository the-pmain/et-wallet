import type { FastifyInstance } from 'fastify'

import { requireAdminRole } from '../admin/access.ts'
import { AdminDirectory } from '../admin/AdminDirectory.ts'
import { readAdminPageQuery } from '../admin/page.ts'

import type {
  IAdminDirectoryReceiving,
  IAdminDirectorySending,
  IAdminPageResponse,
  IUserResponse,
} from './contracts.ts'
import { toUserResponse } from './user-response.ts'

const ADMIN_PAGE_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'string', maxLength: 8 },
    pageSize: { type: 'string', maxLength: 4 },
    q: { type: 'string', maxLength: 200 },
    status: { type: 'string', maxLength: 16 },
  },
} as const

interface IAdminPageQuerystring {
  readonly page?: string
  readonly pageSize?: string
  readonly q?: string
  readonly status?: string
}

/**
 * Cabinet directory pages.
 *
 * One request per list: join, search, and pagination happen here.
 * `GET /v1/admin/sendings` and friends stay as unpaged dumps for
 * toasts and the other client.
 */
export function registerDirectoryRoutes(app: FastifyInstance, directory: AdminDirectory): void {
  app.get<{ Querystring: IAdminPageQuerystring }>(
    '/v1/admin/directory/sendings',
    { schema: { querystring: ADMIN_PAGE_QUERY } },
    async (request, reply) => {
      requireAdminRole(request)

      const page = await directory.listSendings(readAdminPageQuery(request.query))

      void reply.header('cache-control', 'no-store')

      return toPageResponse<IAdminDirectorySending>(page)
    },
  )

  app.get<{ Querystring: IAdminPageQuerystring }>(
    '/v1/admin/directory/receivings',
    { schema: { querystring: ADMIN_PAGE_QUERY } },
    async (request, reply) => {
      requireAdminRole(request)

      const page = await directory.listReceivings(readAdminPageQuery(request.query))

      void reply.header('cache-control', 'no-store')

      return toPageResponse<IAdminDirectoryReceiving>(page)
    },
  )

  app.get<{ Querystring: IAdminPageQuerystring }>(
    '/v1/admin/directory/users',
    { schema: { querystring: ADMIN_PAGE_QUERY } },
    async (request, reply) => {
      requireAdminRole(request)

      const page = await directory.listUsers(readAdminPageQuery(request.query))

      void reply.header('cache-control', 'no-store')

      return toPageResponse<IUserResponse>({
        items: page.items.map(toUserResponse),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      })
    },
  )

  app.get<{ Querystring: IAdminPageQuerystring }>(
    '/v1/admin/directory/activity',
    { schema: { querystring: ADMIN_PAGE_QUERY } },
    async (request, reply) => {
      requireAdminRole(request)

      const page = await directory.listActivity(readAdminPageQuery(request.query))

      void reply.header('cache-control', 'no-store')

      return toPageResponse(page)
    },
  )
}

function toPageResponse<T>(page: IAdminPageResponse<T>): IAdminPageResponse<T> {
  return {
    items: page.items,
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
  }
}
