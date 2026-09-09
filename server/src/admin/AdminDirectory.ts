import type { IAdminDirectoryReceiving, IAdminDirectorySending } from '../api/contracts.ts'
import { groupLoginActivity, type IUserLoginActivity } from '../login-events/activity.ts'
import type { ILoginEventRecord, ILoginEventsRepository } from '../login-events/contracts.ts'
import type { IReceivingRecord } from '../receivings/contracts.ts'
import type { ReceivingsHub } from '../receivings/ReceivingsHub.ts'
import type { ReceivingsService } from '../receivings/ReceivingsService.ts'
import type { ISendingRecord } from '../sendings/contracts.ts'
import type { SendingsHub } from '../sendings/SendingsHub.ts'
import type { SendingsService } from '../sendings/SendingsService.ts'
import { SENDING_STATUS } from '../sendings/status.ts'
import type { IUserIdentity, IUserRecord, IUsersRepository } from '../users/contracts.ts'

import {
  directoryActivityMatches,
  directoryTransferMatches,
  directoryUserMatches,
} from './directory-query.ts'
import {
  ADMIN_DIRECTORY_CACHE_TTL_MS,
  ADMIN_DIRECTORY_SCAN_LIMIT,
  sliceAdminPage,
  type IAdminPage,
  type IAdminPageQuery,
} from './page.ts'
import { TtlCache } from './ttl-cache.ts'

/**
 * Cabinet directory lists.
 *
 * One HTTP answer per page: join user emails, apply search, then
 * slice. Scans live in a short TTL cache so paging and a second
 * in-flight GET do not hit the database again. Transfer pages load
 * identities (`id`, `email`), not wallets or assets.
 */
export class AdminDirectory {
  readonly #users: IUsersRepository
  readonly #sendings: SendingsService
  readonly #receivings: ReceivingsService
  readonly #loginEvents: ILoginEventsRepository
  readonly #identities: TtlCache<readonly IUserIdentity[]>
  readonly #userRecords: TtlCache<readonly IUserRecord[]>
  readonly #sendingRecords: TtlCache<readonly ISendingRecord[]>
  readonly #receivingRecords: TtlCache<readonly IReceivingRecord[]>
  readonly #loginRecords: TtlCache<readonly ILoginEventRecord[]>

  constructor(options: {
    readonly users: IUsersRepository
    readonly sendings: SendingsService
    readonly receivings: ReceivingsService
    readonly loginEvents: ILoginEventsRepository
    readonly sendingsHub?: SendingsHub
    readonly receivingsHub?: ReceivingsHub
    readonly now?: () => number
    readonly cacheTtlMs?: number
  }) {
    this.#users = options.users
    this.#sendings = options.sendings
    this.#receivings = options.receivings
    this.#loginEvents = options.loginEvents

    const ttlMs = options.cacheTtlMs ?? ADMIN_DIRECTORY_CACHE_TTL_MS
    const cache =
      options.now === undefined
        ? { ttlMs }
        : { ttlMs, now: options.now }

    this.#identities = new TtlCache(cache)
    this.#userRecords = new TtlCache(cache)
    this.#sendingRecords = new TtlCache(cache)
    this.#receivingRecords = new TtlCache(cache)
    this.#loginRecords = new TtlCache(cache)

    options.sendingsHub?.subscribeAll(() => {
      this.invalidateSendings()
    })
    options.receivingsHub?.subscribeAll(() => {
      this.invalidateReceivings()
    })
  }

  invalidateUsers(): void {
    this.#identities.invalidate()
    this.#userRecords.invalidate()
  }

  invalidateSendings(): void {
    this.#sendingRecords.invalidate()
  }

  invalidateReceivings(): void {
    this.#receivingRecords.invalidate()
  }

  invalidateActivity(): void {
    this.#loginRecords.invalidate()
    this.#userRecords.invalidate()
  }

  async listSendings(query: IAdminPageQuery): Promise<IAdminPage<IAdminDirectorySending>> {
    const [records, identities] = await Promise.all([
      this.#sendingRecords.get(() => this.#sendings.list({ limit: ADMIN_DIRECTORY_SCAN_LIMIT })),
      this.#loadIdentities(),
    ])
    const emails = emailByUserId(identities)
    const items = records
      .map((record) => toDirectorySending(record, emailFor(emails, record.userId)))
      .filter((item) => matchesTransferQuery(item, query))

    return sliceAdminPage(items, query)
  }

  async listReceivings(query: IAdminPageQuery): Promise<IAdminPage<IAdminDirectoryReceiving>> {
    const [records, identities] = await Promise.all([
      this.#receivingRecords.get(() =>
        this.#receivings.list({ limit: ADMIN_DIRECTORY_SCAN_LIMIT }),
      ),
      this.#loadIdentities(),
    ])
    const emails = emailByUserId(identities)
    const items = records
      .map((record) => toDirectoryReceiving(record, emailFor(emails, record.userId)))
      .filter((item) => matchesTransferQuery(item, query))

    return sliceAdminPage(items, query)
  }

  async listUsers(query: IAdminPageQuery): Promise<IAdminPage<IUserRecord>> {
    const users = await this.#userRecords.get(() => this.#users.list())
    const items = users.filter((user) => directoryUserMatches(user, query.q))

    return sliceAdminPage(items, query)
  }

  async listActivity(query: IAdminPageQuery): Promise<IAdminPage<IUserLoginActivity>> {
    const [users, events] = await Promise.all([
      this.#userRecords.get(() => this.#users.list()),
      this.#loginRecords.get(() => this.#loginEvents.list()),
    ])
    const items = groupLoginActivity(users, events).filter((row) =>
      directoryActivityMatches(row, query.q),
    )

    return sliceAdminPage(items, query)
  }

  async #loadIdentities(): Promise<readonly IUserIdentity[]> {
    const cachedUsers = this.#userRecords.peek()

    if (cachedUsers !== null) {
      return cachedUsers.map((user) => ({ id: user.id, email: user.email }))
    }

    return await this.#identities.get(() => this.#users.listIdentities())
  }
}

function matchesTransferQuery(
  item: IAdminDirectorySending,
  query: IAdminPageQuery,
): boolean {
  if (query.status === 'pending' && item.status !== SENDING_STATUS.Pending) {
    return false
  }

  return directoryTransferMatches(item, query.q, item.userEmail)
}

function emailByUserId(users: readonly IUserIdentity[]): ReadonlyMap<string, string | null> {
  const emails = new Map<string, string | null>()

  for (const user of users) {
    emails.set(user.id, user.email)
  }

  return emails
}

function emailFor(
  emails: ReadonlyMap<string, string | null>,
  userId: string | null,
): string | null {
  if (userId === null || userId === '') {
    return null
  }

  return emails.get(userId) ?? null
}

function toDirectorySending(
  record: ISendingRecord,
  userEmail: string | null,
): IAdminDirectorySending {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    userId: record.userId,
    userEmail,
    status: record.status,
    failureMessage: record.failureMessage,
    recipientAddress: record.recipientAddress,
    amount: record.amount,
    symbol: record.symbol,
  }
}

function toDirectoryReceiving(
  record: IReceivingRecord,
  userEmail: string | null,
): IAdminDirectoryReceiving {
  return {
    ...toDirectorySending(record, userEmail),
    usdAmount: record.usdAmount,
  }
}
