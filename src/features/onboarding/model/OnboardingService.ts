import {
  InvalidArgumentError,
  MnemonicService,
  SETTINGS_KEY,
  STORAGE_NAMESPACE,
  VAULT_KEY,
  assertAcceptablePassword,
  checkMnemonic,
  isValidUsername,
  normalizeUsername,
  type IMnemonicCheck,
  type ISecretBuffer,
  type ISecureStorage,
  type IUnlockThrottleState,
  type UnlockThrottle,
  type MnemonicStrength,
} from '@/core'

import { ONBOARDING_STATE, type IOnboardingService, type OnboardingState } from './contracts'
import { WALLET_BROADCAST, type WalletBroadcast } from './WalletBroadcast'

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

  /**
   * Ограничитель попыток ввода пароля.
   *
   * Необязателен: без него сервис работает как прежде. Отсутствие
   * ограничителя — осознанный выбор вызывающего (например, в проверке,
   * где перебор задержек только замедлил бы прогон), а не умолчание
   * боевой сборки.
   */
  readonly unlockThrottle?: UnlockThrottle

  /**
   * Оповещение соседних вкладок.
   *
   * Необязательно: без него кошелёк работает как прежде, а вкладки
   * узнают о стирании только при перезагрузке.
   */
  readonly broadcast?: WalletBroadcast
}

/**
 * Отвергает непригодное имя.
 *
 * Пустое значение допустимо: имя необязательно, кошелёк работает
 * и без него — аккаунты тогда называются «Аккаунт 1». Отвергается
 * только то, что ломает интерфейс либо позволяет подделку.
 */
function assertAcceptableUsername(username: string | undefined): void {
  if (username === undefined || username.trim() === '') {
    return
  }

  if (!isValidUsername(username)) {
    throw new InvalidArgumentError('username', 'the name is not acceptable')
  }
}

/**
 * Операции онбординга поверх ядра.
 *
 * ХРАНИЛИЩЕ ПОСТОЯННОЕ: кошелёк переживает перезагрузку вкладки.
 * Сессионный ключ шифрования при этом в хранилище не попадает —
 * он живёт в памяти и исчезает вместе со вкладкой, поэтому после
 * перезагрузки кошелёк оказывается заблокированным.
 *
 * ПОДБОР ПАРОЛЯ ОГРАНИЧЕН ОДНИМ СЧЁТЧИКОМ на вход и на подтверждение
 * перед выдачей секретов: разные счётчики означали бы, что подбирающий
 * выберет форму без ограничения.
 */
export class OnboardingService implements IOnboardingService {
  readonly #secureStorage: ISecureStorage
  readonly #unlockThrottle: UnlockThrottle | null
  readonly #broadcast: WalletBroadcast | null
  readonly #mnemonicService = new MnemonicService()
  readonly #listeners = new Set<() => void>()

  #state: OnboardingState = ONBOARDING_STATE.Loading

