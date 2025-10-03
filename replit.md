# Aster DEX Liquidations Dashboard

## Overview
A real-time liquidation monitoring dashboard for the Aster DEX exchange, designed for traders and analysts. It provides live trading liquidation data, advanced filtering, analysis tools, and a professional trading interface, offering immediate insight into market liquidation events across various cryptocurrency and tokenized stock pairs. The project aims to provide a robust, production-ready system for real-money trading with comprehensive safety checks and detailed performance tracking.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript.
- **Build Tool**: Vite.
- **UI Framework**: Radix UI primitives with shadcn/ui.
- **Styling**: Tailwind CSS with a custom financial trading-focused design system.
- **State Management**: React hooks with TanStack Query.
- **Routing**: Wouter.
- **UI/UX Design**: Dark/light mode, professional trading aesthetic with consistent color scheme (bright lime rgb(190, 242, 100) for positive/profit states, neutral orange/amber rgb(251, 146, 60) for negative/loss states), Inter font for text, JetBrains Mono for numerical data, responsive design, optimized tables and cards for financial data.
- **Key Features**: Collapsible trade details showing layer-by-layer entry/exit information and fees; live strategy editing with tracked changes and performance chart visualization; interactive performance chart with per-trade P&L bars (lime for gains, orange for losses) and split cumulative P&L line (lime above zero, orange below zero) with gradient fills; hedge position detection and labeling for overlapping long/short positions on same symbol.

### Backend Architecture
- **Runtime**: Node.js with Express.js.
- **Language**: TypeScript.
- **Database ORM**: Drizzle ORM.
- **API Design**: RESTful endpoints with `/api` prefix.

### Data Storage
- **Database**: Shared PostgreSQL with Neon serverless hosting (works across dev and production).
- **Configuration**: Uses `NEON_DATABASE_URL` environment variable for shared database access.
- **Schema**: Dedicated tables for liquidations and users with indexing.
- **Connection**: Connection pooling with `@neondatabase/serverless`.
- **Migrations**: Drizzle Kit.
- **Environment Setup**: Application prioritizes `NEON_DATABASE_URL` over `DATABASE_URL` to ensure consistent data across all environments. Clear startup logging indicates which database is being used.

### Real-time Data Features
- Live WebSocket connection to Aster DEX for real-time liquidation streaming.
- Connection monitoring and status display.
- Configurable refresh intervals for data updates.
- Dominant direction analysis using order book and funding rate data.
- Strategy engine evaluates ALL real-time liquidations (including database duplicates) for trade signals.
- **Data Retention**: Liquidation data automatically retained for 5 days only - older data deleted every 5 minutes during cleanup cycles.
- **Asset Ranking**: Three sorting modes available:
  - **Liquidation Activity** (default): Sorted by liquidation count, showing most active trading pairs first.
  - **Best Liquidity**: Sorted by real-time order book depth (min of bid/ask liquidity) from Aster DEX API.
  - **Alphabetical**: Simple A-Z sorting.
- **Real-time Liquidity Metrics**: Batch endpoint (`/api/analytics/liquidity/batch`) fetches order book depth for multiple symbols, calculates bid/ask liquidity in USD, and determines if each side can handle 2x the user's trade size. Uses minimum of bid/ask depth as limiting factor since longs need asks and shorts need bids.
- **Intelligent Recommendations**: System recommends assets and risk parameters based on account size:
  - **Account Tiers**: Micro (<$1k), Small ($1k-$10k), Mid ($10k-$50k), Large (>$50k) with tier-appropriate liquidity requirements (5x, 10x, 15x, 25x trade size respectively).
  - **Exchange Account Balance**: Account balance automatically fetched from Aster DEX API (`/api/live/account`) for both paper and live trading modes, providing real-time balance information for accurate recommendations.
  - **Asset Recommendations**: Filters assets meeting liquidity thresholds for user's account tier, displayed with green badges in asset selection.
  - **Automated Risk Calculations**: Recommends order size (40% of minimum side liquidity), stop loss % (1.0-2.5% based on tier), take profit % (1.5-2x stop loss based on liquidity ratio), and max layers (constrained by liquidity depth).
  - **Limiting Asset Detection**: Identifies the asset with lowest liquidity in selection and optimizes all parameters for that constraint.
  - **Visual Warnings**: Orange warning badges appear when user settings exceed safe recommendations (position size too large, layers exceed liquidity capacity, risk parameters inappropriate for asset liquidity).

