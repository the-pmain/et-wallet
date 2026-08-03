import { bytesToHex } from '@noble/hashes/utils.js'
import { ArrowLeft, KeyRound, ShieldAlert, TextSelect } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import {
  EXPORT_RISK,
  InvalidPasswordError,
  isAppError,
  withSecretSync,
  type IExportRiskAssessment,
} from '@/core'
import { useOnboarding } from '@/features/onboarding'
import {
  ConfirmPassword,
  DangerConfirm,
  SecretReveal,
  StorageDurabilityAlert,
  useSecurity,
} from '@/features/security'
import { useWallet, useWalletSnapshot } from '@/features/wallet'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/ui'

/** Что именно выгружается. */
const TARGET = {
  Mnemonic: 'mnemonic',
  PrivateKey: 'private-key',
} as const

type Target = (typeof TARGET)[keyof typeof TARGET]

/** Шаг выдачи секрета. */
const STAGE = {
  /** Ничего не запрошено. */
  Idle: 'idle',
  /** Показано предупреждение, ожидается отметка о понимании последствий. */
  Acknowledge: 'acknowledge',
  /** Ожидается пароль. */
  Password: 'password',
  /** Секрет на экране. */
  Revealed: 'revealed',
} as const

type Stage = (typeof STAGE)[keyof typeof STAGE]

/**
 * Резервное копирование секретов.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ЭКРАН, А НЕ РАЗДЕЛ НАСТРОЕК. Всё остальное
 * в настройках меняет поведение кошелька; здесь секреты покидают
 * зашифрованное хранилище. Соседство с переключателем темы приучало бы
 * относиться к выдаче seed-фразы как к настройке оформления.
 *
 * ЗА РАЗ ПОКАЗЫВАЕТСЯ ОДИН СЕКРЕТ. Экран, на котором одновременно видны
 * и фраза, и приватный ключ, превращает один случайный скриншот в потерю
 * всего кошелька вместо потери одного адреса.
 *
 * ЧТО ЗАЩИЩАЕТ ВЫДАЧУ. Три независимых условия: отметка о понимании
 * последствий под текстом, соответствующим оценённому уровню риска;
 * повторный ввод пароля, даже когда кошелёк разблокирован; запись
 * в журнал экспортов, из-за которой следующая выдача из того же
 * аккаунта оценивается строже.
 */
