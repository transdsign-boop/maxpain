# Pacific Standard Time (PST/PDT) Configuration

## Overview

All dates and times in the MPI™ Liquidation Hunter Bot are displayed in **Pacific Time (America/Los_Angeles)**, which automatically handles both Pacific Standard Time (PST) and Pacific Daylight Time (PDT) depending on the season.

## Architecture

### Database Storage
- **All timestamps stored in UTC** (best practice for distributed systems)
- Database schema uses PostgreSQL `timestamp` or `timestamptz` types
- UTC ensures consistency across timezones and daylight saving transitions

### Display Layer
- **All user-facing displays show Pacific Time**
- Frontend components convert UTC → PST/PDT
- Backend logs include PST timestamp prefixes
- Consistent "PT" abbreviation in UI (covers both PST and PDT)

## Implementation

### Shared Timezone Module (`shared/timezone.ts`)

Central timezone utility used by both frontend and backend:

```typescript
import { formatToPST, formatTimePST, formatDatePST } from '@shared/timezone';

// Format full datetime
formatToPST(new Date()); // "10/25/2025 08:30:45"

// Format time only
formatTimePST(new Date()); // "08:30:45"

// Format date only
formatDatePST(new Date()); // "10/25/2025"

// Get current time in PST
nowInPST(); // Date object in PST
```

### Frontend Usage

All React components use timezone utilities from `@/lib/utils`:

```typescript
import { toLocaleTimeStringPST, formatDateTimeShortPST } from '@/lib/utils';

// Display time in PST
{new Date(timestamp).toLocaleTimeString('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/Los_Angeles'
})}

// Or use utility functions
{formatDateTimeShortPST(timestamp)} // "10/25/2025 8:30 am"
```

**Updated Components:**
- `LiquidationRow.tsx` - Trade timestamp displays
- `LiveLiquidationsSidebar.tsx` - Real-time liquidation times
- `ConnectionStatus.tsx` - Error timestamps
- `PerformanceOverview.tsx` - Chart tooltips and trade dates
- `StrategyStatus.tsx` - Position and trade timestamps
- `VWAPChartDialog.tsx` - TradingView chart timezone

### Backend Logging (`server/logger.ts`)

Structured logging with PST timestamps:

```typescript
import logger from './logger';

// Log with automatic PST timestamp prefix
logger.log('Server started'); // [2025-10-25 08:30:45 PDT] Server started
logger.error('Connection failed'); // [2025-10-25 08:30:45 PDT] Connection failed
logger.warn('High memory usage'); // [2025-10-25 08:30:45 PDT] High memory usage

// Or use individual functions
import { logPST, errorPST, warnPST } from './logger';
logPST('Trade executed');
errorPST('API request failed');
warnPST('Rate limit approaching');
```

**Benefits:**
- Consistent timestamp format across all logs
- Easy debugging with human-readable local time
- No manual timestamp formatting needed

## TradingView Charts

Charts display in Pacific Time via TradingView widget configuration:

```typescript
timezone: 'America/Los_Angeles' // Automatically handles PST/PDT
```

This ensures candle timestamps, trade markers, and chart annotations all match the application's timezone.

## Date Formatting Reference

### Common Patterns

| Use Case | Function | Example Output |
|----------|----------|----------------|
| Full datetime | `formatToPST(date)` | `10/25/2025 08:30:45` |
| Time only | `formatTimePST(date)` | `08:30:45` |
| Date only | `formatDatePST(date)` | `10/25/2025` |
| Short datetime | `formatDateTimeShortPST(date)` | `10/25/2025 8:30 am` |
| Log timestamp | `formatLogTimePST(date)` | `2025-10-25 08:30:45 PDT` |
| Legacy toLocaleString | `toLocaleStringPST(date)` | Browser-formatted in PST |

### Display Conventions

- **Time displays**: Use 24-hour format (HH:mm:ss) for technical precision
- **Chart tooltips**: Use 12-hour format (h:mm a) for readability
- **Log timestamps**: Include timezone abbreviation (PST/PDT)
- **UI labels**: Use "PT" (Pacific Time) to cover both PST and PDT

## Daylight Saving Time

The `America/Los_Angeles` timezone automatically handles DST transitions:

- **PST (Standard)**: UTC-8 (November - March)
- **PDT (Daylight)**: UTC-7 (March - November)

No manual DST adjustments needed - JavaScript's Intl API handles this automatically.

## Testing Timezone Handling

### Verify Display Timezone

```typescript
// In browser console (frontend)
import { APP_TIMEZONE, getTimezoneAbbr } from '@/lib/utils';
console.log('App timezone:', APP_TIMEZONE); // "America/Los_Angeles"
console.log('Current abbreviation:', getTimezoneAbbr()); // "PST" or "PDT"
```

### Verify Backend Logging

```bash
# Check server logs for PST timestamps
npm run dev
# Logs should show: [2025-10-25 08:30:45 PDT] messages
```

### Verify Database Integrity

```sql
-- Database should still store UTC timestamps
SELECT created_at, updated_at FROM positions LIMIT 5;
-- Timestamps should be in UTC (no timezone offset in storage)
```

## Migration Notes

### Changes Made

1. ✅ Created `shared/timezone.ts` with PST utilities
2. ✅ Updated all frontend date displays to use PST
3. ✅ Created `server/logger.ts` for PST-prefixed logs
4. ✅ Updated TradingView chart timezone to PST
5. ✅ Re-exported timezone utils from `client/src/lib/utils.ts`

### Database (No Changes)

- **Database timestamps remain in UTC** (no migration needed)
- Only display layer changed to show PST/PDT
- Existing data fully compatible

### Future Development

When adding new date displays:

**Frontend:**
```typescript
// ❌ Don't use raw toLocaleString()
{new Date(timestamp).toLocaleString()}

// ✅ Use PST utilities
{toLocaleStringPST(timestamp)}
{formatDateTimeShortPST(timestamp)}
```

**Backend:**
```typescript
// ❌ Don't use console.log directly for important logs
console.log('Trade executed');

// ✅ Use PST logger
logger.log('Trade executed'); // [2025-10-25 08:30:45 PDT] Trade executed
```

## Troubleshooting

### "Times look wrong by X hours"

- Verify you're comparing to Pacific Time, not your local timezone
- Check timezone abbreviation in logs (should say PST or PDT)
- Use `getTimezoneAbbr()` to confirm current DST status

### "Chart timezone doesn't match UI"

- Ensure TradingView widget uses `timezone: 'America/Los_Angeles'`
- Hard refresh browser (Ctrl+Shift+R) to reload widget
- Check browser console for TradingView errors

### "Database dates look different from UI"

- This is expected - database stores UTC, UI displays PST
- 8-hour offset in PST (UTC-8), 7-hour offset in PDT (UTC-7)
- Use timezone utilities to convert when querying

## Dependencies

Required packages (already installed):

```json
{
  "date-fns": "^3.6.0",
  "date-fns-tz": "^3.2.0"
}
```

These provide robust timezone conversion and DST handling.

## Resources

- [date-fns-tz Documentation](https://github.com/marnusw/date-fns-tz)
- [IANA Timezone Database](https://www.iana.org/time-zones)
- [America/Los_Angeles Timezone Info](https://www.timeanddate.com/time/zones/pst)
