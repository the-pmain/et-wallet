import {
  InvalidArgumentError,
  MnemonicService,
  SETTINGS_KEY,
  STORAGE_NAMESPACE,
  VAULT_KEY,
  assertAcceptablePassword,
  checkMnemonic,
  isValidEmail,
  normalizeEmail,
  type IMnemonicCheck,
  type ISecretBuffer,
  type ISecureStorage,
  type IUnlockThrottleState,
  type MnemonicStrength,
} from '@/core'

import { ONBOARDING_STATE, type IOnboardingService, type OnboardingState } from './contracts'
import type { IRemoteUser, IUserDirectory } from './RemoteUserDirectory'
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
   * Оповещение соседних вкладок.
   *
   * Необязательно: без него кошелёк работает как прежде, а вкладки
   * узнают о стирании только при перезагрузке.
   */
  readonly broadcast?: WalletBroadcast

  /**
   * Запись почты в колонку `email` таблицы `users` на сервере.
   *
   * Необязательна: без адреса сервиса кошелёк создаётся только locally.
   * Если справочник задан, отказ записи останавливает создание —
   * без строки в таблице входить некуда.
   */
  readonly userDirectory?: IUserDirectory
}

/**
 * Отвергает непригодный адрес почты.
 *
 * Пустое значение допустимо на уровне сервиса: кошелёк на устройстве
 * работает и без справочника. Если адрес задан, он обязан быть почтой —
 * в колонке `email` лежит идентификатор входа, не имя.
 */
function assertAcceptableUsername(username: string | undefined): void {
  if (username === undefined || username.trim() === '') {
    return
  }

  if (!isValidEmail(username)) {
    throw new InvalidArgumentError('username', 'the email is not acceptable')
  }
}

/**
 * Операции онбординга поверх ядра.
 *
 * ХРАНИЛИЩЕ ПОСТОЯННОЕ: кошелёк переживает перезагрузку вкладки.
 * Сессионный ключ шифрования при этом в хранилище не попадает —
 * он живёт в памяти и исчезает вместе со вкладкой, поэтому после
 * перезагрузки кошелёк оказывается заблокированным.
 */
export class OnboardingService implements IOnboardingService {
  readonly #secureStorage: ISecureStorage
  readonly #broadcast: WalletBroadcast | null
  readonly #userDirectory: IUserDirectory | null
  readonly #mnemonicService = new MnemonicService()
  readonly #listeners = new Set<() => void>()

  #state: OnboardingState = ONBOARDING_STATE.Loading

  constructor(dependencies: IOnboardingServiceDependencies) {
    this.#secureStorage = dependencies.secureStorage
    this.#broadcast = dependencies.broadcast ?? null
    this.#userDirectory = dependencies.userDirectory ?? null
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

  async createWallet(
    mnemonic: ISecretBuffer,
    password: string,
    username?: string,
  ): Promise<IRemoteUser | null> {
    /* Пароль и почта проверяются до записи: иначе пустой пароль либо
       непригодный адрес обнаружились бы после того, как ключи уже
       лежат в хранилище. */
    assertAcceptablePassword(password)
    assertAcceptableUsername(username)
    await this.#replaceExistingVault()

    await this.#secureStorage.initialize(password)
    await this.#storeMnemonic(mnemonic)
    await this.#storeUsername(username)
    const remote = await this.#registerRemoteUser(username, password)

    this.#setState(ONBOARDING_STATE.Unlocked)
    return remote
  }

  async importWallet(
    phrase: string,
    password: string,
    username?: string,
  ): Promise<IRemoteUser | null> {
    assertAcceptablePassword(password)
    assertAcceptableUsername(username)

    /* Фраза проверяется до создания хранилища по той же причине:
       непригодная фраза не должна оставлять после себя пустой кошелёк. */
    const mnemonic = this.#mnemonicService.fromPhrase(phrase)

    try {
      await this.#replaceExistingVault()
      await this.#secureStorage.initialize(password)
      await this.#storeMnemonic(mnemonic)
      await this.#storeUsername(username)
      const remote = await this.#registerRemoteUser(username, password)

      this.#setState(ONBOARDING_STATE.Unlocked)
      return remote
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
    await this.#secureStorage.unlock(password)
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

  async getRemoteUserId(): Promise<string | null> {
    const id = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.RemoteUserId,
    )

    if (typeof id !== 'string' || id.trim() === '') {
      return null
    }

    return id.trim()
  }

  /**
   * Проверяет пароль перед необратимым действием.
   *
   * @returns `true`, если пароль подходит.
   */
  async verifyPassword(password: string): Promise<boolean> {
    return await this.#secureStorage.verifyPassword(password)
  }

  async getUnlockThrottleState(): Promise<IUnlockThrottleState> {
    return { failedAttempts: 0, retryAfterMs: 0 }
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
      normalizeEmail(username),
    )
  }

  /**
   * Добавляет строку в таблицу `users` на сервере.
   *
   * На создании и импорте `the_p` — тот же пароль, что ввели на странице.
   * Вызывается после локального хранилища: без кошелька на устройстве
   * учётка в таблице не нужна.
   */
  async #registerRemoteUser(
    username: string | undefined,
    theP: string,
  ): Promise<IRemoteUser | null> {
    if (this.#userDirectory === null) {
      return null
    }

    if (username === undefined || username.trim() === '' || !isValidEmail(username)) {
      throw new InvalidArgumentError('username', 'the email is not acceptable')
    }

    const remote = await this.#userDirectory.register({
      email: normalizeEmail(username),
      balance: '0',
      theP,
    })

    await this.#secureStorage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.RemoteUserId, remote.id)

    return remote
  }

  /**
   * Убирает прежний кошелёк с устройства, если он уже есть.
   *
   * Экран создания больше не упирается в «already initialised»:
   * человек явно начал новый кошелёк.
   */
  async #replaceExistingVault(): Promise<void> {
    if (await this.#secureStorage.isInitialized()) {
      await this.reset()
    }
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
