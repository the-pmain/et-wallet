import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { isAppError } from '@/core'
import { useDirectorySession, useOnboarding } from '@/features/onboarding'
import {
  Alert,
  AlertDescription,
  AlertTitle,
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

const CONFIRMATION_WORD = 'ERASE'

/**
 * The "Forgot password" screen.
 *
 * THE TITLE MISLEADS, and the first thing this page does is undo that.
 *
 * A non-custodial wallet has no recovery password. It is never sent
 * anywhere and never stored: the encryption key is derived from it, and
 * without the password nobody can open the vault, developers included.
 *
 * The only path is to erase the wallet from the device and recreate it
 * from the seed phrase. A user without a written phrase loses the funds
 * for good, and the page must say so plainly, not hide it in small type
 * under the button.
 *
 * WHY TWO CONFIRMATIONS. The checkbox stops an accidental click; typing
 * the word stops ticking boxes without reading. The operation is
 * irreversible and does not ask for a password (that is the point), so
 * the only protection against a mistake is to force a pause.
 */
export function ForgotPasswordPage() {
  const onboarding = useOnboarding()
  const directory = useDirectorySession()
  const navigate = useNavigate()

  const [hasPhrase, setHasPhrase] = useState(false)
  const [typedWord, setTypedWord] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const canReset = hasPhrase && typedWord.trim().toUpperCase() === CONFIRMATION_WORD && !isBusy

  const handleReset = async () => {
    setError(null)
    setIsBusy(true)

    try {
      await onboarding.reset()
      directory.signOut()
      await navigate('/')
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : 'The wallet could not be erased')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-start justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link to="/unlock">
              <ArrowLeft />
              Back
            </Link>
          </Button>

          <CardTitle>Erase the wallet from this device</CardTitle>
          <CardDescription>
            The only path both to a forgotten password and to another wallet on this device
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <Alert variant="danger">
            <TriangleAlert />
            <AlertTitle>The reset destroys the data on this device</AlertTitle>
            <AlertDescription>
              The wallet can then be restored only from a seed phrase of 12 or 24 words. If the
              phrase is not written down, the funds are lost for good — neither we nor anyone else
              will be able to return them.
            </AlertDescription>
          </Alert>

          {/* THE SCREEN ANSWERS TWO DIFFERENT QUESTIONS, and both must
              be named. It used to talk only about a forgotten password,
              so someone who remembered the password but wanted another
              wallet did not know they were in the right place. */}
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Why people come here</p>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">A forgotten password.</span> It cannot
                be restored: it is never sent anywhere and never stored, and the encryption key is
                derived from it. Without the password nobody can open the storage, developers
                included.
              </li>
              <li>
                <span className="font-medium text-foreground">Another wallet is needed.</span> A
                device holds one wallet. Creating a new one or restoring a different seed phrase is
                possible only in place of the current one — hence the same path.
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">How it works</p>
            <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>1. The wallet is erased from this device together with the encrypted keys.</li>
              <li>
                2. You create a new wallet or enter a seed phrase — your previous one or another.
              </li>
              <li>3. You choose a new password. Every account is restored from the phrase.</li>
            </ol>
          </div>

          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <Label className="items-start gap-3">
              <Checkbox
                checked={hasPhrase}
                disabled={isBusy}
                onChange={(event) => {
                  setHasPhrase(event.target.checked)
                }}
              />
              <span className="text-sm leading-snug font-normal">
                I have the seed phrase written down and understand that without it access to the
                funds will be lost
              </span>
            </Label>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmation-word">
                Type the word {CONFIRMATION_WORD} to confirm
              </Label>
              <Input
                id="confirmation-word"
                value={typedWord}
                disabled={!hasPhrase || isBusy}
                autoComplete="off"
                autoCapitalize="characters"
                onChange={(event) => {
                  setTypedWord(event.target.value)
                }}
              />
            </div>
          </div>

          {error !== null && (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-3">
            <Button asChild variant="outline" className="flex-1">
              <Link to="/unlock">Go back</Link>
            </Button>

            <Button
              variant="destructive"
              className="flex-1"
              disabled={!canReset}
              onClick={() => {
                void handleReset()
              }}
            >
              {isBusy ? 'Erasing…' : 'Erase the wallet'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
