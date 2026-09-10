/**
 * Cabinet column.
 *
 * One width for the wallet and the admin. Without a shared constant
 * screens drift in padding, and “the same container” exists only in
 * words.
 */
export const PAGE_COLUMN = 'mx-auto w-full max-w-5xl px-4'

/**
 * Cabinet sheet on a wide screen.
 *
 * Below `lg` the column is already phone-width: a card border and
 * shadow read as a second shell inside the first. The section stays;
 * the sheet is dropped.
 */
export const CABINET_SHEET =
  'max-lg:rounded-none max-lg:border-transparent max-lg:bg-transparent max-lg:py-3 max-lg:shadow-none'
