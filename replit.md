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
- **Performance**: `React.memo` optimization on key components.

**Technical Implementations:**
- **Frontend State Management**: React hooks with TanStack Query.
- **Routing**: Wouter.
- **Backend Runtime**: Node.js with Express.js (TypeScript).
- **Database ORM**: Drizzle ORM (raw SQL for critical operations).
- **API**: RESTful endpoints with `/api` prefix for strategy management and data.
- **Real-time Data**: WebSocket connection to Aster DEX for live liquidation streaming and user data (ACCOUNT_UPDATE, ORDER_TRADE_UPDATE), managed by a Live Data Orchestrator.
- **Trade Logic**: Includes cascade detection, percentile threshold filtering, automatic position reconciliation, comprehensive real-time trade blocking (system-wide and per-liquidation filters), and a robust DCA system.
- **DCA System**: Integrates ATR-based volatility scaling, convex level spacing, exponential size growth, and liquidation-aware risk management. Position sizing for Layer 1 uses Start Step %; Max Portfolio Risk acts as a trade blocker. Full potential DCA risk is reserved upfront, visible in UI. Configurable DCA layer delay prevents rapid-fire entries. Atomic cooldown checks prevent race conditions. **Layer Tracking**: `layersFilled` counter increments in real-time via WebSocket fill events (updates both DB and in-memory position object for downstream logic).
- **Protective Orders**: Simplified position-level TP/SL orders with place-then-cancel pattern, scheduled reconciliation, and automatic retry.
- **Trading System**: Live-only trading with HMAC-SHA256 authentication, automatic ATR-based TP/SL, queue-based locking, and session-based tracking. Features user-facing Pause/Resume controls. Configures isolated/cross margin and uses `positionSide` for hedge mode.
- **Data Integrity**: Idempotency for orders, atomic cooldowns, and permanent preservation of all trading data. Multi-layer race condition prevention.
- **Performance Metrics**: Tracks deposited capital, ROI, transfer markers, commissions, and funding fees from exchange API.
- **Portfolio Limit**: Counts unique symbols; hedged positions count as 1.

**Feature Specifications:**
- **Financial Metrics**: Realized P&L, commissions, and funding fees fetched directly from exchange API (e.g., `/fapi/v1/income`), not stored in DB.
- **WebSocket Broadcasting**: `trade_block` event broadcasts system-wide blocking information.
- **Exchange Limits UI**: Global Settings dialog displays real-time MIN_NOTIONAL, price precision, and quantity precision.

**System Design Choices:**
- **Data Persistence**: PostgreSQL via Neon serverless hosting.
- **Schema**: 14 core tables for liquidations, strategies, trade sessions, positions, fills, orders, etc.
- **Schema Changes**: Exclusively manual SQL scripts.
- **Data Retention**: Liquidation data for 30 days; trading data and financial records are permanently preserved through archiving.
- **Trade Sync Pagination**: Handles exchange API limitations by chunking large date ranges into 7-day segments with backward cursor pagination.
- **Position Architecture** (Updated Oct 2025): Database has been consolidated to single-source-of-truth positions. Each realized P&L event is represented by ONE position with real exchange fills. Synthetic fills from legacy P&L sync have been removed. All P&L data is fetched directly from exchange API (`/fapi/v1/income`).

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