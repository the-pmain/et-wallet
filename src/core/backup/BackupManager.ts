import type { IAccountManager } from '@/core/account'
import type { ISecretBuffer, ISecureStorage } from '@/core/encryption'
import {
  AccountNotFoundError,
  ExportNotPermittedError,
  InvalidPasswordError,
  WalletNotInitializedError,
} from '@/core/errors'
import type { IHDWalletService } from '@/core/hdwallet'
import { KEYRING_TYPE } from '@/core/keyring'
import { normalizeMnemonicInput, type IMnemonicService } from '@/core/mnemonic'
import type { ILogger } from '@/core/platform'
import {
  EXPORT_KIND,
  WALLET_SCOPE,
  accountExportRequest,
  hdAccountScope,
  importedKeyScope,
  privateKeyExportRequest,
  type ExportRisk,
  type IExportGuard,
  type IExportRequest,
  type IExportRiskAssessment,
} from '@/core/security'
import { STORAGE_NAMESPACE, VAULT_KEY } from '@/core/storage'
import type { AccountId } from '@/core/types'

import { checkMnemonic } from './check-mnemonic'
import type { IBackupManager, IMnemonicCheck } from './contracts'

const SERVICE_NAME = 'BackupManager'

/** Зависимости менеджера. Внедряются конструктором. */
export interface IBackupManagerDependencies {
  /** Источник фразы и единственное место проверки пароля. */
  readonly secureStorage: ISecureStorage

  readonly mnemonicService: IMnemonicService

  /** Оценка риска и выдача разрешений. Обойти его нельзя. */
  readonly exportGuard: IExportGuard

  /** Владелец аккаунтов. Выдачу приватных ключей выполняет он. */
  readonly accounts: IAccountManager

  /** Нужен ради пути аккаунта: он определяет область экспорта. */
  readonly hdWallet: IHDWalletService

  readonly logger: ILogger
}

/**
 * Резервное копирование секретов кошелька.
 *
 * ЧТО ЭТОТ КЛАСС ДЕЛАЕТ. Сводит воедино три независимых требования,
 * каждое из которых по отдельности легко забыть: подтверждение паролем,
 * разрешение под показанный уровень риска и запись в журнал экспортов.
 * Пропуск любого из них не даёт ни ошибки сборки, ни падения теста —
 * он молча превращает защиту в её видимость.
 *
 * ЧЕГО ЭТОТ КЛАСС НЕ ДЕЛАЕТ. Не хранит секретов, не кэширует фразу,
 * не создаёт файлов. Выданный буфер принадлежит вызывающему, и затирать
 * его обязан он.
 *
 * ПОЧЕМУ ФАЙЛОВОЙ РЕЗЕРВНОЙ КОПИИ НЕТ. Зашифрованный файл с seed-фразой
 * стоек ровно настолько, насколько стоек пароль, и попадает туда, куда
 * пользователь его положит: в загрузки, в облачную синхронизацию папки,
 * в корзину. Бумага такой особенности не имеет. Файл — это подбор пароля
 * без ограничения скорости и без нашего ведома.
 */
export class BackupManager implements IBackupManager {
  readonly #secureStorage: ISecureStorage
  readonly #mnemonicService: IMnemonicService
  readonly #exportGuard: IExportGuard
  readonly #accounts: IAccountManager
  readonly #hdWallet: IHDWalletService
  readonly #logger: ILogger

  constructor(dependencies: IBackupManagerDependencies) {
    this.#secureStorage = dependencies.secureStorage
    this.#mnemonicService = dependencies.mnemonicService
    this.#exportGuard = dependencies.exportGuard
    this.#accounts = dependencies.accounts
    this.#hdWallet = dependencies.hdWallet
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  async assessMnemonicExport(): Promise<IExportRiskAssessment> {
    return await this.#exportGuard.assess(BackupManager.#mnemonicRequest())
  }

  /**
   * Выдаёт мнемоническую фразу.
   *
   * ПОРЯДОК ДЕЙСТВИЙ ВЫБРАН СОЗНАТЕЛЬНО: сначала пароль, затем разрешение.
   * `confirm` пишет в журнал экспортов до выдачи разрешения, и обратный
   * порядок означал бы запись «фраза выгружена» на каждую опечатку
   * в пароле. Журнал, полный несостоявшихся выгрузок, завышал бы оценку
   * риска последующих операций — то есть учил бы не читать предупреждения.
   */
  async exportMnemonic(password: string, acknowledgedRisk: ExportRisk): Promise<ISecretBuffer> {
    await this.#requirePassword(password)

    /* Разрешение не передаётся никуда дальше: выдачу выполняет сам
       менеджер. Ценность вызова не в объекте разрешения, а в двух его
       побочных действиях — сверке подтверждённого риска с фактическим
       и записи в журнал. */
    const permit = await this.#exportGuard.confirm(
      BackupManager.#mnemonicRequest(),
      acknowledgedRisk,
    )

    const phrase = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Vault,
      VAULT_KEY.Mnemonic,
    )

    if (phrase === null) {
      throw new WalletNotInitializedError()
    }

    /* Гасится до выдачи секрета: исключение при выдаче не должно
       оставлять действующее разрешение. */
    permit.consume()

