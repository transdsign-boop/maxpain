# Aster DEX Liquidations Dashboard

## Overview
A real-time liquidation monitoring dashboard for the Aster DEX exchange, designed for traders and analysts. It provides live trading liquidation data, advanced filtering, analysis tools, and a professional trading interface, offering immediate insight into market liquidation events across various cryptocurrency and tokenized stock pairs. The project aims to provide a robust, production-ready system for real-money trading with comprehensive safety checks and detailed performance tracking, including a sophisticated Dollar Cost Averaging (DCA) system.

## User Preferences
Preferred communication style: Simple, everyday language.

### ⚠️ CRITICAL: DATABASE CONFIGURATION ⚠️
**THIS APPLICATION USES NEON DATABASE EXCLUSIVELY - NEVER LOCAL/DEVELOPMENT DATABASE**
- The `execute_sql_tool` connects to a DEVELOPMENT database that is NOT the same as the production app database
- The actual application ALWAYS uses Neon database via `NEON_DATABASE_URL` environment variable
- **SCHEMA CHANGES**: `drizzle.config.ts` uses DATABASE_URL (local) by design and cannot be edited. To push schema changes to Neon:
  1. Try: `DATABASE_URL="$NEON_DATABASE_URL" npm run db:push`
  2. If that prompts for input, apply changes directly via Node.js SQL (see Oct 2025 session for example)
- DO NOT trust `execute_sql_tool` results - they show the development database, not the real app database
- If columns/tables "don't exist" in execute_sql_tool but the app says they do, it's because you're looking at the wrong database
- **REMEMBER THIS IN EVERY SESSION** - The user has had to remind about this many times

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
- **Database ORM**: Drizzle ORM.
- **API Design**: RESTful endpoints with `/api` prefix.

### Data Storage
- **Database**: PostgreSQL with Neon serverless hosting (ALWAYS uses Neon, never local storage).
- **Configuration**: Uses `NEON_DATABASE_URL` environment variable exclusively.
- **Schema**: Dedicated tables for liquidations, strategies, positions, fills, sessions, and snapshots with indexing.
- **Connection**: Connection pooling with `@neondatabase/serverless` HTTP driver.
- **Migrations**: Drizzle Kit.
- **Data Retention**: Liquidation data automatically retained for 30 days only; older data deleted every 5 minutes. Trading data (positions, fills, sessions) is permanently preserved through archiving (never deleted).
- **Important**: All runtime operations use the Neon database. The app never uses local database storage.

### Real-time Data Features
- Live WebSocket connection to Aster DEX for real-time liquidation streaming.
- Connection monitoring and status display.
- Dominant direction analysis using order book and funding rate data.
- Asset Ranking: By Liquidation Activity (default), Best Liquidity, or Alphabetical.
- Real-time Liquidity Metrics: Batch endpoint fetches order book depth, calculates bid/ask liquidity, and checks trade size capacity.
- Intelligent Recommendations: Recommends assets and risk parameters based on account tiers, fetched account balance, and liquidity thresholds. Provides visual warnings for unsafe user settings.

### Security & Performance
- End-to-end TypeScript for type safety.
- Zod schemas for runtime input validation.
- Comprehensive error handling.
- Optimized performance with virtualized tables, memoized components, and efficient re-renders.
- Robust handling of duplicate liquidations and race conditions through atomic locking and queue-based processing.
- **Credential Management**: API secrets (Aster DEX, Bybit) stored in database, sanitized from all API responses. Boolean flags (`hasAsterApiSecret`, `hasBybitApiSecret`) indicate credential existence without exposing values. Backend preserves existing secrets when empty form values are submitted (user-friendly UX: "Already configured - leave blank to keep").

### Trading System
- **Live Trading**: HMAC-SHA256 signature authentication for Aster DEX with safety checks. Automatic TP/SL management (updated after each layer). Queue-based locking for sequential updates. Uses actual fill data from Aster DEX `/fapi/v1/userTrades`. Session-based tracking.
- **Demo Trading (Bybit Testnet)**: Replaced paper trading with Bybit testnet integration. HMAC-SHA256 signature authentication, real order execution on testnet with fake money. Bybit API credentials (key/secret) stored in strategies table, sanitized from all API responses for security. Demo mode requires credentials - backend validation enforces this with 400 error if missing.
- **Strategy Management**: Singleton session model with continuous trading per user. Configurable liquidation lookback window. Live/demo mode toggle creates new session boundaries. Exchange routing: Live mode = Aster DEX, Demo mode = Bybit testnet.
- **Exchange Tracking**: All positions, fills, and sessions now track `exchange` field ("aster" or "bybit") for proper routing and data isolation.
- **DCA System**: Integrated Dollar Cost Averaging (DCA) system with ATR-based volatility scaling, convex level spacing, exponential size growth, liquidation-aware risk management, and automatic take profit/stop loss calculation. Uses a SQL wrapper to bypass Drizzle ORM caching issues for DCA parameter management. All DCA parameters are accessible in the Global Settings dialog under "DCA Settings (Advanced)".
- **Data Integrity**: Idempotency protection for orders. Atomic cooldown system for entries/layers to prevent duplicate orders. ALL trading data (positions, fills, sessions) is permanently preserved in the database - deletion functionality has been removed to comply with data preservation requirements.
- **Position Display**: Live mode displays only exchange positions; demo mode shows simulated positions.

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