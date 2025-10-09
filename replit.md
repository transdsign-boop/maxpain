# Aster DEX Liquidations Dashboard

## Overview
A real-time liquidation monitoring dashboard for the Aster DEX exchange, designed for traders and analysts. It provides live trading liquidation data, advanced filtering, analysis tools, and a professional trading interface, offering immediate insight into market liquidation events across various cryptocurrency and tokenized stock pairs. The project aims to provide a robust, production-ready system for real-money trading with comprehensive safety checks and detailed performance tracking, including a sophisticated Dollar Cost Averaging (DCA) system.

## User Preferences
Preferred communication style: Simple, everyday language.

### 🚨 CRITICAL: DATABASE CONFIGURATION 🚨
**🛑 NEVER USE `execute_sql_tool` FOR THIS PROJECT 🛑**
**THIS APPLICATION USES NEON DATABASE EXCLUSIVELY**

- ❌ **DO NOT USE** `execute_sql_tool` - it connects to a worthless development database
- ❌ **DO NOT TRUST** any SQL query results from `execute_sql_tool` - they are from the WRONG database
- ✅ **ONLY USE** the application API endpoints to check database state (e.g., `/api/strategies`, `/api/strategies/sync`)
- ✅ **ONLY USE** application logs to verify database operations
- ✅ **ONLY USE** `npm run db:push` to apply schema changes to the real Neon database

**Why this matters:**
- The app uses Neon database via `NEON_DATABASE_URL` environment variable
- `execute_sql_tool` connects to a completely separate local development database
- These are TWO DIFFERENT DATABASES with different data
- The user has had to correct this mistake many times - DO NOT make it again

### 🚨 CRITICAL: STRATEGY CREATION POLICY 🚨
**🛑 NEVER AUTO-CREATE STRATEGIES 🛑**

- ❌ **NEVER** automatically create a new strategy under any circumstances
- ❌ **NEVER** create a strategy as a "fallback" or "default" behavior
- ✅ **ONLY** create strategies when user explicitly uses the UI to create one (future feature)
- ✅ **FAIL GRACEFULLY** - If an operation expects a strategy but none exists, return an error

**Why this matters:**
- User will build a UI for strategy creation later
- Auto-creation causes duplicate strategies and confusion
- User must have full control over when strategies are created

**PERMANENT DATA PRESERVATION**: ALL trading data MUST be preserved forever. The user requires complete access to historical trading records at any time.
- NEVER DELETE any positions, fills, or trade session data.
- When the user wants to "start fresh", ARCHIVE the current session (mark inactive) and create a new session.
- All historical sessions remain in the database permanently.
- A "Start Fresh Session" button archives the current session but preserves all data.
- The user must be able to recall any historical trading data at any time.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite.
- **UI Framework**: Radix UI primitives with shadcn/ui.
- **Styling**: Tailwind CSS with a financial trading-focused design system.
- **State Management**: React hooks with TanStack Query.
- **Routing**: Wouter.
- **UI/UX Design**: Dark/light mode, professional aesthetic (lime for profit, orange for loss), Inter font for text, JetBrains Mono for numerical data, responsive design, optimized tables/cards. Mobile responsive layout with critical controls visible and secondary actions in a Sheet menu. Cascade risk indicator uses fixed-width badges with horizontal scroll.
- **Key Features**: Collapsible trade details, live strategy editing with performance chart visualization, interactive performance chart with per-trade P&L, hedge position detection, and intelligent recommendations for assets and risk parameters based on account size and real-time liquidity.
- **Settings Organization**: All trading configuration, DCA settings, and API connection management are consolidated in the single Global Settings dialog (TradingStrategyDialog) accessed via the Settings button in the header. Settings can be exported/imported using timestamped JSON files (format: settings_YYYY-MM-DD_HH-MM-SS.json) for backup and portability. Settings automatically save when the dialog is closed.

### Backend Architecture
- **Runtime**: Node.js with Express.js.
- **Language**: TypeScript.
- **Database ORM**: Drizzle ORM with raw SQL for critical operations to bypass caching.
- **API Design**: RESTful endpoints with `/api` prefix.
- **Data Persistence**: ALL strategy changes are immediately saved to Neon database first, then loaded into memory. Nothing is stored only in memory.

### Data Storage
- **Database**: PostgreSQL with Neon serverless hosting (ALWAYS uses Neon, never local storage).
- **Configuration**: Uses `NEON_DATABASE_URL` environment variable exclusively.
- **Schema**: 13 core tables - liquidations, strategies, trade_sessions, positions, fills, orders, strategy_changes, strategy_snapshots, user_settings, users, transfers, commissions, funding_fees. The sessions table (required for Replit Auth) remains empty. All tables use indexing for optimal performance.
- **Connection**: Connection pooling with `@neondatabase/serverless` HTTP driver.
- **Migrations**: Drizzle Kit.
- **Data Retention**: Liquidation data automatically retained for 30 days only; older data deleted every 5 minutes. Trading data (positions, fills, sessions) and financial records (transfers, commissions, funding fees) are permanently preserved through archiving (never deleted).
- **Important**: All runtime operations use the Neon database. The app never uses local database storage.
- **Historical Financial Tracking**: Complete tracking of all transfer events (deposits/withdrawals), commission fees, and funding fees with idempotent sync endpoints using composite unique constraints. Sync endpoints use batched inserts with onConflictDoNothing() and returning() for accurate insert counts.

