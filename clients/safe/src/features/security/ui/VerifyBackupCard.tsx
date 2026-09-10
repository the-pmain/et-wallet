import { CircleCheck, CircleX, ClipboardCheck } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { InvalidPasswordError } from '@/core'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui'

interface VerifyBackupCardProps {
  /**
   * Compare the entered phrase with the stored one.
   *
   * Returns one bit. Pointing at the differing word would help
   * more than the owner.
   */
  readonly onVerify: (phrase: string, password: string) => Promise<boolean>
}

type Verdict = 'match' | 'mismatch' | 'wrong-password' | 'failed'

/**
 * Check a written copy of the seed phrase.
 *
 * WHY THE SCREEN EXISTS. The only way to confirm the phrase was
 * copied correctly used to be showing it again and comparing by
 * eye — another reveal of exactly what the phrase protects. A
 * copy error is found at recovery, when it is too late to fix.
 *
 * THE PHRASE IS NEVER SHOWN HERE, on a match or a mismatch.
 * Showing the "correct version" after a failure would erase the
 * point of the check.
 *
 * THE PHRASE FIELD DOES NOT MASK TEXT. People copy from paper
 * word by word, and dots instead of letters would turn a copy
 * check into a blind-typing check. The input is not saved and
 * is cleared immediately after the answer.
 */
export function VerifyBackupCard({ onVerify }: VerifyBackupCardProps) {
  const phraseId = useId()
  const passwordId = useId()

  const [phrase, setPhrase] = useState('')
  const [password, setPassword] = useState('')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [isBusy, setBusy] = useState(false)

  function submit(event: FormEvent): void {
    event.preventDefault()
    setBusy(true)
    setVerdict(null)

    void onVerify(phrase, password).then(
      (matches) => {
        setBusy(false)
        setVerdict(matches ? 'match' : 'mismatch')

        /* Input is cleared regardless of outcome: a phrase left in
           the field is visible to anyone who approaches the device
           and stays in tab memory longer than needed. */
        setPhrase('')
        setPassword('')
      },
      (error: unknown) => {
        setBusy(false)
        setPassword('')
        setVerdict(error instanceof InvalidPasswordError ? 'wrong-password' : 'failed')
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden />
          Check your written copy
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Type the phrase exactly as you wrote it down. The wallet answers whether it matches and
          never shows the stored phrase — neither now nor if it does not match.
        </p>

        {verdict === null ? null : <Verdict verdict={verdict} />}

        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={phraseId}>The phrase from your paper</Label>
            <textarea
              id={phraseId}
              className="min-h-24 w-full resize-none rounded-xl border bg-transparent p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={phrase}
              placeholder="Twelve or twenty-four words separated by spaces"
              autoComplete="off"
              spellCheck={false}
              disabled={isBusy}
              onChange={(event) => {
                setPhrase(event.target.value)
                setVerdict(null)
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={passwordId}>Wallet password</Label>
            <Input
              id={passwordId}
              type="password"
              value={password}
              autoComplete="current-password"
              disabled={isBusy}
              onChange={(event) => {
                setPassword(event.target.value)
                setVerdict(null)
              }}
            />
            {/* The password requirement is explained: without that it
                looks like nitpicking on a screen where the wallet is
                already unlocked. */}
            <span className="text-xs text-muted-foreground">
              Asked so that this screen cannot be used to guess a phrase somebody found written
              down.
            </span>
          </div>

          <Button type="submit" disabled={isBusy || phrase.trim() === '' || password === ''}>
            {isBusy ? 'Checking…' : 'Check'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function Verdict({ verdict }: { readonly verdict: Verdict }) {
  if (verdict === 'match') {
    return (
      <Alert>
        <CircleCheck />
        <AlertTitle>The copy matches</AlertTitle>
        <AlertDescription>
          Keep the paper where you keep documents. Anyone holding it holds the wallet.
        </AlertDescription>
      </Alert>
    )
  }

  if (verdict === 'wrong-password') {
    return (
      <Alert variant="warning">
        <AlertDescription>The password is wrong. Nothing was checked.</AlertDescription>
      </Alert>
    )
  }

  if (verdict === 'failed') {
    return (
      <Alert variant="warning">
        <AlertDescription>
          The check could not be performed. That is not an answer about your copy.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="danger">
      <CircleX />
      <AlertTitle>The copy does not match</AlertTitle>
      <AlertDescription>
        Read your paper again word by word — a single wrong or missing word makes the phrase restore
        a different wallet. Which word differs is not shown on purpose: that would help anyone who
        found the paper as much as it would help you.
      </AlertDescription>
    </Alert>
  )
}
