import { describe, expect, it } from 'vitest'

import { DAPP_REQUEST_KIND, toAddress, toChainId, type IDappMetadata } from '@/core'

import { toDappRequest, type IRawRequest } from './request-mapping'

const CHAIN = toChainId(1n)

const OWNER = toAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
const SPENDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const DAPP: IDappMetadata = {
  name: 'Пример',
  url: 'https://example.com',
  description: null,
  iconUrl: null,
}

/** Собирает сырое обращение с заданным методом и параметрами. */
function raw(
  method: string,
  params: unknown,
  chainId = CHAIN as IRawRequest['chainId'],
): IRawRequest {
  return { topic: 'session-1', id: 7, chainId, method, params, dapp: DAPP }
}

describe('toDappRequest: опознание запроса', () => {
  it('строит устойчивый идентификатор из сессии и номера', () => {
    const request = toDappRequest(raw('personal_sign', ['Привет', OWNER]))

    expect(request?.id).toBe('session-1|7')
    expect(request?.sessionId).toBe('session-1')
  })

  it('отвергает запрос без сети', () => {
    /* Выполнить запрос «в какой-нибудь сети» нельзя: подпись, сделанная
       не в той цепи, может оказаться действительной там, где её не ждали. */
    expect(toDappRequest(raw('personal_sign', ['Привет', OWNER], null))).toBeNull()
  })

  it('отвергает неизвестный метод', () => {
    /* Показать пользователю запрос, содержимого которого мы не поняли,
       значит предложить подтвердить непонятное. */
    expect(toDappRequest(raw('eth_getBalance', [OWNER]))).toBeNull()
  })

  it('отвергает параметры, не являющиеся списком', () => {
    expect(toDappRequest(raw('personal_sign', { message: 'Привет' }))).toBeNull()
  })
})

describe('toDappRequest: подпись сообщения', () => {
  it('personal_sign читает сообщение первым, адрес вторым', () => {
    const request = toDappRequest(raw('personal_sign', ['Войти', OWNER]))

    expect(request?.payload).toEqual({
      kind: DAPP_REQUEST_KIND.SignMessage,
      address: OWNER,
      message: 'Войти',
    })
  })

  it('eth_sign читает адрес первым, сообщение вторым', () => {
    /* Порядок обратный, и это не опечатка стандарта. Перепутать их
       значит принять адрес за сообщение и показать бессмыслицу. */
    const request = toDappRequest(raw('eth_sign', [OWNER, 'Войти']))

    expect(request?.payload).toEqual({
      kind: DAPP_REQUEST_KIND.SignMessage,
      address: OWNER,
      message: 'Войти',
    })
  })

  it('порядок параметров personal_sign не подходит для eth_sign', () => {
    /* Обратная подстановка обязана отвергаться, а не разбираться
       «как получится»: иначе адрес попал бы в поле сообщения. */
    expect(toDappRequest(raw('eth_sign', ['Войти', OWNER]))).toBeNull()
  })

  it('шестнадцатеричное сообщение переводится в текст', () => {
    /* Показывать байты там, где есть читаемая фраза, — значит
       не показывать ничего. */
    const hex = `0x${[...new TextEncoder().encode('Войти')]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`

    const request = toDappRequest(raw('personal_sign', [hex, OWNER]))

    expect(request?.payload).toMatchObject({ message: 'Войти' })
  })

  it('нечитаемые байты остаются шестнадцатеричными', () => {
    /* Строгий режим разбора: испорченная последовательность не
       подменяется знаками вопроса, потому что подмена скрыла бы,
       что именно подписывается. */
    const request = toDappRequest(raw('personal_sign', ['0xfffe', OWNER]))

    expect(request?.payload).toMatchObject({ message: '0xfffe' })
  })

  it('отвергает нестроковое сообщение', () => {
    expect(toDappRequest(raw('personal_sign', [{ text: 'Войти' }, OWNER]))).toBeNull()
  })

  it('отвергает адрес с испорченной контрольной суммой', () => {
    /* Контрольная сумма EIP-55 — единственная защита от опечатки
       в адресе, и принимать испорченную нельзя. */
    const broken = `0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045`

    expect(toDappRequest(raw('personal_sign', ['Войти', broken]))).toBeNull()
  })

  it('отвергает адрес неверной длины', () => {
    expect(toDappRequest(raw('personal_sign', ['Войти', '0x1234']))).toBeNull()
  })
})

