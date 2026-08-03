import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/** Ошибки работы с ключами, адресами и путями деривации. */

/**
 * Путь деривации не соответствует формату BIP-32.
 *
 * Сообщение содержит сам путь: он не является секретом. Путь описывает
 * позицию ключа в дереве, но не даёт никакой информации о самом ключе.
 */
export class InvalidDerivationPathError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidDerivationPath

  constructor(path: string, reason: string) {
    super(`Invalid derivation path "${path}": ${reason}`)
  }
}

/**
 * Расширенный ключ не разбирается.
 *
 * Сообщение НЕ содержит самого ключа: xprv является секретом, дающим доступ
 * ко всему поддереву. Даже частичное попадание его в журнал недопустимо.
 */
export class InvalidExtendedKeyError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidExtendedKey

  constructor(reason: string, options?: ErrorOptions) {
    super(`Extended key is invalid: ${reason}`, options)
  }
}

/** Строка не является адресом EVM. */
export class InvalidAddressError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidAddress

  constructor(value: string) {
    super(`The value "${value}" is not an EVM address.`)
  }
}

/**
 * Контрольная сумма адреса по EIP-55 не сходится.
 *
 * Отдельная ошибка, а не «некорректный адрес», потому что означает другое:
 * набор символов правильный, но регистр букв им не соответствует. Практически
 * всегда это опечатка при ручном вводе либо повреждение при копировании.
 *
 * Молча привести такой адрес к правильному регистру НЕЛЬЗЯ: в этом случае
 * EIP-55 перестаёт выполнять свою единственную задачу — ловить опечатки
 * до отправки средств на несуществующий адрес.
 */
export class AddressChecksumMismatchError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.AddressChecksumMismatch

  constructor(value: string) {
    super(
      `The checksum of the address "${value}" does not match. ` +
        'Check the address: it may contain a typo.',
    )
  }
}

/** Публичный ключ имеет недопустимую длину либо не лежит на кривой. */
export class InvalidPublicKeyError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidPublicKey

  constructor(reason: string, options?: ErrorOptions) {
    super(`Public key is invalid: ${reason}`, options)
  }
}
