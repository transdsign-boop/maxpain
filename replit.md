# Aster DEX Liquidations Dashboard

## Overview
The Aster DEX Liquidations Dashboard is a real-time monitoring and trading platform for the Aster DEX exchange. It provides live liquidation data, advanced filtering, and analysis tools for cryptocurrency and tokenized stock pairs. The project aims to be a robust, production-ready system for real-money trading, offering comprehensive safety checks, detailed performance tracking, and a sophisticated Dollar Cost Averaging (DCA) system. The business vision is to provide a powerful tool for traders, enabling informed decisions and automated, risk-managed trading strategies within the Aster DEX ecosystem.

## Recent Changes (October 14, 2025)

### Reserved Risk Budget System
Implemented upfront DCA budget reservation to prevent layer blocking. When a position opens, the system now reserves the FULL potential DCA risk (all 10 layers) upfront, preventing subsequent layers from being blocked by portfolio risk limits.

**Key Features:**
- **Upfront Reservation**: Full DCA budget calculated and reserved when Layer 1 opens, stored in `reservedRiskDollars` and `reservedRiskPercent` fields
- **Dual-Ring Visualization**: UI displays both filled risk (inner ring, color-coded by P&L) and reserved risk (outer ring, blue) for each position
- **Legacy Position Handling**: Pre-implementation positions (missing `reservedRiskDollars`) use filled risk as fallback in calculations
- **WebSocket Broadcasting**: Real-time metrics broadcast both `filledRiskPercentage` (actual layers) and `reservedRiskPercentage` (full DCA budget)

**Backfill Script** (`server/scripts/backfill-reserved-risk.ts`):
Retroactively calculates reserved risk for existing positions that were created before the Reserved Risk system was implemented.

- **Auto-Detection**: Automatically finds active strategy and latest session using database queries
- **ATR Calculation**: Fetches live ATR data for each position from exchange API
- **DCA Recalculation**: Uses `calculateDCALevels()` to determine full potential risk based on current strategy settings
- **Database Update**: Updates positions with accurate `reservedRiskDollars` and `reservedRiskPercent` values
- **Portfolio Summary**: Displays before/after portfolio risk comparison

**Usage:**

Run: `npx tsx server/scripts/backfill-reserved-risk.ts`

Optional: Specify strategy ID and session ID manually by passing them as arguments.

**Requirements:**
- `ASTER_API_KEY` environment variable must be set
- `ASTER_SECRET_KEY` environment variable must be set
- Active trading strategy must exist in database
- At least one trade session must exist

### Critical DCA Position Sizing Fix
Redesigned the position sizing system to correctly use Start Step % for Layer 1 sizing instead of Max Risk %. Previously, the 14.5% max portfolio risk was incorrectly used to SIZE positions, creating massive positions (e.g., $1,325 exposure on $802 account).

**Changes:**
- **Layer 1 Sizing**: Based on Start Step % (default 0.1%) → Formula: `Notional = (Balance × Margin% × StartStep% × Leverage) / 10,000`
- **Max Portfolio Risk (14.5%)**: Acts purely as a trade BLOCKER, preventing new entries when total portfolio risk exceeds limit
- **Default Start Step**: Changed from 0.4% to 0.1% to meet $5 minimum notional at 10x leverage
- **Database Update Required**: Run `update_start_step_default.sql` in Neon SQL Editor to update existing strategies

## User Preferences
Preferred communication style: Simple, everyday language.

🚨 CRITICAL: DATABASE CONFIGURATION 🚨
🛑 NEVER USE `execute_sql_tool` FOR THIS PROJECT 🛑
THIS APPLICATION USES NEON DATABASE EXCLUSIVELY

- ❌ DO NOT USE `execute_sql_tool` - it connects to a worthless development database
- ❌ DO NOT TRUST any SQL query results from `execute_sql_tool` - they are from the WRONG database
- ✅ ONLY USE the application API endpoints to check database state (e.g., `/api/strategies`, `/api/strategies/sync`)
- ✅ ONLY USE application logs to verify database operations

📋 SCHEMA CHANGES POLICY:
- ✅ ALWAYS use manual SQL scripts executed directly in Neon SQL Editor for schema changes
- ❌ NEVER use `npm run db:push` or Drizzle migrations (DATABASE_URL ≠ NEON_DATABASE_URL)
- 📝 Process: Update `shared/schema.ts` → Write SQL script → Execute in Neon SQL Editor

🚨 CRITICAL: STRATEGY CREATION POLICY 🚨
🛑 NEVER AUTO-CREATE STRATEGIES 🛑

- ❌ NEVER automatically create a new strategy under any circumstances
- ❌ NEVER create a strategy as a "fallback" or "default" behavior
- ✅ ONLY create strategies when user explicitly uses the UI to create one (future feature)
- ✅ FAIL GRACEFULLY - If an operation expects a strategy but none exists, return an error

PERMANENT DATA PRESERVATION: ALL trading data MUST be preserved forever. The user requires complete access to historical trading records at any time.
- NEVER DELETE any positions, fills, or trade session data.
- When the user wants to "start fresh", ARCHIVE the current session (mark inactive) and create a new session.
- All historical sessions remain in the database permanently.
- A "Start Fresh Session" button archives the current session but preserves all data.
- The user must be able to recall any historical trading data at any time.

## System Architecture

