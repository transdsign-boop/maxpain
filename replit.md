# Aster DEX Liquidations Dashboard

## Overview
The Aster DEX Liquidations Dashboard is a real-time monitoring and trading platform for the Aster DEX exchange. It provides live liquidation data, advanced filtering, and analysis tools for cryptocurrency and tokenized stock pairs. The project aims to be a robust, production-ready system for real-money trading, offering comprehensive safety checks, detailed performance tracking, and a sophisticated Dollar Cost Averaging (DCA) system. The business vision is to provide a powerful tool for traders, enabling informed decisions and automated, risk-managed trading strategies within the Aster DEX ecosystem.

## User Preferences
Preferred communication style: Simple, everyday language.

**Transfer Exclusion**: Specific deposits can be excluded from account size calculations using the `excluded` column in the transfers table. Excluded transfers are filtered out when calculating totalDeposited, effectively starting the account size calculation from zero (if all initial deposits are excluded).

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
- **Risk Visualization**: Dual-ring meter displays margin usage (inner ring, fixed lime green) and filled risk (outer ring, dynamic colors: blue → orange at 80% threshold → red when exceeding limit). Color computation uses server-backed `maxPortfolioRiskPercent` via memoized helpers to prevent desynchronization during async updates. Visual colors always match backend's risk blocking threshold.
- **Features**: Collapsible trade details, live strategy editing with performance charts, interactive P&L charts, hedge position detection, intelligent asset/risk recommendations, consolidated Global Settings dialog, DCA settings, API management (export/import JSON settings).
- **Market Sentiment Dashboard**: Consolidated UI with Market Sentiment, Fear & Greed Index, Social Metric, and a CSS marquee-based scrolling news ticker. News aggregation from Alpha Vantage, CryptoNews-API, and ScrapeCreators with category filtering and per-source error handling.
- **Performance**: `React.memo` optimization on key components. Memoized metric subcomponents prevent unnecessary re-renders. CSS keyframe animations for ticker.

**Technical Implementations:**
- **Frontend State Management**: React hooks with TanStack Query.
- **Routing**: Wouter.
- **Backend Runtime**: Node.js with Express.js (TypeScript).
- **Database ORM**: Drizzle ORM (raw SQL for critical operations).
- **API**: RESTful endpoints for strategy management and data.
- **Real-time Data**: WebSocket connection to Aster DEX for live liquidation streaming and user data (ACCOUNT_UPDATE, ORDER_TRADE_UPDATE), managed by a Live Data Orchestrator.
- **Trade Logic**: Includes cascade detection, percentile threshold filtering, automatic position reconciliation, comprehensive real-time trade blocking (system-wide and per-liquidation filters), and a robust DCA system. **CRITICAL Duplicate Entry Prevention** (Oct 20, 2025): Atomic reservation system ensures 1 liquidation = 1 market order maximum across ALL strategies. System uses global cooldown (symbol+side key, 60-second minimum between orders) + liquidation ID tracking. Reservation is set ONLY at decision point (immediately before order placement) to prevent over-blocking when strategies filter out trades. Failed orders clear both cooldown and liquidation ID to allow retry. Flow: Check liquidation ID → Check global cooldown → Evaluate filters → Set reservation (cooldown + mark ID) → Place order → Clear if failed.
- **DCA System**: Integrates ATR-based volatility scaling, convex level spacing, exponential size growth, and liquidation-aware risk management. Position sizing for Layer 1 uses Start Step %; Max Portfolio Risk acts as a trade blocker. Configurable DCA layer delay (default: 120 seconds / 2 minutes between orders for same asset). Multi-layer race condition prevention with lock-based synchronization. **Intelligent Cooldown System** (Oct 20, 2025): Cooldown enforces 2-minute spacing between consecutive FILLS (not placements) for same symbol+side. **Async Mutex Serialization**: Both `fillLiveOrder` and `fillPaperOrder` use async mutex pattern with `fillLocks` Map to serialize concurrent fills per session-symbol-side key. Each fill waits for previous fill to complete, sets cooldown timestamp atomically within mutex-protected code, and releases lock in finally block (even on errors). Prevents race conditions where concurrent fills could bypass cooldown enforcement. Timestamp set when order actually fills on exchange, preventing rapid-fire layers even if orders are placed quickly. Liquidations below 60th percentile are rejected WITHOUT setting cooldown, allowing immediate evaluation of next liquidation. **Adaptive Stop Loss** (Oct 20, 2025): Risk calculations use adaptive SL when enabled (ATR × multiplier, clamped to user-configured min/max) instead of fixed fallback SL. This ensures risk projections accurately reflect volatility-adjusted protective levels. **Dynamic Weighted Average**: Position avgEntryPrice updates with actual fill prices as each DCA layer fills. DCA layers execute ONLY on qualifying liquidations (≥60% percentile). **Filled Risk Blocking** (Oct 20, 2025): System blocks new positions and DCA layers when **filled risk** (actual loss exposure if all current positions hit SL simultaneously) exceeds Max Portfolio Risk setting. This ensures maximum loss never exceeds limit while allowing capital-efficient position sizing. **Important**: Blocking is based on filled risk (actual current exposure) ONLY, NOT margin usage (capital allocated) or reserved risk (theoretical maximum if all 5 DCA layers fill). Margin is capital deployed; risk is potential loss. A position might use 3% margin but only have 0.8% risk with tight stop losses. New positions evaluated using Layer 1 risk only, not full 5-layer potential. Reserved risk is calculated and displayed but does NOT trigger trade blocks.
- **Protective Orders**: Simplified position-level TP/SL orders with place-then-cancel pattern, scheduled reconciliation, and automatic retry.
- **Trading System**: Live-only trading with HMAC-SHA256 authentication, automatic ATR-based TP/SL, queue-based locking, and session-based tracking. Features user-facing Pause/Resume controls, configures isolated/cross margin, and uses `positionSide` for hedge mode.
- **Data Integrity**: Idempotency for orders, atomic cooldowns, and permanent preservation of all trading data. Multi-layer race condition prevention.
- **Performance Metrics**: Tracks deposited capital, ROI, transfer markers, commissions, and funding fees from exchange API.
- **Portfolio Limit**: Counts unique symbols; hedged positions count as 1.
- **Telegram Notifications**: Real-time position alerts (open/close with trade details, entry/exit prices, P&L) and daily performance reports via Telegram bot using `node-telegram-bot-api` and `chartjs-node-canvas`.

