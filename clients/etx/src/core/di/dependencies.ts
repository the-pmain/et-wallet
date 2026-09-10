import type { IEncryptionService } from '@/core/encryption'
import type { IKeyringFactory } from '@/core/keyring'
import type { IWalletCoreConfig, IWalletManager } from '@/core/manager'
import type { INetworkConfig } from '@/core/network'
import type { IProviderFactory } from '@/core/provider'
import type { IClock, ILogger } from '@/core/platform'
import type { IStorageService } from '@/core/storage'

/**
 * Внешние зависимости ядра.
 *
 * ВЫБОР СПОСОБА ВНЕДРЕНИЯ И ЕГО ОБОСНОВАНИЕ
 *
 * Применяется конструкторный DI с ручным composition root. Контейнер
 * (InversifyJS, tsyringe и аналоги) отвергнут по трём причинам:
 *
 * 1. Технический конфликт. Контейнеры на декораторах требуют
 *    `emitDecoratorMetadata` — неустранимую кодогенерацию. В tsconfig
 *    включён `erasableSyntaxOnly: true`, запрещающий такие конструкции.
 *
 * 2. Безопасность. Контейнер тянет `reflect-metadata` в бандл, который
 *    исполняется рядом с ключами. Каждая библиотека в этом периметре
 *    требует отдельного обоснования.
 *
 * 3. Потеря проверок. Контейнер разрешает зависимости в рантайме:
 *    незарегистрированная зависимость падает при запуске. Ручной
 *    composition root проверяется компилятором — пропущенная зависимость
 *    становится ошибкой сборки.
 *
 * ЧЕГО ЗДЕСЬ СОЗНАТЕЛЬНО НЕТ: источника случайности.
 *
 * `crypto.getRandomValues` зашит в реализацию жёстко. Возможность подменить
 * генератор случайных чисел в кошельке — это возможность сделать все ключи
 * предсказуемыми. Удобство тестирования такой цены не стоит.
 */
export interface IWalletCoreDependencies {
  /** Постоянное хранилище. Подменяется: IndexedDB, chrome.storage, память. */
  readonly storage: IStorageService

  /** Шифрование хранилища ключей. */
  readonly encryption: IEncryptionService

  /** Создание транспорта к RPC-узлам. */
  readonly providerFactory: IProviderFactory

  /**
   * Создание наборов ключей.
   *
   * Точка расширения для аппаратных кошельков: поддержка Ledger и Trezor
   * добавляется реализацией фабрики, без изменения `IWallet`.
   */
  readonly keyringFactory: IKeyringFactory

  /**
   * Источник времени и таймеров.
   *
   * Внедряется ради тестируемости автоблокировки: тест, который реально
   * ждёт пятнадцать минут, бесполезен.
   */
  readonly clock: IClock

  /** Журналирование с обязательной редакцией секретов. */
  readonly logger: ILogger

  /** Настройки поведения ядра. */
  readonly config: IWalletCoreConfig

  /**
   * Встроенные сети.
   *
   * Передаются извне, а не жёстко зашиты в ядро: набор поддерживаемых
   * сетей — продуктовое решение, которое может отличаться у веб-версии
   * и расширения.
   */
  readonly builtInNetworks: readonly INetworkConfig[]
}

/**
 * Composition root ядра.
 *
 * Единственная функция, знающая, как связать реализации между собой.
 * Всё остальное приложение получает готовый `IWalletManager` и не знает
 * ни об одной конкретной реализации.
 *
 * Реализация — следующий этап. Здесь зафиксирован только контракт.
 */
export type WalletCoreFactory = (dependencies: IWalletCoreDependencies) => IWalletManager