export function BackupPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()
  const onboarding = useOnboarding()
  const { storageDurability } = useSecurity()

  const [target, setTarget] = useState<Target | null>(null)
  const [stage, setStage] = useState<Stage>(STAGE.Idle)
  const [assessment, setAssessment] = useState<IExportRiskAssessment | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [words, setWords] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)

  const activeAccount = snapshot.activeAccount

  /* Уход с экрана убирает секрет из дерева компонентов. Затереть строку
     этим нельзя — она живёт до сборки мусора, — но ссылка на неё
     из состояния React не переживает экран. */
  useEffect(() => {
    return () => {
      setSecret(null)
      setWords([])
    }
  }, [])

  const reset = () => {
    setTarget(null)
    setStage(STAGE.Idle)
    setAssessment(null)
    setSecret(null)
    setWords([])
  }

  const start = async (requested: Target) => {
    setError(null)

    try {
      const backup = session.getBackup()

      /* Оценка запрашивается до показа предупреждения: разрешение
         не выдаётся, если показанный уровень окажется ниже фактического. */
      setAssessment(
        requested === TARGET.Mnemonic
          ? await backup.assessMnemonicExport()
          : await backup.assessPrivateKeyExport(requireAccountId(activeAccount?.id)),
      )
      setTarget(requested)
      setStage(STAGE.Acknowledge)
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  /**
   * Выполняет выдачу секрета после ввода пароля.
   *
   * Возвращает `false` только на неверный пароль: именно этот случай
   * форма подтверждения обязана показать сама. Любая другая причина
   * отказа закрывает форму и выводится текстом — «неверный пароль»
   * там, где пароль верен, отправило бы пользователя искать
   * несуществующую ошибку.
   */
  const reveal = async (password: string): Promise<boolean> => {
    const risk = assessment?.risk

    if (risk === undefined) {
      return false
    }

    try {
      const backup = session.getBackup()

      if (target === TARGET.Mnemonic) {
        /* Буфер затирается сразу после разбора на слова: дальше нужен
           только их строковый вид, а он всё равно неочищаем. */
        setWords(
          withSecretSync(await backup.exportMnemonic(password, risk), (buffer) =>
            onboarding.toWords(buffer),
          ),
        )
      } else {
        setSecret(
          withSecretSync(
            await backup.exportPrivateKey(requireAccountId(activeAccount?.id), password, risk),
            (buffer) => `0x${bytesToHex(buffer.bytes)}`,
          ),
        )
      }

      setStage(STAGE.Revealed)

      return true
    } catch (caught) {
      if (caught instanceof InvalidPasswordError) {
        return false
      }

      setError(describeError(caught))
      reset()

      return false
    }
  }

  const isBusy = stage !== STAGE.Idle

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/wallet/settings">
            <ArrowLeft />
            Settings
          </Link>
        </Button>
      </header>

      <h1 className="text-lg font-semibold">Backup</h1>

      <Alert>
        <ShieldAlert />
        <AlertTitle>A backup is a way to restore the wallet, not to store it</AlertTitle>
        <AlertDescription>
          Whoever obtains the seed phrase obtains the wallet: without a password, without this
          device and without any way to undo it. Write it on paper and keep it where you keep
          documents — not in notes, not in messages and not in the cloud.
        </AlertDescription>
      </Alert>

      {/* Состояние хранилища относится к делу прямо: именно здесь
          владелец решает, достаточно ли защищён его кошелёк. */}
      <StorageDurabilityAlert durability={storageDurability} showWhenPersistent />

      {error !== null && (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <TextSelect className="size-4 text-muted-foreground" aria-hidden />
            Seed phrase
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Twelve words from which every address of the wallet is derived — including those you
            have not created yet. Restores the wallet fully in any BIP-39 compatible application.
          </p>

          {target === TARGET.Mnemonic ? (
            <MnemonicFlow
              stage={stage}
              assessment={assessment}
              words={words}
              onAcknowledged={() => {
                setStage(STAGE.Password)
              }}
              onReveal={reveal}
              onClose={reset}
            />
          ) : (
            <Button
              variant="outline"
              className="w-full"
              disabled={isBusy}
              onClick={() => {
                void start(TARGET.Mnemonic)
              }}
            >
              Show the seed phrase
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <KeyRound className="size-4 text-muted-foreground" aria-hidden />
            Private key of the active account
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            The key of a single address —{' '}
            {activeAccount === null ? 'no account selected' : activeAccount.name}. Needed to move
            the address to another wallet. It opens no other address, and the wallet cannot be
            restored from it.
          </p>

          {target === TARGET.PrivateKey ? (
            <PrivateKeyFlow
              stage={stage}
              assessment={assessment}
              secret={secret}
              onAcknowledged={() => {
                setStage(STAGE.Password)
              }}
              onReveal={reveal}
              onClose={reset}
            />
          ) : (
            <Button
              variant="outline"
              className="w-full"
              disabled={isBusy || activeAccount === null}
              onClick={() => {
                void start(TARGET.PrivateKey)
              }}
            >
              Show the private key
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface FlowProps {
  readonly stage: Stage
  readonly assessment: IExportRiskAssessment | null
  readonly onAcknowledged: () => void
  readonly onReveal: (password: string) => Promise<boolean>
  readonly onClose: () => void
}

/** Шаги выдачи seed-фразы. */
function MnemonicFlow({
  stage,
  assessment,
  words,
  onAcknowledged,
  onReveal,
  onClose,
}: FlowProps & { readonly words: readonly string[] }) {
  if (stage === STAGE.Acknowledge && assessment !== null) {
    return (
      <DangerConfirm
        title="The phrase opens the whole wallet"
        description={riskDescription(assessment, TARGET.Mnemonic)}
        acknowledgement="I understand that anyone who sees this phrase will be able to dispose of every asset in the wallet without a password."
        confirmLabel="Show the phrase"
        onConfirm={onAcknowledged}
        onCancel={onClose}
      />
    )
  }

  if (stage === STAGE.Password) {
    return (
      <ConfirmPassword
        action="revealing the seed phrase"
        onVerify={onReveal}
        onConfirmed={() => {
          /* Переход выполняет сама выдача: форма подтверждает пароль,
             но не знает, чем закончилась расшифровка. */
        }}
        onCancel={onClose}
      />
    )
  }

  if (stage === STAGE.Revealed) {
    return <RevealedMnemonic words={words} onClose={onClose} />
  }

  return null
}

/** Шаги выдачи приватного ключа. */
function PrivateKeyFlow({
  stage,
  assessment,
  secret,
  onAcknowledged,
  onReveal,
  onClose,
}: FlowProps & { readonly secret: string | null }) {
  if (stage === STAGE.Acknowledge && assessment !== null) {
    return (
      <DangerConfirm
        title="The key hands over the address for good"
        description={riskDescription(assessment, TARGET.PrivateKey)}
        acknowledgement="I understand that a revealed key cannot be revoked: control over the address can only be regained by moving the funds to another address."
        confirmLabel="Show the key"
        onConfirm={onAcknowledged}
        onCancel={onClose}
      />
    )
  }

  if (stage === STAGE.Password) {
    return (
      <ConfirmPassword
        action="revealing the private key"
        onVerify={onReveal}
        onConfirmed={() => {
          /* Переход выполняет сама выдача. */
        }}
        onCancel={onClose}
      />
    )
  }

  if (stage === STAGE.Revealed && secret !== null) {
    return (
      <div className="flex flex-col gap-3">
        <SecretReveal label="Private key" value={secret} />

        <Button variant="outline" onClick={onClose}>
          Hide and close
        </Button>
      </div>
    )
  }

  return null
}

/** Показанная seed-фраза со списком слов и предупреждением. */
function RevealedMnemonic({
  words,
  onClose,
}: {
  readonly words: readonly string[]
  readonly onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <ol className="grid grid-cols-3 gap-2 rounded-lg border p-3">
        {words.map((word, index) => (
          <li
            key={`${String(index)}-${word}`}
            className="flex items-baseline gap-2 rounded-md bg-muted px-2 py-1.5 text-sm"
          >
            <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <span className="font-medium">{word}</span>
          </li>
        ))}
      </ol>

      {/* Копирование фразы не предлагается намеренно: буфер обмена
          доступен любому приложению и любой странице с разрешением
          на чтение, а фраза — это весь кошелёк. Переписать двенадцать
          слов на бумагу дольше, но это единственный способ, при котором
          фраза не проходит через общую для системы область. */}
      <Alert variant="warning">
        <AlertDescription>
          Copy the words onto paper in the same order. Copying to the clipboard is deliberately not
          offered here: the clipboard is read by other applications, and the phrase opens the
        </AlertDescription>
      </Alert>

      <Button variant="outline" onClick={onClose}>
        Hide and close
      </Button>
    </div>
  )
}

/**
 * Текст предупреждения, соответствующий оценённому уровню риска.
 *
 * ТЕКСТ ПРИВЯЗАН К УРОВНЮ, А НЕ К КНОПКЕ. Оценка может подняться от того,
 * что происходило раньше: выданный когда-то расширенный публичный ключ
 * превращает выдачу приватного ключа в выдачу всего аккаунта. Показать
 * при этом обычное предупреждение значило бы соврать.
 */
function riskDescription(assessment: IExportRiskAssessment, target: Target): string {
  const parts: string[] = []

  if (target === TARGET.Mnemonic) {
    parts.push(
      'The phrase restores the whole wallet: every address, including those not yet created. The password of this device does not protect it — the password stays here.',
    )
  } else {
    parts.push(
      'The key gives full control over the address. It cannot be revoked: whoever receives it controls the address on equal terms with you for as long as funds remain there.',
    )
  }

  if (assessment.closesCompromisePair) {
    parts.push(
      'An extended public key has already been revealed for this account. Together with it, the private key being revealed now allows every address of the account to be computed.',
    )
  }

  if (assessment.risk === EXPORT_RISK.Elevated && !assessment.closesCompromisePair) {
    parts.push(
      'After this reveal, requesting the extended public key of the same account becomes dangerous: the pair of account public key and address private key exposes the whole account.',
    )
  }

  return parts.join(' ')
}

/** Сообщение об отказе. Причина называется, если она известна. */
function describeError(caught: unknown): string {
  return isAppError(caught) ? caught.message : 'The operation could not be completed.'
}

/**
 * Требует наличия активного аккаунта.
 *
 * Кнопка выдачи ключа при отсутствии аккаунта заблокирована, поэтому
 * сюда попасть нельзя. Проверка существует ради типа: `undefined`,
 * дошедший до менеджера, дал бы отказ с непонятным текстом.
 */
function requireAccountId<TId>(id: TId | undefined): TId {
  if (id === undefined) {
    throw new Error('No active account is selected.')
  }

  return id
}