**UI/UX Decisions:**
- **Frameworks**: React 18, TypeScript, Vite.
- **Design**: Radix UI, shadcn/ui, Tailwind CSS (financial trading-focused with lime for profit, orange for loss). Dark/light modes, responsive layout (Inter font for text, JetBrains Mono for numerical data), optimized tables/cards, mobile-first approach.
- **Features**: Collapsible trade details, live strategy editing with performance charts, interactive P&L charts, hedge position detection, intelligent asset/risk recommendations, consolidated Global Settings dialog, DCA settings, API management (export/import JSON settings).
- **Performance**: `React.memo` optimization on key components.

**Technical Implementations:**
- **Frontend State Management**: React hooks with TanStack Query.
- **Routing**: Wouter.
- **Backend Runtime**: Node.js with Express.js.
- **Backend Language**: TypeScript.
- **Database ORM**: Drizzle ORM (raw SQL for critical operations).
- **API**: RESTful endpoints with `/api` prefix. Strategy changes save to Neon DB and load into memory.
- **Real-time Data**: WebSocket connection to Aster DEX for live liquidation streaming and user data (ACCOUNT_UPDATE, ORDER_TRADE_UPDATE). A Live Data Orchestrator caches and broadcasts real-time account/position data.
- **Cascade Detection**: Dynamic monitoring of selected assets, aggregate-based trade filtering (blocking triggers when ≥50% of monitored symbols show cascade activity).
- **Percentile Threshold**: All percentile calculations use database records for accuracy.
- **Automatic Position Reconciliation**: Database positions reconciled with live exchange positions before every portfolio risk calculation to prevent ghost positions.
- **Trade Blocking System**: Comprehensive real-time trade blocking with WebSocket broadcasting and persistent UI indicators. Includes system-wide blocks (cascade auto-blocking, risk limits, strategy-level blocks, missing exchange limits, safety issues, exchange failures) and per-liquidation filters (percentile threshold, entry cooldown, max layers, missing historical data).
- **Trading System**: Live-only trading with HMAC-SHA256 authentication, automatic ATR-based TP/SL, queue-based locking, and session-based tracking. **Pause/Resume Controls**: User-facing controls to pause/resume trading without stopping the strategy. The `paused` flag halts trade execution while keeping the session active and data streaming.
- **Margin Mode**: System configures isolated/cross margin on exchange before placing orders, defaulting to isolated.
- **Hedge Mode Orders**: All protective orders include `positionSide` parameter for hedge mode compatibility.
- **DCA System**: Integrated Dollar Cost Averaging with ATR-based volatility scaling, convex level spacing, exponential size growth, and liquidation-aware risk management. Includes dynamic growth factor adjustment to maintain risk cap, accurate DCA preview using real market data, and strict minimum notional enforcement via exchange-specific MIN_NOTIONAL values. Position sizing for Layer 1 uses Start Step %; Max Portfolio Risk acts as a trade blocker. Full potential DCA risk is reserved upfront when Layer 1 opens (`reservedRiskDollars`, `reservedRiskPercent`), visible in UI.
- **Simplified TP/SL**: Position-level protective orders only (one TP and one SL per position).
- **Protective Order Safety**: Place-then-cancel pattern for TP/SL orders, scheduled and WebSocket-triggered reconciliation, per-position locking, and automatic retry.
- **Data Integrity**: Idempotency for orders, atomic cooldowns, and permanent preservation of all trading data.
- **Race Condition Prevention**: Multi-layer defense system prevents duplicate position creation during rapid liquidation cascades, including pre-lock cooldown, atomic lock acquisition, in-memory position tracking, and post-wait cooldown recheck. Fixes ensure pause commands are immediately respected and prevents duplicate initial positions via atomic `onExchangeConfirmation` callback for cooldowns.
- **Performance Metrics**: Tracking of deposited capital, ROI, transfer markers, commissions, and funding fees. Manual commission/funding adjustments apply conditionally based on global API cutoff dates.
- **Portfolio Limit**: Position counting uses unique symbol deduplication; hedged positions count as 1 position towards max limit.

**Feature Specifications:**
- **Financial Metrics**: Realized P&L, commissions, and funding fees fetched directly from exchange API (e.g., `/fapi/v1/income`), not stored in DB. Conditional manual adjustments apply for historical data.
- **WebSocket Broadcasting**: `trade_block` event broadcasts system-wide blocking information to the frontend.
- **Exchange Limits UI**: Global Settings dialog displays real-time MIN_NOTIONAL, price precision, and quantity precision for all monitored symbols via `/api/exchange-limits` endpoint.

**System Design Choices:**
- **Data Persistence**: PostgreSQL via Neon serverless hosting.
- **Schema**: 14 core tables for liquidations, strategies, trade sessions, positions, fills, orders, etc.
- **Schema Changes**: Manual SQL scripts are exclusively used for schema updates.
- **Data Retention**: Liquidation data for 30 days; trading data and financial records are permanently preserved through archiving.
- **Trade Sync Pagination**: Historical trade synchronization handles exchange API limitations by chunking large date ranges into 7-day segments and using backward cursor pagination within chunks.

## External Dependencies

**Core:**
- **@radix-ui/react-\***: UI primitives.
- **@tanstack/react-query**: Server state management.
- **drizzle-orm**: Type-safe PostgreSQL ORM.
- **@neondatabase/serverless**: Serverless PostgreSQL client for Neon.

**UI & Styling:**
- **Tailwind CSS**: Utility-first CSS framework.
- **class-variance-authority**: Component variant management.
- **clsx & tailwind-merge**: Class name utilities.
- **Lucide React**: Icon library.
- **date-fns**: Date manipulation.
- **Google Fonts**: Inter, JetBrains Mono.