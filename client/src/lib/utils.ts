import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Timezone utilities - re-export from shared
 */
export {
  formatToPST,
  formatTimePST,
  formatDatePST,
  formatDateTimeShortPST,
  formatLogTimePST,
  nowInPST,
  toPST,
  getTimezoneAbbr,
  toLocaleStringPST,
  toLocaleTimeStringPST,
  toLocaleDateStringPST,
  APP_TIMEZONE
} from '@shared/timezone';