    this.#logger.warn('Seed phrase revealed', {
      note: 'anyone who obtains it can reproduce the whole wallet',
    })

    /* Разбор фразы заново, а не возврат строки из хранилища: вызывающий
       получает затираемый буфер, а не ещё одну неочищаемую строку. */
    return this.#mnemonicService.fromPhrase(phrase)
  }

  /**
   * Сверяет переписанную фразу с хранимой.
   *
   * ЗАЧЕМ ЭТО ОТДЕЛЬНЫЙ МЕТОД, А НЕ ПОВТОРНЫЙ ПОКАЗ ФРАЗЫ. Единственным
   * способом убедиться в правильности записи был показ фразы и сверка
   * глазами — то есть лишнее раскрытие ровно того, что мы защищаем,
   * ради проверки, которую можно выполнить не раскрывая ничего.
   * Ошибка при переписывании не гипотетична: обнаруживается она при
   * восстановлении, когда исправить уже нечего.
   *
   * ПАРОЛЬ ОБЯЗАТЕЛЕН. Без него метод превращается в оракул: нашедший
   * бумагу с несколькими смазанными словами перебирал бы остаток,
   * получая ответ «да/нет» на каждую догадку. Владельцу требование
   * не стоит ничего — у него пароль есть, — а постороннему, у которого
   * пароль есть, метод не даёт ничего нового: фразу он и так получит
   * выгрузкой.
   *
   * СРАВНЕНИЕ БЕЗ ДОСРОЧНОГО ВЫХОДА. Обычное сравнение строк
   * возвращается на первом различии, и время ответа выдаёт число
   * совпавших символов — подбирать фразу можно было бы по одному слову.
   * Здесь просматриваются все байты независимо от результата.
   *
   * ОТВЕТ — ОДИН БИТ. Указание, какое слово отличается, помогло бы
   * и владельцу, и подбирающему, но владельцу есть куда посмотреть:
   * у него бумага. Замечания о самой введённой фразе (слова нет
   * в словаре, контрольная сумма не сходится) выдаёт `checkMnemonic`
   * и они о хранимой фразе не говорят ничего.
   *
   * В ЖУРНАЛ ЭКСПОРТОВ НЕ ПИШЕТСЯ: секрет не выдан, а запись завышала бы
   * оценку риска последующих настоящих выгрузок.
   *
   * @throws InvalidPasswordError, WalletNotInitializedError
   */
  async verifyMnemonicBackup(phrase: string, password: string): Promise<boolean> {
    await this.#requirePassword(password)

    const stored = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Vault,
      VAULT_KEY.Mnemonic,
    )

    if (stored === null) {
      throw new WalletNotInitializedError()
    }

    const matches = equalInConstantTime(
      normalizeMnemonicInput(stored),
      normalizeMnemonicInput(phrase),
    )

    /* Содержимое в журнал не попадает: ни фраза, ни её часть, ни длина. */
    this.#logger.info('The written copy of the seed phrase was checked', { matches })

    return matches
  }

  async assessPrivateKeyExport(id: AccountId): Promise<IExportRiskAssessment> {
    return await this.#exportGuard.assess(this.#privateKeyRequest(id))
  }

  /**
   * Выдаёт приватный ключ аккаунта.
   *
   * ПАРОЛЬ ПРОВЕРЯЕТСЯ ДВАЖДЫ — здесь и внутри `AccountManager`. Убрать
   * ни одну из проверок нельзя. Первая нужна, чтобы неверный пароль
   * не оставлял записи в журнале экспортов (см. `exportMnemonic`);
   * вторая — собственная гарантия `AccountManager`, действующая для всех
   * его вызывающих, а не только для этого. Цена — двойной вывод ключа
   * из пароля, около секунды на осознанном действии пользователя.
   */
  async exportPrivateKey(
    id: AccountId,
    password: string,
    acknowledgedRisk: ExportRisk,
  ): Promise<ISecretBuffer> {
    const request = this.#privateKeyRequest(id)

    await this.#requirePassword(password)

    const permit = await this.#exportGuard.confirm(request, acknowledgedRisk)

    this.#logger.warn('Account private key revealed', {
      note: 'the address passes irreversibly under the control of whoever receives the key',
    })

    return await this.#accounts.exportPrivateKey(id, password, permit)
  }

  checkMnemonic(phrase: string): IMnemonicCheck {
    return checkMnemonic(phrase, this.#mnemonicService)
  }

  /** Проверяет пароль, не выдавая расшифрованного содержимого. */
  async #requirePassword(password: string): Promise<void> {
    if (!(await this.#secureStorage.verifyPassword(password))) {
      throw new InvalidPasswordError()
    }
  }

  /**
   * Строит запрос на выдачу приватного ключа конкретного аккаунта.
   *
   * Область различает импортированный ключ и ветвь HD-дерева: приравняв
   * их, мы помечали бы HD-аккаунт скомпрометированным из-за экспорта
   * ключа, не имеющего к нему отношения.
   */
  #privateKeyRequest(id: AccountId): IExportRequest {
    const account = this.#accounts.getById(id)

    if (account === null) {
      throw new AccountNotFoundError(id)
    }

    if (account.source === KEYRING_TYPE.PrivateKey) {
      return privateKeyExportRequest(importedKeyScope(account.keyringId), null)
    }

    if (account.addressIndex === null) {
      throw new ExportNotPermittedError(
        `an account of type "${account.source}" holds no extractable private key`,
      )
    }

    return privateKeyExportRequest(hdAccountScope(this.#hdWallet.accountPath), account.addressIndex)
  }

  static #mnemonicRequest(): IExportRequest {
    return accountExportRequest(EXPORT_KIND.Mnemonic, WALLET_SCOPE)
  }
}

/**
 * Сравнивает две строки, не выходя на первом различии.
 *
 * Разница в длине скрыта быть не может — она видна и по времени ввода, —
 * зато позиция первого различия не выдаётся ничем: просматриваются все
 * символы более длинной строки.
 */
function equalInConstantTime(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length

  for (let index = 0; index < length; index += 1) {
    /* Выход за границы даёт NaN у `charCodeAt`, поэтому берётся
       заведомо отсутствующий в тексте код. */
    difference |= (left.codePointAt(index) ?? -1) ^ (right.codePointAt(index) ?? -2)
  }

  return difference === 0
}
