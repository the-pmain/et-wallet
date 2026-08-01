import { AppError } from './AppError'

/**
 * Ошибка вызова нереализованной операции.
 *
 * Используется в сервисах-заготовках. Принципиально важно, что заглушка
 * бросает исключение, а не возвращает `undefined` или пустой массив:
 * молчаливая заглушка в кошельке способна создать видимость успешной
 * операции — например, «сохранённый» ключ, которого на самом деле нет.
 */
export class NotImplementedError extends AppError {
  readonly code = 'NOT_IMPLEMENTED'

  /**
   * @param member Полное имя операции в формате `ServiceName.methodName`.
   */
  constructor(member: string) {
    super(`Операция "${member}" не реализована на текущем этапе разработки.`)
  }
}
