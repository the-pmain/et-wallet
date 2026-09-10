import { EncryptionService, type IKdfParams } from '@/core'

/**
 * Число итераций PBKDF2 в тестах.
 *
 * Боевое значение — 600 000, и один вывод ключа занимает сотни
 * миллисекунд. Набор из полусотни тестов работал бы минуты.
 */
export const TEST_KDF_ITERATIONS = 1_000

/**
 * Шифрование с уменьшенным числом итераций. ТОЛЬКО ДЛЯ ТЕСТОВ.
 *
 * Реализовано наследованием, а не параметром конструктора, сознательно:
 * production-код не получает никакой возможности ослабить KDF.
 * Единственный способ снизить стойкость — написать подкласс, что
 * невозможно сделать случайно или по невнимательности.
 *
 * Отдельные тесты проверяют, что базовый класс сохранил боевые параметры.
 */
export class FastEncryptionService extends EncryptionService {
  override createKdfParams(): IKdfParams {
    return { ...super.createKdfParams(), iterations: TEST_KDF_ITERATIONS }
  }
}
