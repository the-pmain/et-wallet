import { describe, expect, it } from 'vitest'

import { signedS3Headers } from './s3-sign.ts'

describe('signedS3Headers', () => {
  it('signs a request stably at a fixed time', () => {
    const first = signedS3Headers({
      method: 'GET',
      url: new URL('https://example.r2.cloudflarestorage.com/mailbox?list-type=2&prefix=mailbox/'),
      body: Buffer.alloc(0),
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'auto',
      now: new Date('2013-05-24T00:00:00.000Z'),
    })
    const second = signedS3Headers({
      method: 'GET',
      url: new URL('https://example.r2.cloudflarestorage.com/mailbox?list-type=2&prefix=mailbox/'),
      body: Buffer.alloc(0),
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'auto',
      now: new Date('2013-05-24T00:00:00.000Z'),
    })

    expect(first['x-amz-date']).toBe('20130524T000000Z')
    expect(first['Authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/u,
    )
    expect(first['Authorization']).toBe(second['Authorization'])
  })
})