  constructor(dependencies: IOnboardingServiceDependencies) {
    this.#secureStorage = dependencies.secureStorage
    this.#unlockThrottle = dependencies.unlockThrottle ?? null
    this.#broadcast = dependencies.broadcast ?? null
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

  async createWallet(mnemonic: ISecretBuffer, password: string, username?: string): Promise<void> {
    /* Пароль и имя проверяются до создания хранилища: иначе слабый
       пароль либо непригодное имя обнаружились бы после того, как ключи
       уже записаны, и кошелёк остался бы наполовину созданным. */
    assertAcceptablePassword(password)
    assertAcceptableUsername(username)

    await this.#secureStorage.initialize(password)
    await this.#storeMnemonic(mnemonic)
    await this.#storeUsername(username)

    this.#setState(ONBOARDING_STATE.Unlocked)
  }

  async importWallet(phrase: string, password: string, username?: string): Promise<void> {
    assertAcceptablePassword(password)
    assertAcceptableUsername(username)

    /* Фраза проверяется до создания хранилища по той же причине:
       непригодная фраза не должна оставлять после себя пустой кошелёк. */
    const mnemonic = this.#mnemonicService.fromPhrase(phrase)

    try {
      await this.#secureStorage.initialize(password)
      await this.#storeMnemonic(mnemonic)
      await this.#storeUsername(username)

      this.#setState(ONBOARDING_STATE.Unlocked)
    } finally {
      mnemonic.wipe()
    }
  }

  /**
   * Снимает блокировку.
   *
   * ВХОД ТРЕБУЕТ ТОЛЬКО ПАРОЛЯ, И ЭТО СОЗНАТЕЛЬНО. Имя пользователя
   * лежит в том же зашифрованном хранилище, поэтому сверить его можно
   * лишь после успешной расшифровки — то есть после того, как пароль
   * уже подошёл. Такая сверка ничего не защищает, а второе поле в форме
   * создавало бы впечатление второго фактора, которого нет.
   */
  async unlock(password: string): Promise<void> {
    /* Проверка ДО вывода ключа: иначе каждая закрытая попытка всё равно
       обходилась бы в 600 000 итераций PBKDF2, и ограничитель превратился
       бы в способ нагрузить процессор владельца. */
    await this.#unlockThrottle?.assertAllowed()

    try {
      await this.#secureStorage.unlock(password)
    } catch (error) {
      await this.#unlockThrottle?.recordFailure()

      throw error
    }

    await this.#unlockThrottle?.recordSuccess()
    this.#setState(ONBOARDING_STATE.Unlocked)
  }

  /**
   * Имя пользователя, если оно задано.
   *
   * ЧИТАЕТСЯ И ПРЕЖНИЙ КЛЮЧ С ПОЧТОЙ. Кошельки, созданные до замены,
   * хранят подпись там; без этого запаса их владельцы увидели бы
   * безликое «Аккаунт 1» вместо того, что вводили сами. Значение
   * при этом никуда не переписывается: миграция, выполняемая при
   * каждом чтении, — источник неожиданных записей в хранилище.
   */
  async getUsername(): Promise<string | null> {
    const username = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.UserName,
    )

    if (username !== null) {
      return username
    }

    return await this.#secureStorage.get<string>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UserEmail)
  }

  /**
   * Проверяет пароль перед необратимым действием.
   *
   * ОГРАНИЧИТЕЛЬ ТОТ ЖЕ, ЧТО У ВХОДА, И ЭТО НЕ СОВПАДЕНИЕ. Форма
   * подтверждения перед выдачей seed-фразы принимает пароль с той же
   * скоростью, что и экран разблокировки: без общего счётчика
   * подбирающий просто выбрал бы ту форму, где ограничения нет.
   *
   * @throws TooManyAttemptsError если ввод временно закрыт.
   */
  async verifyPassword(password: string): Promise<boolean> {
    await this.#unlockThrottle?.assertAllowed()

    const isValid = await this.#secureStorage.verifyPassword(password)

    if (isValid) {
      await this.#unlockThrottle?.recordSuccess()
    } else {
      await this.#unlockThrottle?.recordFailure()
    }

    return isValid
  }

  async getUnlockThrottleState(): Promise<IUnlockThrottleState> {
    return (await this.#unlockThrottle?.getState()) ?? { failedAttempts: 0, retryAfterMs: 0 }
  }

  lock(): void {
    this.#secureStorage.lock()

    this.#setState(ONBOARDING_STATE.Locked)
  }

  async reset(): Promise<void> {
    await this.#secureStorage.destroy()

    this.#setState(ONBOARDING_STATE.Uninitialized)

    /* ОСТАЛЬНЫЕ ВКЛАДКИ ОБЯЗАНЫ УЗНАТЬ. Хранилище общее, а память — нет:
       вкладка, пережившая стирание, продолжала бы показывать балансы
       и предлагать отправку, потому что ключи у неё в памяти. Владелец
       видел бы работающий кошелёк, которого на диске уже нет. */
    this.#broadcast?.post(WALLET_BROADCAST.Erased)
  }

  /**
   * Принимает стирание, выполненное в другой вкладке.
   *
   * ХРАНИЛИЩЕ НЕ ТРОГАЕТСЯ: его уже уничтожила та вкладка, а повторное
   * удаление ничего не изменит. Здесь снимается доступ в этой вкладке —
   * ключ шифрования забывается, состояние возвращается к «кошелька
   * нет».
   */
  handleExternalReset(): void {
    this.#secureStorage.lock()

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
   * Сохраняет имя пользователя.
   *
   * Записывается через защищённое хранилище: имя связывает устройство
   * с тем, как владелец себя называет, и лежать рядом с открытыми
   * настройками не должно.
   */
  async #storeUsername(username: string | undefined): Promise<void> {
    if (username === undefined || username.trim() === '') {
      return
    }

    await this.#secureStorage.set(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.UserName,
      normalizeUsername(username),
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