describe('toDappRequest: подпись структуры EIP-712', () => {
  const TYPED = {
    domain: { name: 'USD Coin', chainId: 1, verifyingContract: SPENDER },
    types: { Permit: [{ name: 'value', type: 'uint256' }] },
    primaryType: 'Permit',
    message: { value: '1' },
  }

  it('принимает структуру объектом', () => {
    const request = toDappRequest(raw('eth_signTypedData_v4', [OWNER, TYPED]))

    expect(request?.payload).toMatchObject({
      kind: DAPP_REQUEST_KIND.SignTypedData,
      address: OWNER,
    })
  })

  it('принимает структуру строкой JSON', () => {
    const request = toDappRequest(raw('eth_signTypedData_v4', [OWNER, JSON.stringify(TYPED)]))

    expect(request?.payload).toMatchObject({ kind: DAPP_REQUEST_KIND.SignTypedData })
  })

  it('испорченный JSON отвергается, а не разбирается частично', () => {
    expect(toDappRequest(raw('eth_signTypedData_v4', [OWNER, '{не json']))).toBeNull()
  })

  it('отсутствие домена не отменяет разбор', () => {
    /* Домен необязателен по стандарту. Его отсутствие — повод
       для замечания при показе, а не причина отказаться понимать
       запрос вовсе. */
    const request = toDappRequest(
      raw('eth_signTypedData_v4', [OWNER, { ...TYPED, domain: undefined }]),
    )

    expect(request?.payload).toMatchObject({ kind: DAPP_REQUEST_KIND.SignTypedData })
  })

  it.each([
    ['без primaryType', { types: TYPED.types, message: TYPED.message }],
    ['без types', { primaryType: 'Permit', message: TYPED.message }],
    ['без message', { primaryType: 'Permit', types: TYPED.types }],
  ])('отвергает структуру %s', (_name, value) => {
    expect(toDappRequest(raw('eth_signTypedData_v4', [OWNER, value]))).toBeNull()
  })

  it('устаревшее имя метода поддержано наравне с v4', () => {
    expect(toDappRequest(raw('eth_signTypedData', [OWNER, TYPED]))?.payload).toMatchObject({
      kind: DAPP_REQUEST_KIND.SignTypedData,
    })
  })
})

describe('toDappRequest: транзакция', () => {
  it('различает отправку и подпись без отправки', () => {
    const sent = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, to: SPENDER }]))
    const signed = toDappRequest(raw('eth_signTransaction', [{ from: OWNER, to: SPENDER }]))

    expect(sent?.payload.kind).toBe(DAPP_REQUEST_KIND.SendTransaction)
    expect(signed?.payload.kind).toBe(DAPP_REQUEST_KIND.SignTransaction)
  })

  it('отвергает транзакцию без отправителя', () => {
    /* Подставить активный аккаунт значило бы решить за пользователя,
       с какого адреса уйдут средства. */
    expect(toDappRequest(raw('eth_sendTransaction', [{ to: SPENDER, value: '0x1' }]))).toBeNull()
  })

  it('отсутствие суммы означает ноль, а не неизвестность', () => {
    /* Перевод без явной суммы — это вызов контракта. */
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, to: SPENDER }]))

    expect(request?.payload).toMatchObject({ transaction: { value: 0n } })
  })

  it('развёртывание контракта допустимо: получателя нет', () => {
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, data: '0x6060' }]))

    expect(request?.payload).toMatchObject({ transaction: { to: null } })
  })

  it.each([
    ['шестнадцатеричной строкой', '0x2a', 42n],
    ['десятичной строкой', '42', 42n],
    ['числом', 42, 42n],
  ])('читает сумму %s', (_name, value, expected) => {
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, value }]))

    expect(request?.payload).toMatchObject({ transaction: { value: expected } })
  })

  it('отвергает сумму, записанную мусором', () => {
    /* Значение приводится к нулю, а не к произвольному числу: неверный
       разбор суммы — это перевод не той величины. */
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, value: 'много' }]))

    expect(request?.payload).toMatchObject({ transaction: { value: 0n } })
  })

  it('дробное число суммой не считается', () => {
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, value: 1.5 }]))

    expect(request?.payload).toMatchObject({ transaction: { value: 0n } })
  })

  it('лимит газа читается и из gas, и из gasLimit', () => {
    const short = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, gas: '0x5208' }]))
    const long = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, gasLimit: '0x5208' }]))

    expect(short?.payload).toMatchObject({ transaction: { gasLimit: 21000n } })
    expect(long?.payload).toMatchObject({ transaction: { gasLimit: 21000n } })
  })

  it('данные вызова не шестнадцатеричного вида отбрасываются', () => {
    const request = toDappRequest(raw('eth_sendTransaction', [{ from: OWNER, data: 'привет' }]))

    expect(request?.payload).toMatchObject({ transaction: { data: null } })
  })

  it('отвергает транзакцию, присланную строкой', () => {
    expect(toDappRequest(raw('eth_sendTransaction', ['0xdeadbeef']))).toBeNull()
  })
})
