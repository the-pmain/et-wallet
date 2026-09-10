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
  VerifyBackupCard,
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

const TARGET = {
  Mnemonic: 'mnemonic',
  PrivateKey: 'private-key',
} as const

type Target = (typeof TARGET)[keyof typeof TARGET]

const STAGE = {
  Idle: 'idle',
  Acknowledge: 'acknowledge',
  Password: 'password',
  Revealed: 'revealed',
} as const

type Stage = (typeof STAGE)[keyof typeof STAGE]

/**
 * Backup of secrets.
 *
 * WHY A SEPARATE SCREEN, NOT A SETTINGS SECTION. Everything else in
 * settings changes wallet behavior; here secrets leave encrypted
 * storage. Sitting next to the theme switch would train people to
 * treat revealing a seed phrase like a look-and-feel setting.
 *
 * ONE SECRET IS SHOWN AT A TIME. A screen that shows both the phrase
 * and a private key turns one accidental screenshot into the loss of
 * the whole wallet instead of one address.
 *
 * WHAT GUARDS THE REVEAL. Three independent conditions: a
 * consequence-acknowledgement under copy that matches the assessed
 * risk; a password again even when the wallet is unlocked; an export
 * log entry that makes the next reveal from the same account stricter.
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

  /* Leaving the screen drops the secret from the component tree. That
     cannot wipe the string — it lives until GC — but the React-state
     reference does not outlive the screen. */
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

      /* Risk is assessed before the warning is shown: a permit is not
         issued if the shown level would be below the real one. */
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
   * Reveals the secret after the password is entered.
   *
   * Returns `false` only for a wrong password: that case the confirm
   * form must show itself. Any other refusal closes the form and is
   * shown as text — "wrong password" where the password is right would
   * send the user hunting a mistake that is not there.
   */
  const reveal = async (password: string): Promise<boolean> => {
    const risk = assessment?.risk

    if (risk === undefined) {
      return false
    }

    try {
      const backup = session.getBackup()

      if (target === TARGET.Mnemonic) {
        /* The buffer is wiped right after it is split into words: only
           the string form is needed after that, and it cannot be wiped
           anyway. */
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
      {/* Back and the title share one row, as on the other nested
          screens. The button used to sit on its own row above the
          title: two rows instead of one, and a different look for
          the same place on neighboring screens. */}
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="-ml-1" aria-label="Back to settings">
          <Link to="/wallet/settings">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Backup</h1>
      </header>

      <Alert>
        <ShieldAlert />
        <AlertTitle>A backup is a way to restore the wallet, not to store it</AlertTitle>
        <AlertDescription>
          Whoever obtains the seed phrase obtains the wallet: without a password, without this
          device and without any way to undo it. Write it on paper and keep it where you keep
          documents — not in notes, not in messages and not in the cloud.
        </AlertDescription>
      </Alert>

      {/* Storage durability belongs here: this is where the owner
          decides whether the wallet is protected enough. */}
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

      {/* Copy check sits RIGHT AFTER THE PHRASE and before the private
          key: it belongs to the same secret and is done by the same
          person in the same sitting — write it down, then check. */}
      <VerifyBackupCard
        onVerify={(phrase, password) => session.getBackup().verifyMnemonicBackup(phrase, password)}
      />

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
          /* The reveal itself advances the stage: the form confirms
             the password but does not know how decryption ended. */
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
          /* The reveal itself advances the stage. */
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

      {/* Copying the phrase is deliberately not offered: the clipboard
          is readable by any app and any page with read permission, and
          the phrase is the whole wallet. Writing twelve words on paper
          takes longer, but it is the only path that never puts the
          phrase through a system-wide buffer. */}
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
 * Warning copy that matches the assessed risk level.
 *
 * THE TEXT IS BOUND TO THE LEVEL, NOT TO THE BUTTON. The assessment
 * can rise because of what happened earlier: an extended public key
 * revealed once turns a private-key reveal into a reveal of the whole
 * account. Showing the ordinary warning then would be a lie.
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

/** Refusal message. The reason is named when it is known. */
function describeError(caught: unknown): string {
  return isAppError(caught) ? caught.message : 'The operation could not be completed.'
}

/**
 * Requires an active account.
 *
 * The key-reveal button is disabled when there is no account, so this
 * path cannot be reached. The check exists for the type: `undefined`
 * reaching the manager would refuse with an opaque message.
 */
function requireAccountId<TId>(id: TId | undefined): TId {
  if (id === undefined) {
    throw new Error('No active account is selected.')
  }

  return id
}
