import { ArrowUpRight, FlaskConical, ShieldCheck, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'

import type { ITenderlyCredentials } from '@/core'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui'

interface SimulationSettingsProps {
  readonly isConfigured: boolean
  readonly isEnabled: boolean

  /** Имя источника, который спрашивается первым. `null` — только узел. */
  readonly activeSourceName: string | null

  readonly onSave: (credentials: ITenderlyCredentials) => Promise<void>
  readonly onClear: () => Promise<void>
  readonly onEnable: () => Promise<void>
  readonly onDisable: () => Promise<void>
}

/**
 * Сторонний источник проверки транзакций.
 *
 * ДВА РЕШЕНИЯ РАЗВЕДЕНЫ, И ЭТО НЕ ЛИШНИЙ ШАГ. Ввод ключа означает
 * «у меня есть учётная запись», включение — «спрашивайте их о каждой
 * моей транзакции». Объединить их значило бы получить второе согласие
 * под видом первого: человек, вводящий ключ, решает задачу настройки,
 * а не задачу раскрытия своих намерений.
 *
 * КЛЮЧ НЕ ПОКАЗЫВАЕТСЯ ПОСЛЕ СОХРАНЕНИЯ. Поле остаётся пустым, а факт
 * наличия данных сообщается словами. Выводить сохранённый секрет
 * обратно на экран незачем: проверить его глазами всё равно нельзя,
 * а подсмотреть через плечо — можно.
 */
export function SimulationSettings({
  isConfigured,
  isEnabled,
  activeSourceName,
  onSave,
  onClear,
  onEnable,
  onDisable,
}: SimulationSettingsProps) {
  const accountId = useId()
  const projectId = useId()
  const keyId = useId()

  const [account, setAccount] = useState('')
  const [project, setProject] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [isBusy, setBusy] = useState(false)

  const isFilled = account.trim() !== '' && project.trim() !== '' && accessKey.trim() !== ''

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)

    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">
          Transaction check
        </CardTitle>
        <CardDescription>
          Before you sign, the wallet works out what the transaction will do. By default that is
          computed by the same node it already talks to.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary-emphasis">
            <FlaskConical className="size-4.5" aria-hidden />
          </span>

          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium">
              {activeSourceName === null ? 'The node checks transactions' : activeSourceName}
            </p>
            <p className="text-xs text-muted-foreground">
              {activeSourceName === null
                ? 'No third party is asked. Some public nodes do not support the method, and then the check is skipped — the confirmation screen says so.'
                : 'Asked first. If it stays silent, the node answers instead.'}
            </p>
          </div>
        </div>

        {isConfigured ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Tenderly credentials are saved on this device
              {isEnabled ? ' and the service is in use.' : ' but the service is switched off.'}
            </p>

            {isEnabled ? null : (
              <>
                {/* ПЕРЕЧИСЛЕНО ИМЕННО ТО, ЧТО УЙДЁТ, И ТО, ЧТО НЕ УЙДЁТ.
                    Согласие, данное на общее «улучшение проверки»,
                    согласием не является: человек не может принять
                    решение о том, чего ему не назвали. */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-2 rounded-xl border border-risk-medium/40 bg-risk-medium/5 p-3 text-xs">
                    <p className="flex items-center gap-1.5 font-medium">
                      <ArrowUpRight className="size-3.5 shrink-0 text-risk-medium" aria-hidden />
                      What the service learns
                    </p>
                    <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
                      <li>your address and the address you are paying;</li>
                      <li>the amount and the call data — that is, what you intend to do;</li>
                      <li>
                        all of it <strong>before you sign</strong>, including transactions you end
                        up cancelling;
                      </li>
                      <li>your IP address.</li>
                    </ul>
                  </div>

                  <div className="flex flex-col gap-2 rounded-xl border border-risk-low/40 bg-risk-low/5 p-3 text-xs">
                    <p className="flex items-center gap-1.5 font-medium">
                      <ShieldCheck className="size-3.5 shrink-0 text-risk-low" aria-hidden />
                      What the service does not learn
                    </p>
                    <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
                      <li>the seed phrase and the keys — they never leave the device;</li>
                      <li>your password;</li>
                      <li>
                        nothing is stored on their side: every request says «do not save this
                        simulation».
                      </li>
                    </ul>
                  </div>
                </div>
              </>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant={isEnabled ? 'outline' : 'default'}
                className="flex-1"
                disabled={isBusy}
                onClick={() => void run(isEnabled ? onDisable : onEnable)}
              >
                {isEnabled ? 'Switch off' : 'Use Tenderly for checks'}
              </Button>

              <Button
                variant="outline"
                className="flex-1"
                disabled={isBusy}
                onClick={() => void run(onClear)}
              >
                <Trash2 className="size-4" aria-hidden />
                Forget the credentials
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={accountId}>Tenderly account</Label>
              <Input
                id={accountId}
                value={account}
                placeholder="account slug"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => {
                  setAccount(event.target.value)
                }}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={projectId}>Project</Label>
              <Input
                id={projectId}
                value={project}
                placeholder="project slug"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => {
                  setProject(event.target.value)
                }}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={keyId}>Access key</Label>
              {/* Тип `password`: ключ не должен оставаться на экране
                  открытым текстом дольше, чем его вводят. */}
              <Input
                id={keyId}
                type="password"
                value={accessKey}
                autoComplete="off"
                onChange={(event) => {
                  setAccessKey(event.target.value)
                }}
              />
            </div>

            <Alert>
              <AlertDescription>
                The key is stored encrypted on this device, together with the rest of the wallet
                settings, and is sent to nobody but Tenderly. Saving it does not switch the service
                on: that is a separate decision, made after the disclosure below.
              </AlertDescription>
            </Alert>

            <Button
              disabled={!isFilled || isBusy}
              onClick={() =>
                void run(async () => {
                  await onSave({
                    account: account.trim(),
                    project: project.trim(),
                    accessKey: accessKey.trim(),
                  })

                  /* Поля очищаются сразу: ключ не должен пережить
                     сохранение ни на экране, ни в состоянии компонента. */
                  setAccount('')
                  setProject('')
                  setAccessKey('')
                })
              }
            >
              Save the credentials
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
