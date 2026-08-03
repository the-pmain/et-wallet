import { describe, expect, it } from 'vitest'

import { encodeUintWord, functionSelector } from '@/core/abi/encoding'
import { toAddress } from '@/core/address'
import { GasEstimationFailedError } from '@/core/errors'
import { EventBus } from '@/core/events'
import type {
  ICallRequest,
  IFeeData,
  ILogEntry,
  IProvider,
  ProviderEventMap,
} from '@/core/provider'
import { toWei, type ChainId, type HexString, type TxHash, type Wei } from '@/core/types'

import { PREFLIGHT_OUTCOME, decodeRevertReason, preflightCall } from './preflight'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/** Данные вызова `transfer(address,uint256)`. */
const TRANSFER_DATA =
  `0x${functionSelector('transfer(address,uint256)')}${'0'.repeat(24)}${PEER.slice(2)}${encodeUintWord(1n)}` as HexString

/** Слово, кодирующее `true`, и слово, кодирующее `false`. */
const TRUE_WORD = `0x${encodeUintWord(1n)}` as HexString
const FALSE_WORD = `0x${encodeUintWord(0n)}` as HexString

/** Кодирует `Error(string)` так, как это делает виртуальная машина. */
function encodeErrorString(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const body = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

  return `0x${functionSelector('Error(string)')}${encodeUintWord(32n)}${encodeUintWord(BigInt(bytes.length))}${body.padEnd(Math.ceil(body.length / 64) * 64, '0')}`
}

/** Кодирует `Panic(uint256)`. */
function encodePanic(code: bigint): string {
  return `0x${functionSelector('Panic(uint256)')}${encodeUintWord(code)}`
}

/** Узел, отвечающий на `eth_call` заданным образом. */
class CallNode implements IProvider {
  readonly chainId = 1n as ChainId
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  /** Что вернуть на вызов. */
  result: HexString = '0x' as HexString

  /** Чем отказать вместо ответа. */
  failure: Error | null = null

  /** Последний полученный запрос: проверяется его состав. */
  lastRequest: ICallRequest | null = null

  readonly #events = new EventBus<ProviderEventMap>()

  call(request: ICallRequest): Promise<HexString> {
    this.lastRequest = request

    return this.failure === null ? Promise.resolve(this.result) : Promise.reject(this.failure)
  }

  getBalance(): Promise<Wei> {
    return Promise.resolve(toWei(0n))
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(1n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(this.chainId)
  }

  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  sendRawTransaction(): Promise<TxHash> {
    return Promise.reject(new Error('not supported'))
  }

  getFeeData(): Promise<IFeeData> {
    return Promise.resolve({
      baseFeePerGas: 1n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      gasPrice: 2n,
    })
  }

  getLogs(): Promise<readonly ILogEntry[]> {
    return Promise.resolve([])
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('not supported'))
  }

  destroy(): void {
    /* Дублёру нечего освобождать. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

const nativeSend = {
  from: OWNER,
  to: PEER,
  data: '0x' as HexString,
  value: toWei(10n ** 18n),
}

const tokenSend = {
  from: OWNER,
  to: TOKEN,
  data: TRANSFER_DATA,
  value: toWei(0n),
}

describe('Предварительный прогон: успех', () => {
  it('вызов, прошедший на узле, считается пройденным', async () => {
    const node = new CallNode()

    expect((await preflightCall(node, nativeSend)).outcome).toBe(PREFLIGHT_OUTCOME.Passed)
  })

  it('узлу уходят те же поля, что уйдут в сеть', async () => {
    /* Проверка отличающейся транзакции ничего не проверяет. Сумма
       и данные вызова обязаны совпадать с подписываемыми. */
    const node = new CallNode()

    node.result = TRUE_WORD

    await preflightCall(node, tokenSend)

    expect(node.lastRequest).toEqual({
      to: TOKEN,
      from: OWNER,
      data: TRANSFER_DATA,
      value: 0n,
    })
  })
})

