import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DAPP_REQUEST_KIND,
  toAddress,
  toChainId,
  type Address,
  type ChainId,
  type IDappRequest,
} from '@/core'
import { FakeSessionTransport, NullLogger } from '@/test/doubles'

import { DappSessionService } from './DappSessionService'

const ETHEREUM = toChainId(1n)
const POLYGON = toChainId(137n)
const UNKNOWN_CHAIN = toChainId(999_999n)

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const STRANGER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

let transport: FakeSessionTransport
let service: DappSessionService
let execute: ReturnType<typeof vi.fn<(request: IDappRequest) => Promise<string>>>

function messageRequest(address: Address, id = 'req-1', chainId: ChainId = ETHEREUM): IDappRequest {
  return {
    id,
    sessionId: 'session',
    dapp: { name: 'Example', url: 'https://example.com', description: null, iconUrl: null },
    chainId,
    payload: { kind: DAPP_REQUEST_KIND.SignMessage, address, message: 'Sign in' },
  }
}

beforeEach(async () => {
  transport = new FakeSessionTransport()
  execute = vi.fn<(request: IDappRequest) => Promise<string>>(() => Promise.resolve('0xsignature'))

  service = new DappSessionService({
    transport,
    logger: new NullLogger(),
    getAddresses: () => [OWNER],
    getActiveChainId: () => ETHEREUM,
    getAvailableChainIds: () => [ETHEREUM, POLYGON],
    execute,
  })

  await service.init()
})

describe('Preparing the transport', () => {
  it('the section is ready after start', () => {
    expect(service.getSnapshot().isReady).toBe(true)
    expect(service.getSnapshot().error).toBeNull()
  })

  it('does not retry automatically after failure', async () => {
    /* The transport fails for reasons that do not heal themselves.
       Retrying on every call would become an endless loop and hang
       the screen. */
    const failing = new FakeSessionTransport()
    let attempts = 0

    failing.initError = 'Project identifier is not set'

    const original = failing.init.bind(failing)

    failing.init = () => {
      attempts += 1

      return original()
    }

    const withFailure = new DappSessionService({
      transport: failing,
      logger: new NullLogger(),
      getAddresses: () => [OWNER],
      getActiveChainId: () => ETHEREUM,
      getAvailableChainIds: () => [ETHEREUM],
      execute,
    })

    await withFailure.init()
    await withFailure.init()
    await withFailure.init()

    expect(attempts).toBe(1)
  })

  it('a transport failure does not crash the section and is explained', async () => {
    /* The section must open and say why it does not work, not
       stay a blank screen. */
    const failing = new FakeSessionTransport()

    failing.initError = 'Project identifier is not set'

    const withFailure = new DappSessionService({
      transport: failing,
      logger: new NullLogger(),
      getAddresses: () => [OWNER],
      getActiveChainId: () => ETHEREUM,
      getAvailableChainIds: () => [ETHEREUM],
      execute,
    })

    await withFailure.init()

    expect(withFailure.getSnapshot().isReady).toBe(false)
    expect(withFailure.getSnapshot().error).toContain('Project identifier')
  })
})

describe('Connecting an application', () => {
  it('shows the proposal to the user', () => {
    transport.emitProposal('p1', [ETHEREUM])

    expect(service.getSnapshot().proposal?.id).toBe('p1')
  })

  it('approval issues the wallet addresses', async () => {
    transport.emitProposal('p1', [ETHEREUM])
    await service.respondToProposal(true)

    expect(transport.lastApprovedAddresses()).toEqual([OWNER])
  })

  it('a rejection is sent to the app explicitly', async () => {
    /* An app that gets no reply hangs waiting and nudges another press. */
    transport.emitProposal('p1', [ETHEREUM])
    await service.respondToProposal(false)

    expect(transport.proposalAnswers.at(-1)?.[1]).toBeNull()
  })

  it('does not issue networks the wallet does not have', async () => {
    /* Agreeing to an unknown network would promise a signature
       where the wallet cannot estimate a fee or show a balance. */
    transport.emitProposal('p1', [UNKNOWN_CHAIN])
    await service.respondToProposal(true)

    const approval = transport.proposalAnswers.at(-1)?.[1] as { chainIds: ChainId[] }

    expect(approval.chainIds).not.toContain(UNKNOWN_CHAIN)
  })

  it('keeps only known networks from those requested', async () => {
    transport.emitProposal('p1', [ETHEREUM, UNKNOWN_CHAIN])
    await service.respondToProposal(true)

    const approval = transport.proposalAnswers.at(-1)?.[1] as { chainIds: ChainId[] }

    expect(approval.chainIds).toEqual([ETHEREUM])
  })

  it('the proposal disappears after a response', async () => {
    transport.emitProposal('p1', [ETHEREUM])
    await service.respondToProposal(true)

    expect(service.getSnapshot().proposal).toBeNull()
  })
})

