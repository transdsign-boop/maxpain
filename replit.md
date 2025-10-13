# Aster DEX Liquidations Dashboard

## Overview
The Aster DEX Liquidations Dashboard is a real-time monitoring and trading platform for the Aster DEX exchange. It provides live liquidation data, advanced filtering, and analysis tools for cryptocurrency and tokenized stock pairs. The project aims to be a robust, production-ready system for real-money trading, offering comprehensive safety checks, detailed performance tracking, and a sophisticated Dollar Cost Averaging (DCA) system. The business vision is to provide a powerful tool for traders, enabling informed decisions and automated, risk-managed trading strategies within the Aster DEX ecosystem.

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
- **Performance**: `React.memo` optimization on key components to prevent unnecessary re-renders.

**Technical Implementations:**
- **Frontend State Management**: React hooks with TanStack Query.
- **Routing**: Wouter.
- **Backend Runtime**: Node.js with Express.js.
- **Backend Language**: TypeScript.
- **Database ORM**: Drizzle ORM (raw SQL for critical operations).
- **API**: RESTful endpoints with `/api` prefix. All strategy changes are immediately saved to the Neon database and then loaded into memory.
- **Real-time Data**: WebSocket connection to Aster DEX for live liquidation streaming and user data (ACCOUNT_UPDATE, ORDER_TRADE_UPDATE). A Live Data Orchestrator caches and broadcasts real-time account/position data.
- **Cascade Detection**: Dynamic monitoring of selected assets, aggregate-based trade filtering (blocking triggers when ≥50% of monitored symbols show cascade activity). Reversal Quality is informational only.
- **Percentile Threshold**: All percentile calculations use database records, not in-memory cache, for accuracy.
- **Automatic Position Reconciliation**: Database positions are reconciled with live exchange positions before every portfolio risk calculation to prevent ghost positions.
- **Cascade Detector Polling**: Optimized polling for price updates and open interest to prevent rate limits.
- **Trading System**: Live-only trading with HMAC-SHA256 authentication, automatic ATR-based TP/SL management, queue-based locking, and session-based tracking. **Pause/Resume Controls**: User-facing controls for pausing/resuming trading without stopping the strategy. The `paused` flag halts trade execution while keeping the session active, WebSocket alive, and all data streaming. The `/api/strategies/:id/start` endpoint is used internally for initial activation only (sets `isActive=true`, `paused=false`). No full stop functionality exposed to users.
- **Margin Mode**: System configures isolated/cross margin mode on exchange (`/fapi/v1/marginType`) before placing orders, defaulting to isolated.
- **Hedge Mode Orders**: All protective orders include `positionSide` parameter for hedge mode compatibility.
- **DCA System**: Integrated Dollar Cost Averaging with ATR-based volatility scaling, convex level spacing, exponential size growth, and liquidation-aware risk management. **Dynamic Growth Factor Adjustment**: When Layer 1 is scaled up to meet $5 minimum notional, the system automatically reduces the growth factor (via binary search) to keep total position risk within the configured max risk cap. For small accounts ($614 with 0.4% risk = $2.46), growth factor may reduce from 1.8x to ~1.3x; as account grows, it returns to configured value. UI displays both configured and effective growth factors. **DCA Preview Accuracy (Oct 13, 2025)**: Preview endpoint now uses real market data from monitored symbols instead of dummy values ($100 price, 1% ATR). System fetches recent liquidation prices and calculates live ATR via exchange API, providing accurate effective growth factor preview for current trading conditions. **Strict Minimum Notional Enforcement**: Layer 1 position sizing uses exchange-specific MIN_NOTIONAL values from `/fapi/v1/exchangeInfo` (cached in `symbolPrecisionCache`). When exchange data is unavailable, trades are BLOCKED entirely with `missing_exchange_limits` WebSocket notification—no fallback to $5. UI displays exchange limits in Global Settings.
- **Simplified TP/SL**: Position-level protective orders only (one TP and one SL per position).
- **Protective Order Safety**: Place-then-cancel pattern for TP/SL orders, scheduled and WebSocket-triggered reconciliation, per-position locking, and automatic retry on `ReduceOnly` rejection.
- **Data Integrity**: Idempotency for orders, atomic cooldowns, and permanent preservation of all trading data.
- **Race Condition Prevention (Oct 2025)**: Multi-layer defense system prevents duplicate position creation during rapid liquidation cascades. Pre-lock cooldown check (30s) blocks duplicates before processing, atomic lock acquisition prevents simultaneous entry, immediate cooldown stamping after lock prevents slippage, in-memory position tracking (5s cleanup) catches duplicates before DB commit, and post-wait cooldown recheck provides additional safety. Fixed critical bug where 8 separate positions were created instead of 1 position with 8 DCA layers. **Pause/Resume Race Condition Fix (Oct 13, 2025)**: Fixed critical bug where trades could execute while paused due to in-flight liquidations holding stale strategy objects. Solution: `evaluateStrategySignal` now always checks pause status from the current in-memory strategy Map (not the captured parameter) before executing any trades, ensuring pause commands are immediately respected even for already-processing liquidations. **DCA Layer Cooldown Fix (Oct 13, 2025)**: Fixed critical self-blocking bug where DCA layers were approved but immediately blocked from executing. Root cause: cooldown was set at evaluation start, then the approved layer was blocked by the just-set cooldown. Solution: Cooldown now sets atomically with exchange confirmation via callback in `placeOrderWithRetry`, ensuring approved layers execute while preventing duplicates. Partial failure edge case documented: if exchange confirms but storage fails, pending-layer marker keeps in RAM to prevent duplicates until reconciliation. **Known limitation**: Pending markers are in-memory only; process restart can lose them. Future work: durable "layer-in-flight" storage and automated reconciliation for orphaned exchange orders.
- **Performance Metrics**: Tracking of deposited capital, ROI, transfer markers, commissions, and funding fees.
- **Portfolio Limit**: Position counting uses unique symbol/side deduplication for hedge mode compatibility.

**Feature Specifications:**
- **Financial Metrics**: Realized P&L, commissions, and funding fees are fetched directly from the exchange API (e.g., `/fapi/v1/income`) and not stored in the database.
- **Trade Blocking System**: Comprehensive real-time trade blocking with WebSocket broadcasting and persistent UI indicators.
    - **System-Wide Blocks**: Cascade auto-blocking (≥50% threshold), strategy-level blocks, risk limits (portfolio, budget, position value), DCA configuration, missing exchange limits (MIN_NOTIONAL), safety/validation issues, exchange execution failures. These block all trades and turn the UI trade light red.
    - **Per-Liquidation Filters**: Percentile threshold, entry cooldown, max layers, missing historical data. These filter individual liquidations but do not block all trades or change the UI trade light.
- **WebSocket Broadcasting**: `trade_block` event broadcasts system-wide blocking information to the frontend.
- **Exchange Limits UI**: Global Settings dialog displays real-time MIN_NOTIONAL, price precision, and quantity precision for all monitored symbols via `/api/exchange-limits` endpoint.

**System Design Choices:**
- **Data Persistence**: PostgreSQL via Neon serverless hosting.
- **Schema**: 14 core tables for liquidations, strategies, trade sessions, positions, fills, orders, etc.
- **Schema Changes**: Manual SQL scripts are exclusively used for schema updates.
- **Data Retention**: Liquidation data for 30 days; trading data and financial records are permanently preserved through archiving.

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