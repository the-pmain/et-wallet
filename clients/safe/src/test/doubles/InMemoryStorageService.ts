import { MemoryStorageService } from '@/core'

/**
 * In-memory store for tests.
 *
 * An alias of `MemoryStorageService` from the core. A separate
 * implementation existed here before in-memory storage was needed
 * by the app for session mode; two copies of one code would
 * inevitably drift, and tests would stop checking what the app
 * actually runs.
 *
 * The name is kept so two dozen tests do not have to be rewritten.
 */
export class InMemoryStorageService extends MemoryStorageService {}
