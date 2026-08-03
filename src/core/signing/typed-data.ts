import { TypedDataEncoder } from 'ethers'

import { InvalidArgumentError } from '@/core/errors'
import type { ITypedData } from '@/core/transaction'
import { toChainId, type ChainId, type HexString } from '@/core/types'

/**
 * Имя типа домена EIP-712.
 *
 * Присутствует в полезной нагрузке `eth_signTypedData_v4`, но НЕ должно
 * передаваться кодировщику: он выводит домен из отдельного аргумента
 * и выбрасывает исключение при обнаружении этого типа среди прочих.
 * Требование стандарта, а не особенность библиотеки.
 */
const EIP712_DOMAIN_TYPE = 'EIP712Domain'

/**
 * Убирает служебный тип домена из набора типов.
 *
 * Возвращается новый объект: полезная нагрузка приходит от dApp,
 * и изменять её на месте нельзя — вызывающий код может показывать
 * пользователю именно исходную структуру.
 */
export function stripDomainType(
  types: ITypedData['types'],
): Record<string, readonly { name: string; type: string }[]> {
  const result: Record<string, readonly { name: string; type: string }[]> = {}

  for (const [name, fields] of Object.entries(types)) {
    if (name !== EIP712_DOMAIN_TYPE) {
      result[name] = fields
    }
  }

  return result
}

/**
 * Проверяет пригодность структуры к подписи.
 *
 * ГЛАВНАЯ ПРОВЕРКА — соответствие `domain.chainId` активной сети.
 *
 * Подпись EIP-712 привязана к сети только через это поле. Структура
 * с чужим chainId, подписанная в одной сети, предъявляется контракту
 * в другой. Классический сценарий: пользователю показывают «вход
 * на сайт», а подписанное сообщение оказывается разрешением `Permit`
 * на распоряжение токенами в основной сети.
 *
 * Проверка выполняется ДО подписи и без исключений быть не может:
 * молчаливое приведение chainId к активному изменило бы подписываемые
 * данные, а отказ от проверки оставил бы атаку открытой.
 *
 * ЧЕГО ЭТА ПРОВЕРКА НЕ ДЕЛАЕТ. Она не оценивает смысл подписываемого.
 * Разрешение на неограниченное расходование токенов — корректная
 * структура с правильным chainId. Разбор опасных шаблонов
 * (`Permit`, `PermitSingle`, seaport-ордера) — задача слоя, который
 * показывает подтверждение пользователю.
 *
 * @throws InvalidArgumentError при несовпадении сети либо нарушении структуры.
 */
export function assertTypedDataMatchesChain(data: ITypedData, expectedChainId: ChainId): void {
  if (typeof data.primaryType !== 'string' || data.primaryType.length === 0) {
    throw new InvalidArgumentError('typedData.primaryType', 'the primary type is missing')
  }

  if (!Object.prototype.hasOwnProperty.call(data.types, data.primaryType)) {
    throw new InvalidArgumentError(
      'typedData.primaryType',
      `the type "${data.primaryType}" is missing from the type set`,
    )
  }

  const domainChainId = data.domain.chainId

  if (domainChainId === undefined) {
    /* Домен без chainId допустим стандартом, но для кошелька означает
       подпись, действительную во всех сетях сразу. Отказ намеренный. */
    throw new InvalidArgumentError(
      'typedData.domain.chainId',
      'a structure without a chain identifier is valid in every network at once',
    )
  }

  /* Значение приходит из полезной нагрузки dApp: оно объявлено как ChainId,
     но фактически может быть любым. Валидирующий конструктор отсеет
     некорректное до сравнения. */
  const actual = toChainId(domainChainId)

  if (actual !== expectedChainId) {
    throw new InvalidArgumentError(
      'typedData.domain.chainId',
      `the structure targets network ${actual.toString()}, ` +
        `while network ${expectedChainId.toString()} is active`,
    )
  }
}

/**
 * Вычисляет итоговый хэш структуры по EIP-712.
 *
 * Это ровно то значение, которое будет подписано. Вызывающий код обязан
 * иметь возможность получить его отдельно от подписи: пользователь должен
 * видеть, что именно подписывается, а сравнение хэша — единственный
 * способ убедиться, что показанное и подписанное совпадают.
 */
export function hashTypedData(data: ITypedData): HexString {
  return TypedDataEncoder.hash(
    toEthersDomain(data.domain),
    stripDomainType(data.types) as Record<string, { name: string; type: string }[]>,
    data.message as Record<string, unknown>,
  ) as HexString
}

/** Приводит домен к виду, понятному ethers. */
export function toEthersDomain(domain: ITypedData['domain']): Record<string, unknown> {
  return {
    ...(domain.name === undefined ? {} : { name: domain.name }),
    ...(domain.version === undefined ? {} : { version: domain.version }),
    ...(domain.chainId === undefined ? {} : { chainId: domain.chainId }),
    ...(domain.verifyingContract === undefined
      ? {}
      : { verifyingContract: domain.verifyingContract }),
    ...(domain.salt === undefined ? {} : { salt: domain.salt }),
  }
}
