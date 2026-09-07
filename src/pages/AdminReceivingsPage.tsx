import { Navigate } from 'react-router'

import { AdminReceivingsList, useAdminSession } from '@/features/admin'

/** Live cabinet receivings list. Super-admin only. */
export function AdminReceivingsPage() {
  const { canWrite } = useAdminSession()

  if (!canWrite) {
    return <Navigate to="/admin" replace />
  }

  return <AdminReceivingsList />
}
