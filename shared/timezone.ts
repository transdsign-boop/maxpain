/**
 * Timezone Utilities - Pacific Standard Time (PST/PDT)
 *
 * All times in this application are displayed in America/Los_Angeles timezone.
 * Database stores UTC timestamps, but all user-facing displays use PST/PDT.
 */

import { format, formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { parseISO } from 'date-fns';

/**
 * Application timezone: Pacific Time (PT) - automatically handles PST/PDT
 */
export const APP_TIMEZONE = 'America/Los_Angeles';

/**
 * Format a date to PST/PDT timezone
 * @param date - Date object, timestamp, or ISO string
 * @param formatString - date-fns format string (default: 'MM/dd/yyyy HH:mm:ss')
 * @returns Formatted date string in Pacific Time
 */
export function formatToPST(
  date: Date | number | string,
  formatString: string = 'MM/dd/yyyy HH:mm:ss'
): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
  return formatInTimeZone(dateObj, APP_TIMEZONE, formatString);
}

/**
 * Format time only in PST/PDT (HH:mm:ss)
 */
export function formatTimePST(date: Date | number | string): string {
  return formatToPST(date, 'HH:mm:ss');
}

/**
 * Format date only in PST/PDT (MM/dd/yyyy)
 */
export function formatDatePST(date: Date | number | string): string {
  return formatToPST(date, 'MM/dd/yyyy');
}

/**
 * Format datetime with short time (MM/dd/yyyy h:mm a)
 */
export function formatDateTimeShortPST(date: Date | number | string): string {
  return formatToPST(date, 'MM/dd/yyyy h:mm a');
}

/**
 * Format for logs: ISO-like but in PST with timezone indicator
 * Example: 2025-10-25 08:30:45 PST
 */
export function formatLogTimePST(date: Date | number | string = new Date()): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
  const formatted = formatInTimeZone(dateObj, APP_TIMEZONE, 'yyyy-MM-dd HH:mm:ss zzz');
  return formatted;
}

/**
 * Get current time in PST as a Date object
 */
export function nowInPST(): Date {
  return toZonedTime(new Date(), APP_TIMEZONE);
}

/**
 * Convert any date to PST Date object
 */
export function toPST(date: Date | number | string): Date {
  const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
  return toZonedTime(dateObj, APP_TIMEZONE);
}

/**
 * Get timezone abbreviation (PST or PDT depending on daylight saving)
 */
export function getTimezoneAbbr(date: Date | number | string = new Date()): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
  const abbr = formatInTimeZone(dateObj, APP_TIMEZONE, 'zzz');
  return abbr;
}

/**
 * Legacy support: Format using toLocaleString options but in PST
 */
export function toLocaleStringPST(
  date: Date | number | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
  return dateObj.toLocaleString('en-US', {
    ...options,
    timeZone: APP_TIMEZONE,
  });
}

/**
 * toLocaleTimeString equivalent in PST
 */
export function toLocaleTimeStringPST(
  date: Date | number | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
  return dateObj.toLocaleTimeString('en-US', {
    ...options,
    timeZone: APP_TIMEZONE,
  });
}

/**
 * toLocaleDateString equivalent in PST
 */
export function toLocaleDateStringPST(
  date: Date | number | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
  return dateObj.toLocaleDateString('en-US', {
    ...options,
    timeZone: APP_TIMEZONE,
  });
}