### Real-time Data Features
- Live WebSocket connection to Aster DEX for real-time liquidation streaming.
- Connection monitoring and status display.
- Dominant direction analysis using order book and funding rate data.
- Asset Ranking: By Liquidation Activity (default), Best Liquidity, or Alphabetical.
- Real-time Liquidity Metrics: Batch endpoint fetches order book depth, calculates bid/ask liquidity, and checks trade size capacity.
- Intelligent Recommendations: Recommends assets and risk parameters based on account tiers, fetched account balance, and liquidity thresholds. Provides visual warnings for unsafe user settings.
- **100% WebSocket Architecture (ZERO Polling)**: 
  - **User Data Stream** → directly updates **Live Data Orchestrator** cache → broadcasts to frontend via **WebSocket Broadcaster**
  - All live account/position data flows exclusively through WebSocket events (ACCOUNT_UPDATE, ORDER_TRADE_UPDATE)
  - Single `/api/live/snapshot` endpoint serves in-memory cache that's continuously refreshed by WebSocket events
  - Completely eliminates API polling to prevent rate limit bans (user-demanded requirement)
  - **Data Flow**: Aster DEX WebSocket → user-data-stream.ts → liveDataOrchestrator.updateAccountFromWebSocket() / updatePositionsFromWebSocket() → WebSocket broadcast → Frontend
- **Dynamic Cascade Detection**: Cascade detector automatically monitors all user-selected assets from Global Settings. Syncs on startup, strategy registration, and when selectedAssets changes. Automatically clears detectors when strategy is inactive or no assets selected, ensuring real-time monitoring always reflects current configuration.

### Security & Performance
- End-to-end TypeScript for type safety.
- Zod schemas for runtime input validation.
- Comprehensive error handling.
- Optimized performance with virtualized tables, memoized components, and efficient re-renders.
- Robust handling of duplicate liquidations and race conditions through atomic locking and queue-based processing.

### Trading System
- **Architecture**: Live-only trading application - all paper and demo modes removed for production simplicity.
- **Live Trading**: HMAC-SHA256 signature authentication for Aster DEX with comprehensive safety checks. Automatic TP/SL management (updated after each layer). Queue-based locking for sequential updates. Uses actual fill data from Aster DEX `/fapi/v1/userTrades`. Session-based tracking with singleton session model per user.
- **Strategy Management**: Singleton session model with continuous trading per user. Configurable liquidation lookback window. Single persistent session ensures all trading history is preserved in one place.
- **Settings Persistence**: When settings are updated via UI, they are saved to Neon database FIRST, then the in-memory strategy is reloaded from the database. This ensures all changes persist permanently to Neon.
- **DCA System**: Integrated Dollar Cost Averaging (DCA) system with ATR-based volatility scaling, convex level spacing, exponential size growth, liquidation-aware risk management, and automatic take profit/stop loss calculation. Uses a SQL wrapper to bypass Drizzle ORM caching issues for DCA parameter management. All DCA parameters are accessible in the Global Settings dialog under "DCA Settings (Advanced)".
- **Data Integrity**: Idempotency protection for orders. Atomic cooldown system for entries/layers to prevent duplicate orders. ALL trading data (positions, fills, sessions) is permanently preserved in the database - deletion functionality has been removed to comply with data preservation requirements.
- **Position Display**: Displays only live exchange positions fetched from Aster DEX API, ensuring accurate real-time position tracking.
- **Performance Metrics**: Comprehensive performance tracking including total deposited capital (deposits only, excluding withdrawals), accurate ROI calculation (Total P&L / Total Deposited * 100), transfer markers on performance chart (green vertical lines showing deposit amounts), and detailed fee tracking (commissions and funding fees).

## External Dependencies

### Core Dependencies
- **@radix-ui/react-\***: Accessible UI primitives.
- **@tanstack/react-query**: Server state management.
- **drizzle-orm**: Type-safe PostgreSQL ORM.
- **@neondatabase/serverless**: Serverless PostgreSQL client with connection pooling.

### Development Tools
- **Vite**: Fast build tool.
- **TypeScript**: Static type checking.
- **Tailwind CSS**: Utility-first CSS framework.
- **ESBuild**: Fast JavaScript bundler.

### UI & Styling
- **class-variance-authority**: Component variant management.
- **clsx & tailwind-merge**: Conditional class name utilities.
- **Lucide React**: Icon library.
- **date-fns**: Date manipulation.

### Font Integration
- **Google Fonts**: Inter (UI text) and JetBrains Mono (numerical data).