### Security & Performance
- End-to-end TypeScript for type safety.
- Zod schemas for runtime input validation.
- Comprehensive error handling.
- Optimized performance with virtualized tables, memoized components, and efficient re-renders.
- Robust handling of duplicate liquidations and race conditions through atomic locking and queue-based processing.

### Trading System
- **Live Trading**: Implemented HMAC-SHA256 signature authentication for Aster DEX with comprehensive safety checks, including API credential validation, order parameter checks, receive window for clock sync, and "REAL MONEY" warnings. **Automatic TP/SL placement**: Take profit and stop loss orders are automatically placed on the exchange immediately after every new position opens (Layer 1 entries only). Exit orders automatically placed on Aster DEX using correct order types (limit for TP, stop market for SL). **CRITICAL: System NEVER programmatically closes positions** - it only places and monitors TP/SL orders on the exchange, letting the exchange execute them naturally. Session-based tracking with `liveSessionStartedAt` timestamp ensures each live mode session starts fresh, showing only trades from the current session (similar to paper trading behavior).
- **Paper Trading**: Mirrors live trading exactly - uses real exchange balance for accurate position sizing, applies same fee schedule (0.01% maker for TP limit orders, 0.035% taker for SL stop market orders and entries), and follows identical entry/exit logic. Only difference: does not send API signals to the exchange. Realistic simulation of limit order behavior, including dynamic price chasing and automatic cancellation.
- **Strategy Management**: Singleton session model with one continuous trading session per user; strategy parameters are adjustable settings. Configurable liquidation lookback window for percentile-based trade signals. Live mode sessions tracked via timestamp - toggling to live mode creates a new session boundary, toggling back to paper clears it. **Single toggle control** - live mode toggle in header controls entire system, Trading Settings dialog only contains strategy parameters (no duplicate toggle).
- **Exit Order Types**: Take profit exits use LIMIT orders (0.01% maker fee), stop loss exits use STOP_MARKET orders (0.035% taker fee), manual closes use LIMIT orders (0.01% maker fee). All fees correctly applied in both paper and live modes. **Exit Behavior**: System places protective TP/SL orders and monitors them via auto-repair; positions close ONLY when the exchange executes these orders, never programmatically by the app.
- **Real Exchange Data Integration**: Live mode now uses actual fill data from Aster DEX `/fapi/v1/userTrades` endpoint instead of calculated values. After placing entry/exit orders, system fetches actual fills with retry logic (3 attempts, 500ms delay) and uses real commission, fill price, and quantity. Multi-fill orders are aggregated (weighted avg price, total qty/commission) for accurate P&L accounting. Shared utilities in `server/exchange-utils.ts` handle fill fetching and aggregation. **Known Issue**: Manual close for exchange-displayed positions (ID prefix "live-") bypasses fill sync - places market order on exchange but doesn't update database session balance or create fill records.
- **Data Integrity**: Comprehensive data validation and integrity fixes, including removal of duplicate liquidations and fills, correct session update logic, and recalculated session statistics. Added database-level idempotency protection via unique constraint on (orderId, sessionId) with graceful duplicate handling. **Atomic cooldown system** eliminates race conditions: cooldown is set immediately and atomically when entry/layer decision is made (inside `shouldEnterPosition()` for entries, at start of `executeLayer()` for layers), preventing duplicate orders when multiple liquidations arrive within milliseconds.
- **Position Display**: Live mode fetches and displays ONLY exchange positions via `/fapi/v2/positionRisk` API, never showing paper trading positions. Paper mode shows only simulated positions from database. Data sources are completely separated by mode.
- **Session Management**: Users can start new trading sessions or load previous ones via header controls. Sessions automatically inherit the current trading mode (paper/live) from strategy settings. Starting a new session saves the current session with date range and P&L, then resets all performance metrics and positions for a fresh start. Session history displays session name, mode indicator (🔴 Live / 📄 Paper), date range, total P&L, and trade count. Sessions provide complete data isolation for organizing trading history into discrete periods.
- **Features**: Live/Paper Trading Toggle with session-based tracking; real-time price data directly from Aster DEX API for all calculations; cross-browser settings persistence to database; live mode displays only current session trades and metrics; race condition protection ensures max layers limit is never exceeded.

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

### Deployment & Hosting
- **Replit Integration**: Configured for Replit hosting.
- **Environment Variables**: For database connection and configuration.