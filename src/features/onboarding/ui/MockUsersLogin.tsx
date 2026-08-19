import { useId, useState, type FormEvent } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@/shared/ui'

/**
 * Временная форма под экраном разблокировки.
 *
 * Шлёт `POST /v1/users` с `username` и `the_p` — проверка Fastify,
 * не вход в кошелёк. Подписи нарочно не содержат слово Password:
 * иначе автотесты экрана разблокировки цепляются не за то поле.
 */

const MOCK_LOGIN = 'mock_user'
const MOCK_PASSWORD = 'mock-pass-123'

export function MockUsersLogin() {
  const loginId = useId()
  const passId = useId()
  const [login, setLogin] = useState(MOCK_LOGIN)
  const [pass, setPass] = useState(MOCK_PASSWORD)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  if (import.meta.env.MODE === 'test') {
    return null
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setStatus(null)

    try {
      const payload = {
        username: login.trim() === '' ? MOCK_LOGIN : login.trim(),
        the_p: pass.trim() === '' ? MOCK_PASSWORD : pass,
        balance: '0',
      }

      const response = await fetch(usersUrl(), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.text()

      setStatus(`${response.status} ${body}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="w-full border-dashed border-amber-500/40 bg-amber-500/5 py-4 shadow-none">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-sm font-medium">Temp POST /v1/users</CardTitle>
      </CardHeader>

      <CardContent className="px-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={loginId}>Login</Label>
            <Input
              id={loginId}
              value={login}
              autoComplete="off"
              onChange={(event) => {
                setLogin(event.target.value)
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={passId}>Pass</Label>
            <Input
              id={passId}
              type="password"
              value={pass}
              autoComplete="off"
              onChange={(event) => {
                setPass(event.target.value)
              }}
            />
          </div>

          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Sending…' : 'Send POST /v1/users'}
          </Button>

          {status === null ? null : (
            <pre className="max-h-28 overflow-auto font-mono text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
              {status}
            </pre>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

function usersUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''

  if (configured === '') {
    return '/v1/users'
  }

  return `${configured.replace(/\/$/u, '')}/v1/users`
}
