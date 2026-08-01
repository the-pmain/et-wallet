import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Объединяет классы Tailwind с разрешением конфликтов.
 *
 * clsx собирает условные классы, twMerge отбрасывает проигравшие в конфликте
 * (например, из `px-2 px-4` останется `px-4`). Без twMerge порядок классов в
 * итоговой строке не определяет победителя — им управляет порядок правил в CSS,
 * что делает переопределение стилей в компонентах ненадёжным.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
