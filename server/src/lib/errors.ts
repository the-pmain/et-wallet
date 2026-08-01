/**
 * Отказ, который можно показать клиенту.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ КЛАСС, А НЕ ПРОСТО `Error`. Наружу обязано уходить
 * ровно то, что мы решили сказать. Сообщение произвольной ошибки
 * содержит пути файлов, имена внутренних модулей, иногда — фрагменты
 * данных; всё это помогает нападающему и ничем не помогает пользователю.
 */
export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

/** Запрошенного ресурса не существует. */
export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(404, 'not_found', message)
    this.name = 'NotFoundError'
  }
}

/** Запрос составлен неверно. */
export class BadRequestError extends ApiError {
  constructor(code: string, message: string) {
    super(400, code, message)
    this.name = 'BadRequestError'
  }
}

/** Запись изменена другим устройством. */
export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, 'revision_conflict', message)
    this.name = 'ConflictError'
  }
}

/**
 * Каталог не прошёл проверку при загрузке.
 *
 * Это ошибка развёртывания, а не выполнения: сервис с испорченным
 * каталогом обязан не запуститься. Запуск с адресом контракта, набранным
 * с опечаткой, означал бы раздачу этого адреса всем пользователям.
 */
export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(`Каталог не прошёл проверку: ${message}`)
    this.name = 'CatalogValidationError'
  }
}
