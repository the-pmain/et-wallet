import type { ISignableTransaction, ITypedData } from '@/core/transaction'
import type { Address, DerivationPath, HexString } from '@/core/types'

/**
 * Обмен командами с устройством.
 *
 * ЗАЧЕМ АБСТРАКЦИЯ. Само соединение — это WebHID либо WebUSB, то есть
 * браузерные интерфейсы, которых в ядре быть не может: оно обязано
 * оставаться переносимым в service worker. Протокол же полностью
 * определён и никакой среды не требует, поэтому он живёт здесь,
 * а соединение внедряется снаружи.
 *
 * ЭТО ЕЩЁ И ЕДИНСТВЕННЫЙ СПОСОБ ПРОВЕРИТЬ ПРОТОКОЛ БЕЗ УСТРОЙСТВА.
 * Подставное соединение отвечает так же, как настоящее, и ошибки
 * в составлении команд видны на обычных тестах.
 */
export interface IApduTransport {
  /**
   * Отправляет команду и возвращает ответ целиком, вместе со словом
   * состояния в последних двух байтах.
   */
  exchange(command: Uint8Array): Promise<Uint8Array>
}

/** Адрес, выведенный устройством. */
export interface IHardwareAddress {
  readonly address: Address
  readonly path: DerivationPath
}

/**
 * Аппаратный кошелёк.
 *
 * ПОДПИСЬ ВОЗВРАЩАЕТСЯ ГОТОВОЙ. Приватный ключ не покидает устройство
 * ни в каком виде: наружу выходят только адреса и подписи. Это свойство
 * устройства, а не договорённость, и нарушить его наш код не может
 * при всём желании.
 */
export interface IHardwareDevice {
  /**
   * Читает адрес по пути.
   *
   * @param confirmOnDevice Показать адрес на экране устройства и
   *        потребовать подтверждения. Нужно там, где адрес принимают
   *        как свой: подменённый на экране компьютера адрес иначе
   *        не отличить от настоящего.
   */
  getAddress(path: DerivationPath, confirmOnDevice?: boolean): Promise<IHardwareAddress>

  /**
   * Подписывает транзакцию.
   *
   * Возвращает необработанную транзакцию с подписью, готовую
   * к публикации.
   */
  signTransaction(path: DerivationPath, transaction: ISignableTransaction): Promise<HexString>

  /** Подписывает произвольное сообщение по EIP-191. */
  signMessage(path: DerivationPath, message: Uint8Array): Promise<HexString>

  /** Подписывает структурированные данные по EIP-712. */
  signTypedData(path: DerivationPath, typedData: ITypedData): Promise<HexString>
}
