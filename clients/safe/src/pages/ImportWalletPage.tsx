import { ArrowLeft } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { ROUTE } from '@/app/router/routes'

import { MAX_EMAIL_LENGTH, isAppError, isValidEmail } from '@/core'
import {
  ONBOARDING_STATE,
  PasswordFields,
  SeedPhraseInput,
  isPasswordPairValid,
  useDirectorySession,
  useOnboarding,
} from '@/features/onboarding'
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

/**
 * Import of an existing wallet.
 *
 * Phrase and password are entered on one screen, not in steps: the user
 * already holds the phrase, and splitting the form would keep the secret
 * in an input longer than needed.
 *
 * Phrase validation runs as the user types, but the error appears only
 * after enough words are entered: highlighting "invalid" after the first
 * character trains people not to read messages.
 */
export function ImportWalletPage() {
  const onboarding = useOnboarding()
  const session = useDirectorySession()
  const navigate = useNavigate()

  const usernameId = useId()

  const [phrase, setPhrase] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  /* Validation runs on every keystroke: for 24 words that is a set
     build and a checksum. Memoizing on the string avoids repeating
     the work on redraws caused by other fields. */
  const validation = useMemo(() => onboarding.checkMnemonic(phrase), [onboarding, phrase])

  const isEmailInvalid = username.trim() !== '' && !isValidEmail(username)
  const canSubmit =
    validation.isValid &&
    isPasswordPairValid(password, confirmation) &&
    username.trim() !== '' &&
    !isBusy

  const handleImport = async () => {
    if (!isValidEmail(username)) {
      setError('Enter a valid email')
      return
    }

    setError(null)
    setIsBusy(true)

    try {
      const remote = await onboarding.importWallet(phrase, password, username)

      if (import.meta.env.MODE !== 'test' && remote !== null) {
        session.enter(remote, username, password)
      }

      setPhrase('')
      setPassword('')
      setConfirmation('')

      await navigate(ROUTE.Dashboard, { replace: true })
    } catch (caught) {
      if (import.meta.env.MODE !== 'test' && onboarding.getState() === ONBOARDING_STATE.Unlocked) {
        onboarding.lock()
        session.signOut()
      }

      setError(isAppError(caught) ? caught.message : 'The wallet could not be imported')
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
              Back
            </Link>
          </Button>

          <CardTitle>Import a wallet</CardTitle>
          <CardDescription>
            Enter a seed phrase of 12 or 24 words and choose a password for this device
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <SeedPhraseInput
            value={phrase}
            validation={validation}
            disabled={isBusy}
            onChange={(value) => {
              setPhrase(value)
              setError(null)
            }}
          />

          {/* A warning, not a refusal: importing a test phrase is
              ordinary developer work, and forbidding it would be a
              mistake. Anyone who took such a phrase from an article
              or example must still learn that before sending funds
              to its address. */}
          {validation.isGuessable && (
            <Alert variant="danger">
              <AlertDescription>
                This is a well-known test phrase: anyone can compute its private keys. Funds
                arriving at its addresses are swept by bots within seconds. Import it only to check
                that the wallet works.
              </AlertDescription>
            </Alert>
          )}

          <Alert variant="warning">
            <AlertDescription>
              Enter the phrase in this window only. No support agent and no website has the right to
              ask for it.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-2">
            <Label htmlFor={usernameId}>Email</Label>
            <Input
              id={usernameId}
              value={username}
              placeholder="name@example.com"
              disabled={isBusy}
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
            <p className="text-xs text-muted-foreground">
              Required. You will sign in with this email and the password you choose here.
            </p>
            {isEmailInvalid ? (
              <p className="text-xs text-risk-high">Enter a valid email</p>
            ) : null}
          </div>

          <PasswordFields
            password={password}
            confirmation={confirmation}
            disabled={isBusy}
            onPasswordChange={setPassword}
            onConfirmationChange={setConfirmation}
          />

          {error !== null && (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            size="lg"
            disabled={!canSubmit}
            onClick={() => {
              void handleImport()
            }}
          >
            {isBusy ? 'Encrypting…' : 'Import'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
