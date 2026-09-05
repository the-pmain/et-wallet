import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Joins Tailwind classes and resolves conflicts.
 *
 * clsx collects conditional classes; twMerge drops the losers of a
 * conflict (from `px-2 px-4` only `px-4` remains). Without twMerge
 * the order in the final string does not pick a winner — CSS rule
 * order does — which makes style overrides in components unreliable.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