describe('A signature request', () => {
  it('shows the request together with risk findings', () => {
    transport.emitRequest(messageRequest(OWNER))

    expect(service.getSnapshot().request?.request.id).toBe('req-1')
    expect(service.getSnapshot().request?.risks).toBeDefined()
  })

  it('reports a network mismatch in the findings', () => {
    transport.emitRequest(messageRequest(OWNER, 'req-1', POLYGON))

    expect(service.getSnapshot().request?.risks.map((item) => item.risk)).toContain(
      'chain-mismatch',
    )
  })

  it('rejects a request from a foreign address without asking the user', async () => {
    /* There is nothing to sign a foreign address with, and an extra
       screen trains people to press "confirm" without reading. */
    transport.emitRequest(messageRequest(STRANGER))

    await vi.waitFor(() => {
      expect(transport.responses).toHaveLength(1)
    })

    expect(transport.responses[0]?.response.kind).toBe('rejected')
    expect(service.getSnapshot().request).toBeNull()
  })

  it('rejects a second request while the first is unanswered', async () => {
    /* A second screen on top of the first is a way to sign the wrong thing. */
    transport.emitRequest(messageRequest(OWNER, 'req-1'))
    transport.emitRequest(messageRequest(OWNER, 'req-2'))

    await vi.waitFor(() => {
      expect(transport.responses).toHaveLength(1)
    })

    expect(transport.responses[0]?.requestId).toBe('req-2')
    expect(service.getSnapshot().request?.request.id).toBe('req-1')
  })

  it('approval executes the request and sends the result', async () => {
    transport.emitRequest(messageRequest(OWNER))
    await service.respondToRequest(true)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(transport.responses.at(-1)?.response).toEqual({
      kind: 'approved',
      result: '0xsignature',
    })
  })

  it('rejection does not execute the request', async () => {
    transport.emitRequest(messageRequest(OWNER))
    await service.respondToRequest(false)

    expect(execute).not.toHaveBeenCalled()
    expect(transport.responses.at(-1)?.response.kind).toBe('rejected')
  })

  it('an execution failure becomes a rejection, not silence', async () => {
    /* Otherwise the app waits and nudges another press — i.e. a
       second signature. */
    execute.mockRejectedValueOnce(new Error('The node did not respond'))

    transport.emitRequest(messageRequest(OWNER))
    await service.respondToRequest(true)

    const response = transport.responses.at(-1)?.response

    expect(response?.kind).toBe('rejected')
    expect(response?.kind === 'rejected' ? response.reason : '').toContain(
      'The node did not respond',
    )
  })

  it('the request disappears after a response', async () => {
    transport.emitRequest(messageRequest(OWNER))
    await service.respondToRequest(true)

    expect(service.getSnapshot().request).toBeNull()
  })
})

describe('Disconnecting sessions', () => {
  it('disconnects and refreshes the list', async () => {
    transport.emitConnected({
      id: 'session-1',
      dapp: { name: 'Example', url: 'https://example.com', description: null, iconUrl: null },
      chainIds: [ETHEREUM],
      addresses: [OWNER],
      connectedAt: 0,
      expiresAt: null,
    })

    expect(service.getSnapshot().sessions).toHaveLength(1)

    await service.disconnect('session-1')

    expect(transport.disconnected).toEqual(['session-1'])
    expect(service.getSnapshot().sessions).toHaveLength(0)
  })

  it('destroy resets state', async () => {
    transport.emitProposal('p1', [ETHEREUM])
    await service.destroy()

    expect(service.getSnapshot().proposal).toBeNull()
    expect(service.getSnapshot().isReady).toBe(false)
  })
})

describe('Notifying apps of a state change', () => {
  it('passes the current network and addresses to the transport', async () => {
    /* The app remembers the network from connect time; without a
       notice it prepares an operation for the previous one. */
    await service.notifyWalletState()

    expect(transport.stateChanges).toEqual([{ chainId: ETHEREUM, addresses: [OWNER] }])
  })

  it('stays silent until the transport is ready', async () => {
    /* No one and nothing to notify: the service has not run init(). */
    const idleTransport = new FakeSessionTransport()
    const notReady = new DappSessionService({
      transport: idleTransport,
      logger: new NullLogger(),
      getAddresses: () => [OWNER],
      getActiveChainId: () => ETHEREUM,
      getAvailableChainIds: () => [ETHEREUM],
      execute,
    })

    await notReady.notifyWalletState()

    expect(idleTransport.stateChanges).toEqual([])
  })

  it('does not notify without an active network', async () => {
    /* Between lock and open there is no network; the event is meaningless. */
    const noChain = new DappSessionService({
      transport,
      logger: new NullLogger(),
      getAddresses: () => [OWNER],
      getActiveChainId: () => null,
      getAvailableChainIds: () => [ETHEREUM],
      execute,
    })

    await noChain.init()
    transport.stateChanges.length = 0

    await noChain.notifyWalletState()

    expect(transport.stateChanges).toEqual([])
  })
})
