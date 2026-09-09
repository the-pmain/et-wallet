import { NOTIFICATION_SEVERITY } from '../api/contracts.ts'

import type { INotificationEntry } from './types.ts'

/**
 * System-notification catalog.
 *
 * THIS IS THE SERVICE'S MOST DANGEROUS ROUTE. Server text shown inside
 * the wallet looks to the user like a message from the wallet itself.
 * Anyone who can write here can address fund owners in their wallet's
 * name.
 *
 * Limits are built into catalog validation, not left to the editor:
 *
 * - text only: no markup, no links, no addresses — validation rejects
 *   a record that looks like an on-chain address;
 * - bounded length: a long text pushes the wallet's own warnings off
 *   the screen;
 * - no requests to act on secrets — an editorial rule, so the client
 *   must keep a standing reminder next to any such message: the wallet
 *   never asks for the seed phrase.
 *
 * Notifications live in the repository for the same reason as the
 * other catalogs: a change must go through review and history.
 */
export const NOTIFICATIONS: readonly INotificationEntry[] = [
  {
    id: 'private-rpc-recommendation',
    severity: NOTIFICATION_SEVERITY.Info,
    title: 'Public nodes can see your requests',
    body:
      'By default the wallet talks to public RPC nodes. Their operators see your ' +
      'IP address and every address you look up, which is enough to tie a person to a portfolio. ' +
      'Set your own node in Settings.',
    publishedAt: '2026-07-31T00:00:00.000Z',
    expiresAt: null,
  },
  {
    id: 'seed-phrase-never-requested',
    severity: NOTIFICATION_SEVERITY.Warning,
    title: 'Nobody asks for the seed phrase',
    body:
      'Wallet support, any website, and this notice will never ask you to enter a seed ' +
      'phrase or a private key anywhere except the wallet itself. ' +
      'Any such request is an attempt to steal funds.',
    publishedAt: '2026-07-31T00:00:00.000Z',
    expiresAt: null,
  },
]
