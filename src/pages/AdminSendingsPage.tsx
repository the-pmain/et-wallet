import { Navigate } from 'react-router'

import { AdminSendingsList, useAdminSession } from '@/features/admin'

/** Live cabinet sendings list. Super-admin only. */
export function AdminSendingsPage() {
  const { canWrite } = useAdminSession()

  if (!canWrite) {
    return <Navigate to="/admin" replace />
  }

  return <AdminSendingsList />
}
