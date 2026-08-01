import type { IMnemonicService } from '@/core/mnemonic'

import type { IMnemonicCheck } from './contracts'

/**
 * Проверяет фразу перед импортом.
 *
 * СВОБОДНАЯ ФУНКЦИЯ, А НЕ МЕТОД. Проверка нужна в двух местах с разными
 * возможностями: на экране импорта, где кошелька ещё нет и `BackupManager`
 * создать не из чего, и внутри самого `BackupManager`. Метод потребовал бы
 * либо второй реализации, либо создания менеджера ради одного вызова.
 *
 * ИСКЛЮЧЕНИЙ НЕ БРОСАЕТ. Вызывается на каждое нажатие клавиши: исключение
 * на недописанной фразе означало бы ошибку в консоли на каждую букву.
 */
export function checkMnemonic(phrase: string, mnemonicService: IMnemonicService): IMnemonicCheck {
  const validation = mnemonicService.validate(phrase)

  if (!validation.isValid) {
    /* Слабость энтропии проверяется только у действительной фразы:
       у недействительной энтропии просто нет. */
    return { ...validation, isGuessable: false }
  }

  return { ...validation, isGuessable: hasTrivialEntropy(phrase, mnemonicService) }
}

/**
 * Состоит ли энтропия фразы из одинаковых байтов.
 *
 * ЗАЧЕМ ЭТО НУЖНО. Общеизвестные тестовые фразы — `abandon ... about`
 * и подобные — это ровно нулевая энтропия, оформленная по BIP-39.
 * Их приватные ключи известны каждому, а поступления на их адреса
 * выводятся ботами за секунды. Импорт такой фразы с намерением хранить
 * на ней средства — потеря средств, отложенная до первого поступления.
 *
 * ПОЧЕМУ СРАВНЕНИЕ ЭНТРОПИИ, А НЕ СПИСОК ФРАЗ. Список пришлось бы
 * выписать по памяти — а константы, непроверяемые чтением, в этом проекте
 * запрещены: ошибка в одном слове превратила бы защиту в её видимость.
 * Свойство «все байты энтропии одинаковы» вычисляется и покрывает все
 * 256 таких наборов сразу, для любой длины фразы и любого словаря.
 *
 * ЭТО ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ. Импорт тестовой фразы — обычная работа
 * разработчика, и отказ выполнять её был бы ошибкой. Решение остаётся
 * за владельцем; наше дело — чтобы оно было осознанным.
 */
function hasTrivialEntropy(phrase: string, mnemonicService: IMnemonicService): boolean {
  let mnemonic

  try {
    mnemonic = mnemonicService.fromPhrase(phrase)
  } catch {
    /* Фраза прошла `validate`, но не прошла `fromPhrase`. Расхождение
       возможно только при ошибке в самой библиотеке; предупреждение
       о слабой энтропии в этом случае не выдаётся, а причину отказа
       сообщит импорт. */
    return false
  }

  try {
    const entropy = mnemonicService.toEntropy(mnemonic)

    try {
      return isUniform(entropy.bytes)
    } finally {
      entropy.wipe()
    }
  } catch {
    return false
  } finally {
    mnemonic.wipe()
  }
}

/** Все ли байты буфера равны между собой. Пустой буфер однородным не считается. */
function isUniform(bytes: Uint8Array): boolean {
  const first = bytes[0]

  if (first === undefined) {
    return false
  }

  return bytes.every((byte) => byte === first)
}
