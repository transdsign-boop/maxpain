# Aster DEX Liquidations Dashboard

### Overview
The Aster DEX Liquidations Dashboard is a real-time monitoring and trading platform for the Aster DEX exchange. It provides live liquidation data, advanced filtering, and analysis tools for cryptocurrency and tokenized stock pairs. The project aims to be a robust, production-ready system for real-money trading, offering comprehensive safety checks, detailed performance tracking, and a sophisticated Dollar Cost Averaging (DCA) system.

### User Preferences
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
- 📌 Example: position_layers table was created via manual SQL script (see project history)

📊 REALIZED P&L, COMMISSION & FUNDING FEE DATA
All financial metrics are fetched directly from the exchange API, NOT stored in the database

Realized P&L Source:
- ✅ Uses `/fapi/v1/income` endpoint with `incomeType=REALIZED_PNL` filter
- ✅ Matches exactly how Aster DEX Portfolio Overview calculates P&L
- ✅ Fetches all historical records with proper pagination (startTime=0 for all-time data)
- ⚠️ IMPORTANT: The `incomeType` filter is required - fetching without it returns incorrect data

Commissions and Funding Fees:
- ✅ `/api/commissions?startTime=X&endTime=Y` - Fetches commission data from exchange with optional date range filters
- ✅ `/api/funding-fees?startTime=X&endTime=Y` - Fetches funding fee data from exchange with optional date range filters
- 📍 Data is retrieved in real-time from Aster DEX `/fapi/v1/income` endpoint
- 📍 Supports pagination (1000 records per batch) for complete historical data
- 📍 Frontend filters this data by selected date range for accurate metrics calculation

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

### System Architecture

**Frontend:**
- **Frameworks**: React 18, TypeScript, Vite.
- **UI**: Radix UI, shadcn/ui, Tailwind CSS (financial trading-focused design with lime for profit, orange for loss).
- **State Management**: React hooks with TanStack Query.
- **Routing**: Wouter.
- **Design**: Dark/light modes, responsive layout (Inter font for text, JetBrains Mono for numerical data), optimized tables/cards, mobile-first approach.
- **Features**: Collapsible trade details, live strategy editing with performance charts, interactive P&L charts, hedge position detection, intelligent asset/risk recommendations, consolidated Global Settings dialog for all trading configurations, DCA settings, and API management (export/import JSON settings).
- **Performance**: React.memo optimization on LiveLiquidationsSidebar, StrategyStatus, and PerformanceOverview components to prevent unnecessary re-renders and ensure smooth UI performance.

**Backend:**
- **Runtime**: Node.js with Express.js.
- **Language**: TypeScript.
- **Database ORM**: Drizzle ORM (raw SQL for critical operations).
- **API**: RESTful endpoints with `/api` prefix.
- **Data Persistence**: All strategy changes are immediately saved to the Neon database and then loaded into memory.

**Data Storage:**
- **Database**: PostgreSQL via Neon serverless hosting (`NEON_DATABASE_URL`).
- **Schema**: 14 core tables (e.g., `liquidations`, `strategies`, `trade_sessions`, `positions`, `position_layers`, `fills`, `orders`, `strategy_changes`, `strategy_snapshots`, `user_settings`, `users`, `transfers`, `commissions`, `funding_fees`).
- **Connection**: `@neondatabase/serverless` HTTP driver with connection pooling.
- **Schema Changes**: Manual SQL scripts only (drizzle.config.ts uses wrong database). Update `shared/schema.ts` then execute SQL in Neon SQL Editor.
- **Data Retention**: Liquidation data for 30 days; trading data (positions, fills, sessions) and financial records (transfers, commissions, funding fees) are permanently preserved through archiving.

**Real-time Data & Trading:**
- **WebSocket**: Live connection to Aster DEX for real-time liquidation streaming and user data (ACCOUNT_UPDATE, ORDER_TRADE_UPDATE).
- **Live Data Orchestrator**: Caches and broadcasts real-time account/position data to the frontend via WebSocket. Eliminates API polling.
- **Cascade Detection**: Dynamic monitoring of selected assets, syncing on startup and configuration changes, with aggregate-based trade filtering (all-or-none decisions across all monitored symbols).
- **Percentile Threshold**: Entry and layer decisions use percentile rank calculated from ALL historical liquidations for each symbol (matching UI badge calculation). 60% threshold = only enter liquidations at 60th percentile or higher (top 40%).
- **Cascade Detector Polling (Critical - DO NOT MODIFY)**: Highly optimized polling architecture for price updates and open interest to prevent rate limits (10-second tick interval, rotating OI fetch, 60-second OI cache).
- **Cascade Detector Logging**: Ultra-minimal logging that only outputs when liquidation notional >$100k or quality is excellent, reducing backend noise from ~400 lines/min to ~20 lines/min.
- **Trading System**: Live-only trading with HMAC-SHA256 authentication, automatic ATR-based TP/SL management, queue-based locking for updates, and session-based tracking.
- **Hedge Mode Orders (CRITICAL)**: All protective orders MUST include `positionSide` parameter (LONG/SHORT) for hedge mode compatibility. LIMIT TP orders must NOT include `reduceOnly` parameter (automatically implied when `positionSide` is set). STOP_MARKET SL orders can optionally include `reduceOnly: true`.
- **DCA System**: Integrated Dollar Cost Averaging with ATR-based volatility scaling, convex level spacing, exponential size growth, and liquidation-aware risk management. Parameters managed via Global Settings.
- **SIMPLIFIED TP/SL APPROACH**: Position-level protective orders only. Each position has ONE TP and ONE SL order based on average entry price and total quantity. No individual layer TP/SL. Progressive layer monitoring DISABLED.
- **Take Profit**: ATR-based dynamic TP calculation using exit cushion multiplier (default 0.6x ATR). Calculated from average entry price for entire position. Falls back to fixed percentage only if DCA not configured.
- **Protective Order Safety (CRITICAL)**: Place-then-cancel pattern ensures protective orders are ALWAYS active. New TP/SL orders are placed BEFORE old ones are cancelled, eliminating dangerous gaps. Reconciliation runs every 30 seconds (reduced from 60s) for faster updates.
- **Data Integrity**: Idempotency for orders, atomic cooldowns, permanent preservation of all trading data.
- **Performance Metrics**: Comprehensive tracking including deposited capital, ROI, transfer markers, commissions, and funding fees.

### External Dependencies

**Core:**
- **@radix-ui/react-\***: Accessible UI primitives.
- **@tanstack/react-query**: Server state management.
- **drizzle-orm**: Type-safe PostgreSQL ORM.
- **@neondatabase/serverless**: Serverless PostgreSQL client.

**UI & Styling:**
- **Tailwind CSS**: Utility-first CSS framework.
- **class-variance-authority**: Component variant management.
- **clsx & tailwind-merge**: Class name utilities.
- **Lucide React**: Icon library.
- **date-fns**: Date manipulation.
- **Google Fonts**: Inter, JetBrains Mono.

**Development Tools:**
- **Vite**: Fast build tool.
- **TypeScript**: Static type checking.
- **ESBuild**: Fast JavaScript bundler.