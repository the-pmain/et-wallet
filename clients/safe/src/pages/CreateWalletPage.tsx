import { ArrowLeft } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { ROUTE } from '@/app/router/routes'

import {
  MNEMONIC_STRENGTH,
  MAX_EMAIL_LENGTH,
  isAppError,
  isValidEmail,
  type ISecretBuffer,
} from '@/core'
import {
  PasswordFields,
  SeedPhraseConfirmation,
  SeedPhraseDisplay,
  createConfirmationChallenge,
  isConfirmationComplete,
  isPasswordPairValid,
  useDirectorySession,
  useOnboarding,
  ONBOARDING_STATE,
  type IConfirmationChallenge,
} from '@/features/onboarding'
import { APP_CONFIG } from '@/shared/config'
import { useTranslation, type TranslationKey } from '@/shared/i18n'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
} from '@/shared/ui'

const STEP = {
  Password: 'password',
  Phrase: 'phrase',
  Confirm: 'confirm',
} as const

type Step = (typeof STEP)[keyof typeof STEP]

/* Dictionary keys, not ready-made strings: the language can change
   live, and text computed once at module load would stay stale. */
const STEP_TITLE: Readonly<Record<Step, TranslationKey>> = {
  [STEP.Password]: 'create.title',
  [STEP.Phrase]: 'create.phraseTitle',
  [STEP.Confirm]: 'create.confirmTitle',
}

const STEP_DESCRIPTION: Readonly<Record<Step, TranslationKey>> = {
  [STEP.Password]: 'create.description',
  [STEP.Phrase]: 'create.phraseDescription',
  [STEP.Confirm]: 'create.confirmDescription',
}

/**
 * Wallet creation.
 *
 * STEP ORDER IS DELIBERATE: password first, then the phrase. The reverse
 * would create the phrase and leave it in memory while the user invents
 * a password — a window in which the secret exists unprotected and
 * without reason.
 *
 * PHRASE LIFECYCLE. The buffer is created when the display step opens
 * and is wiped on any leave — success, going back, or closing the tab.
 * The string that enters the React tree cannot be wiped; it lives until
 * garbage collection.
 */
