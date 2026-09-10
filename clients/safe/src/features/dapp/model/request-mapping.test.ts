import { describe, expect, it } from 'vitest'

import { DAPP_REQUEST_KIND, toAddress, toChainId, type IDappMetadata } from '@/core'

import { toDappRequest, type IRawRequest } from './request-mapping'

const CHAIN = toChainId(1n)

const OWNER = toAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
const SPENDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const DAPP: IDappMetadata = {
  name: 'Example',
  url: 'https://example.com',
  description: null,
  iconUrl: null,
}

function raw(
  method: string,
  params: unknown,
  chainId = CHAIN as IRawRequest['chainId'],
): IRawRequest {
  return { topic: 'session-1', id: 7, chainId, method, params, dapp: DAPP }
}

describe('toDappRequest: recognizing a request', () => {
  it('builds a stable identifier from session and number', () => {
    const request = toDappRequest(raw('personal_sign', ['Hello', OWNER]))

    expect(request?.id).toBe('session-1|7')
    expect(request?.sessionId).toBe('session-1')
  })

  it('rejects a request without a network', () => {
    /* A request "on some network" is not allowed: a signature made
       on the wrong chain may be valid where it was not expected. */
    expect(toDappRequest(raw('personal_sign', ['Hello', OWNER], null))).toBeNull()
  })

  it('rejects an unknown method', () => {
    /* Showing a request whose contents we did not understand is
       asking the user to confirm the unknown. */
    expect(toDappRequest(raw('eth_getBalance', [OWNER]))).toBeNull()
  })

  it('rejects parameters that are not a list', () => {
    expect(toDappRequest(raw('personal_sign', { message: 'Hello' }))).toBeNull()
  })
})

describe('toDappRequest: message signature', () => {
  it('personal_sign reads the message first and the address second', () => {
    const request = toDappRequest(raw('personal_sign', ['Sign in', OWNER]))

    expect(request?.payload).toEqual({
      kind: DAPP_REQUEST_KIND.SignMessage,
      address: OWNER,
      message: 'Sign in',
    })
  })

  it('eth_sign is rejected regardless of parameter order', () => {
    /* The method signs arbitrary 32 bytes without a prefix: an app
       can send a transaction hash and get a signature under it
       without showing the owner. Rejected at the door, not parsed
       "as it comes". */
    expect(toDappRequest(raw('eth_sign', [OWNER, 'Sign in']))).toBeNull()
    expect(toDappRequest(raw('eth_sign', ['Sign in', OWNER]))).toBeNull()
  })

  it('eth_sign is rejected with a hex value as well', () => {
    /* This is the dangerous case: thirty-two bytes that look like
       a transaction hash. */
    expect(toDappRequest(raw('eth_sign', [OWNER, `0x${'11'.repeat(32)}`]))).toBeNull()
  })

  it('a hex message is decoded to text', () => {
    /* Showing bytes where a readable phrase exists is showing nothing. */
    const hex = `0x${[...new TextEncoder().encode('Sign in')]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`

    const request = toDappRequest(raw('personal_sign', [hex, OWNER]))

    expect(request?.payload).toMatchObject({ message: 'Sign in' })
  })

  it('unreadable bytes stay hex', () => {
    /* Fatal parse: a broken sequence is not replaced with question
       marks, because that would hide what is being signed. */
    const request = toDappRequest(raw('personal_sign', ['0xfffe', OWNER]))

    expect(request?.payload).toMatchObject({ message: '0xfffe' })
  })

  it('rejects a non-string message', () => {
    expect(toDappRequest(raw('personal_sign', [{ text: 'Sign in' }, OWNER]))).toBeNull()
  })

  it('rejects an address with a broken checksum', () => {
    /* The EIP-55 checksum is the only typo protection on an address,
       and a broken one must not be accepted. */
    const broken = `0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045`

    expect(toDappRequest(raw('personal_sign', ['Sign in', broken]))).toBeNull()
  })

  it('rejects an address of the wrong length', () => {
    expect(toDappRequest(raw('personal_sign', ['Sign in', '0x1234']))).toBeNull()
  })
})

