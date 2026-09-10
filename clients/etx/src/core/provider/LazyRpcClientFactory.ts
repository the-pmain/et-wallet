import type { INetworkConfig } from '@/core/network'
import type { ILogger } from '@/core/platform'

import type { IProvider, IProviderFactory } from './contracts'

/** Зависимости фабрики. Совпадают с зависимостями настоящей. */
export interface ILazyRpcClientFactoryDependencies {
  readonly logger: ILogger
}

/**
 * Фабрика соединений, подгружающая транспорт при первом обращении.
 *
 * ЗАЧЕМ. `RpcClient` построен поверх ethers, а ethers — самая тяжёлая
 * зависимость приложения: около 250 КБ до сжатия. Настоящая фабрика
 * создаётся в конструкторе сессии кошелька, то есть при запуске, — и
 * тянула ethers в начальный чанк на экраны, где сети нет вовсе:
 * приветствие, создание кошелька, разблокировка.
 *
 * Здесь транспорт подгружается только тогда, когда действительно
 * понадобилось соединение с узлом, — то есть после разблокировки.
 *
 * ПОЧЕМУ ЭТО НЕ ЗАМЕДЛЯЕТ РАБОТУ. `create` и без того асинхронна: она
 * подключается к узлу и сверяет chainId. Загрузка чанка добавляется
 * к этому ожиданию один раз за сессию, а модуль после первого вызова
 * остаётся в памяти — обещание импорта запоминается.
 *
 * ЧЕГО ЭТО НЕ МЕНЯЕТ. Ни поведения, ни проверок: возвращается ровно
 * тот же `RpcClient`, включая сверку chainId и перебор резервных
 * адресов. Отличие только в моменте загрузки кода.
 */
export class LazyRpcClientFactory implements IProviderFactory {
  readonly #logger: ILogger

  /* Запоминается обещание, а не результат: два одновременных вызова
     иначе запустили бы две загрузки одного модуля. */
  #loading: Promise<IProviderFactory> | null = null

  constructor(dependencies: ILazyRpcClientFactoryDependencies) {
    this.#logger = dependencies.logger
  }

  async create(network: INetworkConfig): Promise<IProvider> {
    this.#loading ??= this.#load()

    return await (await this.#loading).create(network)
  }

  async #load(): Promise<IProviderFactory> {
    const { RpcClientFactory } = await import('./RpcClientFactory')

    return new RpcClientFactory({ logger: this.#logger })
  }
}
