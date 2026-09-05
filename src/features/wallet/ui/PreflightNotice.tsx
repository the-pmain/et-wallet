import { CircleAlert, CircleCheck, CircleHelp } from 'lucide-react'

import { PREFLIGHT_OUTCOME, type IPreflightResult } from '@/core'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui'

interface PreflightNoticeProps {
  readonly preflight: IPreflightResult
}

/**
 * Result of a node trial run before signing.
 *
 * Always shown, including success. The temptation to stay quiet on
 * a pass is strong — less noise — but then a missing block would
 * mean both "checked" and "could not check". The owner must tell
 * them apart: the second case is signing blind.
 *
 * Success does not promise execution. The check is the chain state
 * at call time: an approval may be revoked, funds spent by another
 * tx, before this one lands. "The transaction will go through"
 * would be a promise the wallet cannot keep.
 *
 * A refusal does not block send. The node may have answered from
 * stale state, and the owner may know about a counter-tx that
 * fixes it. The decision stays theirs; the wallet's job is to name
 * the reason in the contract's words, not a generic "it failed".
 */
export function PreflightNotice({ preflight }: PreflightNoticeProps) {
  /* Neutral success styling, not "green". A check on green reads
     as a promise the transfer will land, while only the current
     block was checked. */
  if (preflight.outcome === PREFLIGHT_OUTCOME.Passed) {
    return (
      <Alert>
        <CircleCheck />
        <AlertTitle>The node ran this call without an error</AlertTitle>
        <AlertDescription>
          Checked against the current state of the chain. It is not a promise: the state may change
          before the transaction is included in a block.
        </AlertDescription>
      </Alert>
    )
  }

  if (preflight.outcome === PREFLIGHT_OUTCOME.Unavailable) {
    return (
      <Alert variant="warning">
        <CircleHelp />
        <AlertTitle>The call could not be checked</AlertTitle>
        <AlertDescription>
          The node did not answer the trial run, so nothing is known about how this call ends. That
          is not the same as a successful check.
        </AlertDescription>
      </Alert>
    )
  }

  const isSilentRejection = preflight.outcome === PREFLIGHT_OUTCOME.RejectedByContract

  return (
    <Alert variant="danger">
      <CircleAlert />
      <AlertTitle>
        {isSilentRejection
          ? 'The contract refuses this call without failing it'
          : 'The call would fail'}
      </AlertTitle>
      <AlertDescription>
        {isSilentRejection ? (
          <>
            The contract answers "no" but does not revert: the transaction would be included in a
            block, the gas would be spent and nothing would move. It would look like a completed
            transfer.
          </>
        ) : (
          <>
            The node ran the call and it ended in a revert. Sending it would spend the gas and
            change nothing.
          </>
        )}

        {/* The reason comes from the contract and is shown verbatim.
            A paraphrase would drop the only hook: "insufficient
            allowance" and "recipient is blacklisted" need different
            actions. */}
        {preflight.reason === null ? null : <> The contract said: "{preflight.reason}".</>}
      </AlertDescription>
    </Alert>
  )
}