describe('toDappRequest: EIP-712 typed data signature', () => {
  const TYPED = {
    domain: { name: 'USD Coin', chainId: 1, verifyingContract: SPENDER },
    types: { Permit: [{ name: 'value', type: 'uint256' }] },
    primaryType: 'Permit',
    message: { value: '1' },
  }

  it('accepts the structure as an object', () => {
    const request = toDappRequest(raw('eth_signTypedData_v4', [OWNER, TYPED]))

    expect(request?.payload).toMatchObject({
      kind: DAPP_REQUEST_KIND.SignTypedData,
      address: OWNER,
    })
  })

  it('accepts the structure as a JSON string', () => {
    const request = toDappRequest(raw('eth_signTypedData_v4', [OWNER, JSON.stringify(TYPED)]))

    expect(request?.payload).toMatchObject({ kind: DAPP_REQUEST_KIND.SignTypedData })
  })

  it('broken JSON is rejected, not parsed in part', () => {
    expect(toDappRequest(raw('eth_signTypedData_v4', [OWNER, '{not json']))).toBeNull()
  })

  it('a missing domain does not cancel the parse', () => {
    /* Domain is optional in the spec. Its absence is a finding at
       display time, not a reason to refuse to understand the
       request at all. */
    const request = toDappRequest(
      raw('eth_signTypedData_v4', [OWNER, { ...TYPED, domain: undefined }]),
    )

    expect(request?.payload).toMatchObject({ kind: DAPP_REQUEST_KIND.SignTypedData })
  })

  it.each([
    ['without primaryType', { types: TYPED.types, message: TYPED.message }],
    ['without types', { primaryType: 'Permit', message: TYPED.message }],
    ['without message', { primaryType: 'Permit', types: TYPED.types }],
  ])('rejects a structure %s', (_name, value) => {
    expect(toDappRequest(raw('eth_signTypedData_v4', [OWNER, value]))).toBeNull()
  })

  it('the legacy method name is supported on par with v4', () => {
    expect(toDappRequest(raw('eth_signTypedData', [OWNER, TYPED]))?.payload).toMatchObject({
      kind: DAPP_REQUEST_KIND.SignTypedData,
    })
  })
})

describe('toDappRequest: transaction', () => {
  it('distinguishes send from sign-without-send', () => {
    const sent = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, to: SPENDER }]))
    const signed = toDappRequest(raw('eth_signTransaction', [{ from: OWNER, to: SPENDER }]))

    expect(sent?.payload.kind).toBe(DAPP_REQUEST_KIND.SendTransaction)
    expect(signed?.payload.kind).toBe(DAPP_REQUEST_KIND.SignTransaction)
  })

  it('rejects a transaction without a sender', () => {
    /* Filling in the active account would decide for the user which
       address the funds leave from. */
    expect(toDappRequest(raw('eth_sendTransaction', [{ to: SPENDER, value: '0x1' }]))).toBeNull()
  })

  it('a missing amount means zero, not unknown', () => {
    /* A transfer without an explicit amount is a contract call. */
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, to: SPENDER }]))

    expect(request?.payload).toMatchObject({ transaction: { value: 0n } })
  })

  it('contract deployment is allowed: there is no recipient', () => {
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, data: '0x6060' }]))

    expect(request?.payload).toMatchObject({ transaction: { to: null } })
  })

  it.each([
    ['as a hex string', '0x2a', 42n],
    ['as a decimal string', '42', 42n],
    ['as a number', 42, 42n],
  ])('reads the amount %s', (_name, value, expected) => {
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, value }]))

    expect(request?.payload).toMatchObject({ transaction: { value: expected } })
  })

  it('rejects an amount written as garbage', () => {
    /* The value becomes zero, not an arbitrary number: a wrong
       amount parse is a transfer of the wrong size. */
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, value: 'lots' }]))

    expect(request?.payload).toMatchObject({ transaction: { value: 0n } })
  })

  it('a fractional number is not treated as an amount', () => {
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, value: 1.5 }]))

    expect(request?.payload).toMatchObject({ transaction: { value: 0n } })
  })

  it('the gas limit is read from both gas and gasLimit', () => {
    const short = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, gas: '0x5208' }]))
    const long = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, gasLimit: '0x5208' }]))

    expect(short?.payload).toMatchObject({ transaction: { gasLimit: 21000n } })
    expect(long?.payload).toMatchObject({ transaction: { gasLimit: 21000n } })
  })

  it('non-hex call data is dropped', () => {
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, data: 'hello' }]))

    expect(request?.payload).toMatchObject({ transaction: { data: null } })
  })

  it('rejects a transaction sent as a string', () => {
    expect(toDappRequest(raw('eth_sendTransaction', ['0xdeadbeef']))).toBeNull()
  })
})
