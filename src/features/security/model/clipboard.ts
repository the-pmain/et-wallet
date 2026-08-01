/**
 * Копирование с последующей очисткой буфера обмена.
 *
 * ЗАЧЕМ ОЧИЩАТЬ. Буфер обмена — общая для всей системы область,
 * доступная любому приложению и любой странице с разрешением на чтение.
 * Скопированный адрес получателя живёт там до следующего копирования,
 * а вредоносное расширение читает его и подменяет.
 *
 * ЭТО СМЯГЧЕНИЕ, А НЕ ЗАЩИТА. Тот, кто читает буфер в момент
 * копирования, прочтёт его в любом случае: окно между копированием
 * и вставкой существует всегда. Очистка сокращает время, в течение
 * которого значение доступно, — и только.
 *
 * ОЧИЩАЕТСЯ ТОЛЬКО СВОЁ ЗНАЧЕНИЕ. Если пользователь успел скопировать
 * что-то ещё, буфер не трогается: стереть чужое содержимое значило бы
 * уничтожить данные, к которым кошелёк отношения не имеет.
 */

/** Через сколько буфер очищается. */
const DEFAULT_CLEAR_DELAY_MS = 60_000

/** Результат копирования. */
export interface ICopyHandle {
  /** Отменяет запланированную очистку. */
  readonly cancel: () => void
}

/** Настройки копирования. */
export interface ICopyOptions {
  readonly clearAfterMs?: number

  /** Замена API буфера обмена. Внедряется тестом. */
  readonly clipboard?: Pick<Clipboard, 'writeText' | 'readText'>

  /** Планировщик. Внедряется тестом вместо системных таймеров. */
  readonly schedule?: (handler: () => void, delayMs: number) => () => void
}

/**
 * Копирует значение и планирует очистку буфера.
 *
 * @throws Error если буфер обмена недоступен — например, страница
 *         открыта без защищённого соединения.
 */
export async function copyWithAutoClear(
  value: string,
  options: ICopyOptions = {},
): Promise<ICopyHandle> {
  const clipboard = options.clipboard ?? navigator.clipboard
  const delay = options.clearAfterMs ?? DEFAULT_CLEAR_DELAY_MS

  const schedule =
    options.schedule ??
    ((handler, delayMs) => {
      const id = globalThis.setTimeout(handler, delayMs)

      return () => {
        globalThis.clearTimeout(id)
      }
    })

  await clipboard.writeText(value)

  const cancel = schedule(() => {
    void clearIfUnchanged(clipboard, value)
  }, delay)

  return { cancel }
}

/**
 * Очищает буфер, если в нём всё ещё наше значение.
 *
 * Чтение буфера может быть запрещено пользователем — тогда узнать
 * содержимое нельзя, и стирать вслепую нельзя тоже: под очистку попало
 * бы чужое. Отказ проглатывается: неудачная очистка буфера не имеет
 * права уронить экран.
 */
async function clearIfUnchanged(
  clipboard: Pick<Clipboard, 'writeText' | 'readText'>,
  expected: string,
): Promise<void> {
  try {
    if ((await clipboard.readText()) === expected) {
      await clipboard.writeText('')
    }
  } catch {
    /* Чтение запрещено либо вкладка потеряла фокус. Очистка вслепую
       уничтожила бы данные, к которым кошелёк отношения не имеет. */
  }
}
