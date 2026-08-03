import { HARDENED_OFFSET } from '@/core/hdwallet'
import type { DerivationPath } from '@/core/types'

import { HardwareDeviceError } from './errors'

/**
 * Наибольшее число уровней пути.
 *
 * Ограничение устройства: длина пути передаётся одним байтом, а сам
 * путь занимает четыре байта на уровень и обязан помещаться в команду
 * вместе с остальными данными. Десять уровней покрывают все стандарты
 * с большим запасом: BIP-44 использует пять.
 */
const MAX_DEPTH = 10

/** Наибольшее значение уровня без признака закалки. */
const MAX_INDEX = HARDENED_OFFSET - 1

/**
 * Переводит путь деривации в вид, понятный устройству.
 *
 * ФОРМАТ. Один байт числа уровней, затем каждый уровень четырьмя
 * байтами со старшего конца. Закалённый уровень отличается старшим
 * установленным битом — тем же признаком, что и в BIP-32.
 *
 * РАЗБОР СТРОГИЙ. Путь определяет, каким ключом устройство подпишет
 * транзакцию. Ошибка здесь означает подпись не тем ключом, то есть
 * отправку не с того адреса, и обнаружится она уже в цепи. Поэтому
 * любое отклонение — отказ, а не попытка додумать.
 */
export function encodeDerivationPath(path: DerivationPath): Uint8Array {
  const levels = parseLevels(path)
  const encoded = new Uint8Array(1 + levels.length * 4)

  encoded[0] = levels.length

  levels.forEach((level, index) => {
    const offset = 1 + index * 4

    encoded[offset] = (level >>> 24) & 0xff
    encoded[offset + 1] = (level >>> 16) & 0xff
    encoded[offset + 2] = (level >>> 8) & 0xff
    encoded[offset + 3] = level & 0xff
  })

  return encoded
}

/** Разбирает путь на числовые уровни. */
function parseLevels(path: DerivationPath): readonly number[] {
  const parts = path.split('/')

  if (parts[0] !== 'm') {
    throw new HardwareDeviceError(`the derivation path must start with "m": ${path}`)
  }

  const levels = parts.slice(1)

  if (levels.length === 0 || levels.length > MAX_DEPTH) {
    throw new HardwareDeviceError(`the derivation path has an unsupported depth: ${path}`)
  }

  return levels.map((level) => parseLevel(level, path))
}

function parseLevel(level: string, path: DerivationPath): number {
  const isHardened = level.endsWith("'") || level.endsWith('h')
  const digits = isHardened ? level.slice(0, -1) : level

  /* Проверка строкой, а не через `Number`: тот принимает
     шестнадцатеричную запись, знаки и пробелы, и «0x10» превратилось бы
     в шестнадцатый аккаунт вместо отказа. */
  if (!/^\d+$/u.test(digits)) {
    throw new HardwareDeviceError(`the derivation path contains a malformed level: ${path}`)
  }

  const index = Number(digits)

  if (index > MAX_INDEX) {
    throw new HardwareDeviceError(`the derivation path contains a level out of range: ${path}`)
  }

  return isHardened ? index + HARDENED_OFFSET : index
}
