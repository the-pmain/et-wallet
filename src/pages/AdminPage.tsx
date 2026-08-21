import { AdminGate } from '@/features/admin'

/**
 * Кабинет администратора: `#/admin`.
 *
 * PIN спрашивается здесь. Вложенные маршруты — список и профиль —
 * открываются только после сверки с сервером.
 */
export function AdminPage() {
  return <AdminGate />
}
