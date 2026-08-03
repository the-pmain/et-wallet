import { isError, type EthersError } from 'ethers'

import {
  GasEstimationFailedError,
  InsufficientFundsError,
  NonceTooLowError,
  ProviderUnavailableError,
  RpcError,
  TransactionUnderpricedError,
} from '@/core/errors'
import type { ChainId } from '@/core/types'

/**
 * Код JSON-RPC для внутренней ошибки узла.
 * Применяется, когда исходный код в ответе отсутствует.
 */
const JSON_RPC_INTERNAL_ERROR = -32603

/**
 * Преобразует ошибку ethers в ошибку предметной области.
 *
 * ЗАЧЕМ. Ошибки ethers — часть внешней библиотеки. Пропускать их наружу
 * значит связать весь домен с её текущим набором кодов: замена ethers
 * на viem потребовала бы правки каждого обработчика ошибок в приложении.
 *
 * Второе, более важное соображение: ошибки ethers несут технические
 * подробности, непригодные для показа пользователю. «CALL_EXCEPTION»
 * ничего не сообщает о том, что делать; «недостаточно средств» —
 * сообщает. Отображение кодов в доменные ошибки выполняется один раз
 * здесь, а не в каждом месте вызова.
 *
 * Разбор текста сообщений НЕ применяется: формулировки не входят
 * в публичный контракт ни ethers, ни узлов. Различаются только коды.
 */
export function mapProviderError(error: unknown, chainId: ChainId): Error {
  if (isError(error, 'INSUFFICIENT_FUNDS')) {
    /* Точные величины ethers не сообщает: узел возвращает только факт
       нехватки. Нули означают «неизвестно», и интерфейс обязан
       показать общее сообщение, а не «требуется 0». */
    return new InsufficientFundsError(0n, 0n)
  }

  if (isError(error, 'NONCE_EXPIRED')) {
    return new NonceTooLowError(0, 0)
  }

  if (isError(error, 'REPLACEMENT_UNDERPRICED')) {
    return new TransactionUnderpricedError()
  }

  if (isError(error, 'CALL_EXCEPTION')) {
    /* Вызов завершился откатом. При оценке газа это означает, что
       и сама транзакция откатится: отправлять её нельзя — газ спишется,
       а операция не выполнится. */
    return new GasEstimationFailedError(error.reason ?? 'the call reverted', {
      cause: error,
      /* Данные отката доходят до вызывающего кода. Библиотека
         раскрывает только стандартную причину `Error(string)`;
         собственные ошибки контрактов остаются четырёхбайтовым
         признаком, и потеряй мы его — сказать о причине отказа было
         бы нечего. */
      revertData: readRevertData(error),
    })
  }

  if (isError(error, 'NETWORK_ERROR') || isError(error, 'TIMEOUT')) {
    /* Узел недоступен либо не ответил вовремя. Это не ошибка операции,
       а отказ транспорта: вызывающий код вправе повторить попытку
       на другом узле. */
    return new ProviderUnavailableError(chainId, { cause: error })
  }

  if (isEthersError(error)) {
    /* Исходная ошибка JSON-RPC извлекается независимо от того, как её
       классифицировал ethers. Код узла информативнее собственного кода
       библиотеки: `-32005` сообщает о превышении лимита запросов,
       а `UNKNOWN_ERROR` не сообщает ничего. */
    const nested = extractJsonRpcError(error)

    if (nested !== null) {
      return new RpcError(nested.code, nested.message, error)
    }

    return new RpcError(JSON_RPC_INTERNAL_ERROR, error.shortMessage, error)
  }

  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Данные отката из ошибки библиотеки.
 *
 * Поле необязательное и недоверенное: узел мог не вернуть данных,
 * а библиотека — не заполнить поле. Проверяется и наличие, и тип.
 */
function readRevertData(error: unknown): string | null {
  const data = (error as { data?: unknown }).data

  return typeof data === 'string' && data.startsWith('0x') ? data : null
}

function isEthersError(error: unknown): error is EthersError {
  return (
    error instanceof Error &&
    typeof (error as Partial<EthersError>).code === 'string' &&
    typeof (error as Partial<EthersError>).shortMessage === 'string'
  )
}

/**
 * Извлекает исходную ошибку JSON-RPC из обёртки ethers.
 *
 * Библиотека кладёт ответ узла в разные места в зависимости от того,
 * на каком уровне произошёл сбой: при ошибке обработки полезной нагрузки —
 * в поле `error`, при ошибке транспорта — в `info.error`. Проверяются оба.
 *
 * Ответ недоверенный: поля могут отсутствовать либо иметь любой тип,
 * поэтому каждое проверяется отдельно.
 */
function extractJsonRpcError(error: EthersError): { code: number; message: string } | null {
  const candidates = [
    (error as { error?: unknown }).error,
    (error as { info?: { error?: unknown } }).info?.error,
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue
    }

    const { code, message } = candidate as { code?: unknown; message?: unknown }

    if (typeof code === 'number') {
      return {
        code,
        message: typeof message === 'string' ? message : error.shortMessage,
      }
    }
  }

  return null
}
