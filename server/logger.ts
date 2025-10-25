/**
 * PST Logger - All backend logs display in Pacific Time
 */

import { formatLogTimePST } from '../shared/timezone';

/**
 * Log with PST timestamp prefix
 */
export function logPST(message: string, ...args: any[]) {
  const timestamp = formatLogTimePST();
  console.log(`[${timestamp}]`, message, ...args);
}

/**
 * Error log with PST timestamp prefix
 */
export function errorPST(message: string, ...args: any[]) {
  const timestamp = formatLogTimePST();
  console.error(`[${timestamp}]`, message, ...args);
}

/**
 * Warning log with PST timestamp prefix
 */
export function warnPST(message: string, ...args: any[]) {
  const timestamp = formatLogTimePST();
  console.warn(`[${timestamp}]`, message, ...args);
}

/**
 * Info log with PST timestamp prefix (same as logPST)
 */
export function infoPST(message: string, ...args: any[]) {
  const timestamp = formatLogTimePST();
  console.info(`[${timestamp}]`, message, ...args);
}

/**
 * Debug log with PST timestamp prefix
 */
export function debugPST(message: string, ...args: any[]) {
  const timestamp = formatLogTimePST();
  console.debug(`[${timestamp}]`, message, ...args);
}

/**
 * Get current PST timestamp for logging
 */
export function getPSTTimestamp(): string {
  return formatLogTimePST();
}

// Export a logger object for structured usage
export const logger = {
  log: logPST,
  error: errorPST,
  warn: warnPST,
  info: infoPST,
  debug: debugPST,
  timestamp: getPSTTimestamp,
};

// Export default as logger object
export default logger;