**Feature Specifications:**
- **Financial Metrics**: Realized P&L, commissions, and funding fees fetched directly from exchange API (e.g., `/fapi/v1/income`), not stored in DB.
- **WebSocket Broadcasting**: `trade_block` event broadcasts system-wide blocking information.
- **Exchange Limits UI**: Global Settings dialog displays real-time MIN_NOTIONAL, price precision, and quantity precision.

**System Design Choices:**
- **Data Persistence**: PostgreSQL via Neon serverless hosting.
- **Schema**: 13 core tables (liquidations, strategies, trade sessions, positions, fills, orders, etc.). `position_layers` table has been removed.
- **Schema Changes**: Exclusively manual SQL scripts.
- **Data Retention**: Liquidation data for 30 days; trading data and financial records are permanently preserved through archiving.
- **Trade Sync Pagination**: Handles exchange API limitations by chunking large date ranges into 7-day segments with backward cursor pagination.
- **Position Architecture**: Database fully consolidated to single-source-of-truth positions. Each realized P&L event represented by one position with real exchange fills. P&L stored permanently in database `realizedPnl` field when positions close, fetched from exchange `/fapi/v1/userTrades` API. `realizedPnl` is nullable to distinguish between "never stored" and "stored as zero".

## External Dependencies

**Core:**
- **@radix-ui/react-\***: UI primitives.
- **@tanstack/react-query**: Server state management.
- **drizzle-orm**: Type-safe PostgreSQL ORM.
- **@neondatabase/serverless**: Serverless PostgreSQL client for Neon.
- **node-telegram-bot-api**: Telegram bot integration.
- **chartjs-node-canvas**: Chart generation for Telegram reports.

**UI & Styling:**
- **Tailwind CSS**: Utility-first CSS framework.
- **class-variance-authority**: Component variant management.
- **clsx & tailwind-merge**: Class name utilities.
- **Lucide React**: Icon library.
- **date-fns**: Date manipulation.
- **Google Fonts**: Inter, JetBrains Mono.

**External APIs/Services:**
- **Aster DEX**: WebSocket for liquidation stream and user data.
- **Alpha Vantage**: Market/stock news.
- **CryptoNews-API**: Crypto news with sentiment.
- **ScrapeCreators**: Trump Truth Social posts.