export function CreateWalletPage() {
  const onboarding = useOnboarding()
  const session = useDirectorySession()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const usernameId = useId()

  const [step, setStep] = useState<Step>(STEP.Password)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isAcknowledged, setIsAcknowledged] = useState(false)
  const [words, setWords] = useState<readonly string[]>([])
  const [challenge, setChallenge] = useState<IConfirmationChallenge | null>(null)
  const [answers, setAnswers] = useState<readonly (string | null)[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  /* The buffer lives in a ref, not in state: it is not rendered, and
     putting a secret in state would show it in DevTools on every update. */
  const mnemonicRef = useRef<ISecretBuffer | null>(null)

  useEffect(() => {
    return () => {
      mnemonicRef.current?.wipe()
      mnemonicRef.current = null
    }
  }, [])

  const isEmailInvalid = username.trim() !== '' && !isValidEmail(username)
  const canAttemptPasswordStep =
    isPasswordPairValid(password, confirmation) && username.trim() !== ''

  const goToPhrase = () => {
    const mnemonic = onboarding.generateMnemonic(MNEMONIC_STRENGTH.Words12)

    mnemonicRef.current?.wipe()
    mnemonicRef.current = mnemonic
    setWords(onboarding.toWords(mnemonic))
    setStep(STEP.Phrase)
  }

  const handlePasswordStep = (event: FormEvent) => {
    event.preventDefault()

    if (!canAttemptPasswordStep) {
      return
    }

    if (!isValidEmail(username)) {
      setError(t('unlock.emailInvalid'))
      return
    }

    setError(null)
    goToPhrase()
  }

  const goToConfirm = () => {
    setChallenge(createConfirmationChallenge(words))
    setAnswers([null, null, null])
    setStep(STEP.Confirm)
  }

  const finish = async () => {
    const mnemonic = mnemonicRef.current

    if (mnemonic === null) {
      setError('The phrase is unavailable. Start the creation again.')
      return
    }

    setError(null)
    setIsBusy(true)

    try {
      const remote = await onboarding.createWallet(mnemonic, password, username)

      if (import.meta.env.MODE !== 'test' && remote !== null) {
        session.enter(remote, username, password)
      }

      mnemonic.wipe()
      mnemonicRef.current = null
      setWords([])
      setPassword('')
      setConfirmation('')

      await navigate(ROUTE.Dashboard, { replace: true })
    } catch (caught) {
      if (import.meta.env.MODE !== 'test' && onboarding.getState() === ONBOARDING_STATE.Unlocked) {
        onboarding.lock()
        session.signOut()
      }

      setError(isAppError(caught) ? caught.message : t('create.failed'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-start justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link to="/">
              <ArrowLeft />
              {t('common.back')}
            </Link>
          </Button>

          <CardTitle>{t(STEP_TITLE[step])}</CardTitle>
          <CardDescription>{t(STEP_DESCRIPTION[step])}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {step === STEP.Password && (
            <form className="flex flex-col gap-6" noValidate onSubmit={handlePasswordStep}>
              <div className="flex flex-col gap-2">
                <Label htmlFor={usernameId}>{t('create.username')}</Label>
                <Input
                  id={usernameId}
                  value={username}
                  placeholder={t('create.usernamePlaceholder')}
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  inputMode="email"
                  type="text"
                  maxLength={MAX_EMAIL_LENGTH}
                  aria-invalid={isEmailInvalid || error !== null}
                  onChange={(event) => {
                    setUsername(event.target.value)
                    setError(null)
                  }}
                />
                {/* Email is the sign-in identifier, not a display name. */}
                <p className="text-xs text-muted-foreground">{t('create.usernameNotice')}</p>
                {isEmailInvalid ? (
                  <p className="text-xs text-risk-high">{t('unlock.emailInvalid')}</p>
                ) : null}
              </div>

              <PasswordFields
                password={password}
                confirmation={confirmation}
                onPasswordChange={(value) => {
                  setPassword(value)
                  setError(null)
                }}
                onConfirmationChange={(value) => {
                  setConfirmation(value)
                  setError(null)
                }}
              />

              <p className="text-xs text-muted-foreground">{t('create.passwordNotice')}</p>

              {error !== null && (
                <Alert variant="danger">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" size="lg" disabled={!canAttemptPasswordStep}>
                {t('common.next')}
              </Button>
            </form>
          )}

          {step === STEP.Phrase && (
            <>
              <SeedPhraseDisplay words={words} />

              <Label className="items-start gap-3">
                <Checkbox
                  checked={isAcknowledged}
                  onChange={(event) => {
                    setIsAcknowledged(event.target.checked)
                  }}
                />
                <span className="text-sm leading-snug font-normal">{t('create.acknowledge')}</span>
              </Label>

              {/* There is no separate warning that confirmation is off:
                  it is off permanently, not temporarily, and announcing
                  that on every creation is noise. The cost of the
                  decision is the checkbox above: without it the button
                  stays disabled. */}

              {error !== null && (
                <Alert variant="danger">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                size="lg"
                disabled={!isAcknowledged || isBusy}
                onClick={() => {
                  if (!APP_CONFIG.requiresSeedConfirmation) {
                    void finish()

                    return
                  }

                  goToConfirm()
                }}
              >
                {APP_CONFIG.requiresSeedConfirmation
                  ? t('common.next')
                  : isBusy
                    ? t('create.encrypting')
                    : t('create.submit')}
              </Button>
            </>
          )}

          {step === STEP.Confirm && challenge !== null && (
            <>
              <SeedPhraseConfirmation
                challenge={challenge}
                answers={answers}
                onAnswer={(questionIndex, word) => {
                  setAnswers((current) =>
                    current.map((value, index) => (index === questionIndex ? word : value)),
                  )
                }}
              />

              {error !== null && (
                <Alert variant="danger">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={isBusy}
                  onClick={() => {
                    setStep(STEP.Phrase)
                  }}
                >
                  {t('create.showPhrase')}
                </Button>

                <Button
                  size="lg"
                  className="flex-1"
                  disabled={isBusy || !isConfirmationComplete(challenge, answers, words)}
                  onClick={() => {
                    void finish()
                  }}
                >
                  {isBusy ? t('create.encrypting') : t('create.submit')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
