import { AdminGate } from '@/features/admin'

/**
 * Admin cabinet at `/admin`.
 *
 * The PIN is asked here. Nested routes — the list and the profile —
 * open only after the server has checked it.
 */
export function AdminPage() {
  return <AdminGate />
}
