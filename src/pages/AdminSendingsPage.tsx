import { Navigate } from 'react-router'

import { AdminSendingsList, useAdminSession } from '@/features/admin'

/** Живой список переводов кабинета. Только супер-администратор. */
export function AdminSendingsPage() {
  const { canWrite } = useAdminSession()

  if (!canWrite) {
    return <Navigate to="/admin" replace />
  }

  return <AdminSendingsList />
}
