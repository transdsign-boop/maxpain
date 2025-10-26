/**
 * Console Logger - Captures console.log, console.warn, console.error
 * for display in the Trade Entry Errors dialog
 */

interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  level: 'log' | 'warn' | 'error';
  message: string;
  args: any[];
}

const MAX_LOGS = 500; // Keep last 500 console messages
const logs: ConsoleLogEntry[] = [];
let logIdCounter = 0;

// Save original console methods
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function captureLog(level: 'log' | 'warn' | 'error', ...args: any[]) {
  const entry: ConsoleLogEntry = {
    id: `console-${logIdCounter++}`,
    timestamp: new Date().toISOString(),
    level,
    message: args.map(arg =>
      typeof arg === 'string' ? arg : JSON.stringify(arg)
    ).join(' '),
    args
  };

  logs.push(entry);

  // Keep only last MAX_LOGS entries
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
}

// Override console methods
console.log = (...args: any[]) => {
  captureLog('log', ...args);
  originalLog(...args);
};

console.warn = (...args: any[]) => {
  captureLog('warn', ...args);
  originalWarn(...args);
};

console.error = (...args: any[]) => {
  captureLog('error', ...args);
  originalError(...args);
};

export function getConsoleLogs(filters?: {
  level?: 'log' | 'warn' | 'error';
  startTime?: Date;
  endTime?: Date;
  search?: string;
  limit?: number;
}): ConsoleLogEntry[] {
  let filtered = [...logs];

  if (filters?.level) {
    filtered = filtered.filter(log => log.level === filters.level);
  }

  if (filters?.startTime) {
    filtered = filtered.filter(log => new Date(log.timestamp) >= filters.startTime!);
  }

  if (filters?.endTime) {
    filtered = filtered.filter(log => new Date(log.timestamp) <= filters.endTime!);
  }

  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(log =>
      log.message.toLowerCase().includes(searchLower)
    );
  }

  // Sort by timestamp descending (newest first)
  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (filters?.limit) {
    filtered = filtered.slice(0, filters.limit);
  }

  return filtered;
}

export function clearConsoleLogs() {
  logs.length = 0;
  logIdCounter = 0;
}