describe('Предварительный прогон: отказ значением', () => {
  it('`transfer`, вернувший false, признаётся отказом', async () => {
    /* Опаснее отката: транзакция попадёт в блок, газ спишется,
       а средства не сдвинутся. Кошелёк, промолчавший здесь,
       отрапортует об отправке, которой не было. */
    const node = new CallNode()

    node.result = FALSE_WORD

    const result = await preflightCall(node, tokenSend)

    expect(result.outcome).toBe(PREFLIGHT_OUTCOME.RejectedByContract)
    expect(result.reason).toMatch(/false/i)
  })

  it('`transfer`, вернувший true, проходит', async () => {
    const node = new CallNode()

    node.result = TRUE_WORD

    expect((await preflightCall(node, tokenSend)).outcome).toBe(PREFLIGHT_OUTCOME.Passed)
  })

  it('пустой ответ на `transfer` отказом не считается', async () => {
    /* Контракты, написанные до уточнения стандарта, не возвращают
       ничего. Счесть их отказавшими значило бы запретить работу
       с ними — среди них есть крупнейшие. */
    const node = new CallNode()

    node.result = '0x' as HexString

    expect((await preflightCall(node, tokenSend)).outcome).toBe(PREFLIGHT_OUTCOME.Passed)
  })

  it('нулевой ответ на вызов без булевого результата отказом не считается', async () => {
    /* Ноль — законный результат множества функций. Толковать его как
       отказ у всех подряд значило бы поднимать тревогу без причины. */
    const node = new CallNode()

    node.result = FALSE_WORD

    expect((await preflightCall(node, nativeSend)).outcome).toBe(PREFLIGHT_OUTCOME.Passed)
  })
})

describe('Предварительный прогон: откат', () => {
  it('откат распознаётся и не выдаётся за недоступность', async () => {
    const node = new CallNode()

    node.failure = new GasEstimationFailedError('the call reverted')

    expect((await preflightCall(node, tokenSend)).outcome).toBe(PREFLIGHT_OUTCOME.Reverted)
  })

  it('причина контракта доходит дословно', async () => {
    const node = new CallNode()

    node.failure = new GasEstimationFailedError('the call reverted', {
      revertData: encodeErrorString('ERC20: transfer amount exceeds balance'),
    })

    expect((await preflightCall(node, tokenSend)).reason).toBe(
      'ERC20: transfer amount exceeds balance',
    )
  })

  it('сырые данные отката сохраняются', async () => {
    /* По четырёхбайтовому признаку собственной ошибки причину можно
       найти. Потеряв его, сказать было бы нечего. */
    const node = new CallNode()
    const data = '0xdeadbeef'

    node.failure = new GasEstimationFailedError('the call reverted', { revertData: data })

    expect((await preflightCall(node, tokenSend)).revertData).toBe(data)
  })

  it('недоступный узел не выдаётся за откат', async () => {
    /* Молчание узла не подтверждает ничего. Показать его как отказ
       вызова значило бы заставить человека искать ошибку в своей
       транзакции. */
    const node = new CallNode()

    node.failure = new Error('the node did not answer')

    expect((await preflightCall(node, tokenSend)).outcome).toBe(PREFLIGHT_OUTCOME.Unavailable)
  })

  it('развёртывание контракта не проверяется и не объявляется проверенным', async () => {
    /* Вызов без получателя возвращает байт-код будущего контракта,
       а не признак успеха: судить по нему не о чем. */
    const node = new CallNode()

    const result = await preflightCall(node, {
      from: OWNER,
      to: null,
      data: '0x6080' as HexString,
      value: toWei(0n),
    })

    expect(result.outcome).toBe(PREFLIGHT_OUTCOME.Unavailable)
    expect(node.lastRequest).toBeNull()
  })
})

describe('Разбор данных отката', () => {
  it('стандартная причина читается строкой', () => {
    expect(decodeRevertReason(encodeErrorString('not enough allowance'))).toBe(
      'not enough allowance',
    )
  })

  it('код паники переводится в слова', () => {
    /* «Паника 0x11» не говорит владельцу средств ничего. */
    expect(decodeRevertReason(encodePanic(0x11n))).toMatch(/overflow/i)
  })

  it('неизвестный код паники называется числом, а не выдумкой', () => {
    expect(decodeRevertReason(encodePanic(0x99n))).toMatch(/153/)
  })

  it('собственная ошибка контракта показывается признаком', () => {
    /* Расшифровать её без описания контракта нельзя, а придумать
       толкование недопустимо. */
    expect(decodeRevertReason('0xdeadbeef')).toMatch(/0xdeadbeef/)
  })

  it('пустые данные причины не дают', () => {
    expect(decodeRevertReason(null)).toBeNull()
    expect(decodeRevertReason('0x')).toBeNull()
  })

  it('обрезанные данные причины не дают вместо исключения', () => {
    /* Испорченный ответ узла не должен добавлять исключение поверх
       уже случившегося отказа. */
    expect(decodeRevertReason(`0x${functionSelector('Error(string)')}00`)).toBeNull()
  })

  it('управляющие символы в причине её отменяют', () => {
    /* Строка с переводами строк и возвратом каретки позволяет
       нарисовать поверх сообщения кошелька собственный текст. */
    expect(decodeRevertReason(encodeErrorString('ok\n\n\rApproved by the wallet'))).toBeNull()
  })
})
