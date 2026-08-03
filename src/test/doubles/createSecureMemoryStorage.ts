import { SecureStorage } from '@/core/encryption'
import { MemoryStorageService } from '@/core/storage'

import { FastEncryptionService } from './FastEncryptionService'

/**
 * Готовое зашифрованное хранилище поверх памяти.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПОМОЩНИК. Проверки, которым нужен любой репозиторий
 * поверх шифрования, повторяли одни и те же четыре строки: создать
 * память, обернуть в `SecureStorage`, подставить быстрое шифрование,
 * не забыть `initialize`. Пропущенный последний шаг даёт отказ
 * «хранилище заблокировано» посреди проверки, которая про блокировку
 * ничего не проверяет.
 *
 * ШИФРОВАНИЕ УСКОРЕННОЕ. Настоящие 600 000 итераций PBKDF2 в каждой
 * проверке превратили бы прогон в минуты; стойкость проверяется там,
 * где она предмет проверки.
 */
/** Пароль тестового хранилища. Один на все проверки: секретом не является. */
const PASSWORD = 'Korova-7-Luna!'

export async function createSecureMemoryStorage(
  storage: MemoryStorageService = new MemoryStorageService(),
): Promise<SecureStorage> {
  const secure = new SecureStorage(storage, new FastEncryptionService())

  /* Та же память может уже нести заголовок — например, когда проверка
     пересоздаёт сервисы поверх прежнего хранилища, чтобы убедиться,
     что данные пережили перезапуск. Повторная инициализация в этом
     случае отказала бы, а нужен именно доступ. */
  if (await secure.isInitialized()) {
    await secure.unlock(PASSWORD)
  } else {
    await secure.initialize(PASSWORD)
  }

  return secure
}
