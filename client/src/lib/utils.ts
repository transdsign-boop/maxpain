import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatInTimeZone } from "date-fns-tz"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Pacific Time (America/Los_Angeles) timezone constant
const PACIFIC_TZ = "America/Los_Angeles";

/**
 * Format a date/timestamp to Pacific Time with custom format string
 * @param date - Date object, timestamp number, or ISO string
 * @param formatStr - date-fns format string (e.g., 'MMM d, h:mm a')
 * @returns Formatted date string in Pacific Time
 */
export function formatPST(date: Date | number | string, formatStr: string): string {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return formatInTimeZone(dateObj, PACIFIC_TZ, formatStr);
}

/**
 * Format timestamp to short date/time: "10/25/2025 8:30 am"
 * @param timestamp - Unix timestamp in milliseconds or Date object
 * @returns Formatted string in Pacific Time
 */
export function formatDateTimeShortPST(timestamp: number | Date): string {
  return formatPST(timestamp, 'M/d/yyyy h:mm a');
}

/**
 * Format timestamp to medium date/time: "Oct 25, 2025 8:30 am"
 * @param timestamp - Unix timestamp in milliseconds or Date object
 * @returns Formatted string in Pacific Time
 */
export function formatDateTimePST(timestamp: number | Date): string {
  return formatPST(timestamp, 'MMM d, yyyy h:mm a');
}

/**
 * Format timestamp to time only: "8:30 am"
 * @param timestamp - Unix timestamp in milliseconds or Date object
 * @returns Formatted time string in Pacific Time
 */
export function formatTimePST(timestamp: number | Date): string {
  return formatPST(timestamp, 'h:mm a');
}

/**
 * Format timestamp to time with seconds: "8:30:45 am"
 * @param timestamp - Unix timestamp in milliseconds or Date object
 * @returns Formatted time string with seconds in Pacific Time
 */
export function formatTimeSecondsPST(timestamp: number | Date): string {
  return formatPST(timestamp, 'h:mm:ss a');
}

/**
 * Format timestamp to date only: "Oct 25, 2025"
 * @param timestamp - Unix timestamp in milliseconds or Date object
 * @returns Formatted date string in Pacific Time
 */
export function formatDatePST(timestamp: number | Date): string {
  return formatPST(timestamp, 'MMM d, yyyy');
}

/**
 * Format timestamp to short date: "Oct 25"
 * @param timestamp - Unix timestamp in milliseconds or Date object
 * @returns Formatted short date string in Pacific Time
 */
export function formatDateShortPST(timestamp: number | Date): string {
  return formatPST(timestamp, 'MMM d');
}
