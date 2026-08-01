import {
  InvalidArgumentError,
  InvalidPasswordError,
  MnemonicService,
  SETTINGS_KEY,
  STORAGE_NAMESPACE,
  VAULT_KEY,
  areEmailsEqual,
  assertAcceptablePassword,
  checkMnemonic,
  isValidEmail,
  normalizeEmail,
  type IMnemonicCheck,
  type ISecretBuffer,
  type ISecureStorage,
  type MnemonicStrength,
} from '@/core'

import { ONBOARDING_STATE, type IOnboardingService, type OnboardingState } from './contracts'

/**
 * Зависимости сервиса.
 *
 * ПРИНИМАЕТСЯ ГОТОВОЕ ЗАЩИЩЁННОЕ ХРАНИЛИЩЕ, А НЕ СОСТАВНЫЕ ЧАСТИ.
 * Раньше сервис собирал `SecureStorage` внутри себя, и это делало его
 * единственным владельцем сессии дешифрования. Экрану кошелька нужна
 * та же самая сессия: пересоздать `SecureStorage` рядом означало бы
 * второй ключ шифрования и невозможность прочитать записанное первым.
 * Владение поднято в composition root, оба потребителя получают один
 * экземпляр.
 */
export interface IOnboardingServiceDependencies {
  readonly secureStorage: ISecureStorage
}

/**
 * Операции онбординга поверх ядра.
 *
 * СОСТОЯНИЕ ХРАНИЛИЩА НА ЭТОМ ЭТАПЕ. Постоянное хранилище (IndexedDB)
 * ещё не реализовано, поэтому в приложении используется хранилище
 * в памяти: кошелёк живёт до перезагрузки страницы. Криптография при
 * этом настоящая — шифрование, вывод ключа, BIP-39 и BIP-32 работают
 * ровно так же, как будут работать с постоянным хранилищем.
 */
/**
 * Отвергает адрес, составленный неверно.
 *
 * Пустое значение допустимо: адрес необязателен, кошелёк работает
 * и без него. Отвергается именно опечатка — адрес, который пользователь
 * ввёл, но который адресом не является.
 */
function assertAcceptableEmail(email: string | undefined): void {
  if (email === undefined || email.trim() === '') {
    return
  }

  if (!isValidEmail(email)) {
    throw new InvalidArgumentError('email', 'адрес электронной почты составлен неверно')
  }
}

export class OnboardingService implements IOnboardingService {
  readonly #secureStorage: ISecureStorage
  readonly #mnemonicService = new MnemonicService()
  readonly #listeners = new Set<() => void>()

  #state: OnboardingState = ONBOARDING_STATE.Loading

  constructor(dependencies: IOnboardingServiceDependencies) {
    this.#secureStorage = dependencies.secureStorage
  }

  getState(): OnboardingState {
    return this.#state
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  async initialize(): Promise<void> {
    const isInitialized = await this.#secureStorage.isInitialized()

    this.#setState(
      isInitialized
        ? this.#secureStorage.isUnlocked
          ? ONBOARDING_STATE.Unlocked
          : ONBOARDING_STATE.Locked
        : ONBOARDING_STATE.Uninitialized,
    )
  }

  generateMnemonic(strength: MnemonicStrength): ISecretBuffer {
    return this.#mnemonicService.generate(strength)
  }

  toWords(mnemonic: ISecretBuffer): readonly string[] {
    return this.#mnemonicService.toWords(mnemonic)
  }

  checkMnemonic(phrase: string): IMnemonicCheck {
    return checkMnemonic(phrase, this.#mnemonicService)
  }

  findWordsByPrefix(prefix: string, limit?: number): readonly string[] {
    return this.#mnemonicService.findWordsByPrefix(prefix, limit)
  }

  async createWallet(mnemonic: ISecretBuffer, password: string, email?: string): Promise<void> {
    /* Пароль и адрес проверяются до создания хранилища: иначе слабый
       пароль либо опечатка в адресе обнаружились бы после того, как
       ключи уже записаны, и кошелёк остался бы наполовину созданным. */
    assertAcceptablePassword(password)
    assertAcceptableEmail(email)

    await this.#secureStorage.initialize(password)
    await this.#storeMnemonic(mnemonic)
    await this.#storeEmail(email)

    this.#setState(ONBOARDING_STATE.Unlocked)
  }

  async importWallet(phrase: string, password: string, email?: string): Promise<void> {
    assertAcceptablePassword(password)
    assertAcceptableEmail(email)

    /* Фраза проверяется до создания хранилища по той же причине:
       непригодная фраза не должна оставлять после себя пустой кошелёк. */
    const mnemonic = this.#mnemonicService.fromPhrase(phrase)

    try {
      await this.#secureStorage.initialize(password)
      await this.#storeMnemonic(mnemonic)
      await this.#storeEmail(email)

      this.#setState(ONBOARDING_STATE.Unlocked)
    } finally {
      mnemonic.wipe()
    }
  }

  /**
   * Снимает блокировку.
   *
   * ПОРЯДОК ПРОВЕРОК ОБРАТЕН ПРИВЫЧНОМУ, И ЭТО НЕИЗБЕЖНО. Сохранённый
   * адрес лежит в зашифрованном хранилище, поэтому сверить его можно
   * только после успешной расшифровки. Значит, защиту даёт пароль,
   * а адрес лишь помогает не перепутать кошельки.
   *
   * ПРИ НЕСОВПАДЕНИИ ХРАНИЛИЩЕ ЗАКРЫВАЕТСЯ ОБРАТНО. Оставить его
   * открытым значило бы, что сверка не значит ничего.
   */
  async unlock(password: string, email?: string): Promise<void> {
    await this.#secureStorage.unlock(password)

    if (email !== undefined && email.trim() !== '') {
      const stored = await this.getEmail()

      if (stored !== null && !areEmailsEqual(stored, email)) {
        this.#secureStorage.lock()

        /* Та же ошибка, что и при неверном пароле: сообщение,
           различающее «пароль верен, адрес нет», подсказывало бы
           подбирающему, что половина пары угадана. */
        throw new InvalidPasswordError()
      }
    }

    this.#setState(ONBOARDING_STATE.Unlocked)
  }

  async getEmail(): Promise<string | null> {
    return await this.#secureStorage.get<string>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UserEmail)
  }

  async verifyPassword(password: string): Promise<boolean> {
    return await this.#secureStorage.verifyPassword(password)
  }

  lock(): void {
    this.#secureStorage.lock()

    this.#setState(ONBOARDING_STATE.Locked)
  }

  async reset(): Promise<void> {
    await this.#secureStorage.destroy()

    this.#setState(ONBOARDING_STATE.Uninitialized)
  }

  /**
   * Сохраняет фразу в зашифрованном виде.
   *
   * Фраза записывается строкой: `SecureStorage` сериализует значения
   * через JSON, где `Uint8Array` превращается в объект с числовыми
   * ключами и молча портится. Строка на короткое время существует
   * в куче неочищаемой — ограничение, общее для всей работы
   * с секретами в JavaScript.
   */
  async #storeMnemonic(mnemonic: ISecretBuffer): Promise<void> {
    await this.#secureStorage.set(
      STORAGE_NAMESPACE.Vault,
      VAULT_KEY.Mnemonic,
      this.#mnemonicService.revealPhrase(mnemonic),
    )
  }

  /**
   * Сохраняет адрес электронной почты.
   *
   * Записывается через защищённое хранилище: это персональные данные,
   * связывающие устройство с личностью, и лежать рядом с открытыми
   * настройками они не должны.
   */
  async #storeEmail(email: string | undefined): Promise<void> {
    if (email === undefined || email.trim() === '') {
      return
    }

    await this.#secureStorage.set(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.UserEmail,
      normalizeEmail(email),
    )
  }

  #setState(state: OnboardingState): void {
    if (this.#state === state) {
      return
    }

    this.#state = state

    for (const listener of [...this.#listeners]) {
      listener()
    }
  }
}
