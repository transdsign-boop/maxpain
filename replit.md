# Aster DEX Liquidations Dashboard

## Overview
A real-time liquidation monitoring dashboard for the Aster DEX exchange, designed for traders and analysts. It provides live trading liquidation data, advanced filtering, analysis tools, and a professional trading interface, offering immediate insight into market liquidation events across various cryptocurrency and tokenized stock pairs. The project aims to provide a robust, production-ready system for real-money trading with comprehensive safety checks and detailed performance tracking.

## Current Status (October 4, 2025)
✅ **Application Fully Operational**: All core features working correctly
- Trading strategy engine running with active liquidation monitoring
- Real-time WebSocket connections established (Aster DEX liquidation stream + User Data Stream)
- Live position tracking and account balance updates
- Performance metrics, charts, and funding cost calculations working
- Order reconciliation and cascade detection active

## DCA System - Ready to Use! 🎉

The sophisticated DCA (Dollar Cost Averaging) system is **fully implemented and ready for integration** using a SQL wrapper that bypasses Drizzle ORM's caching bug.

### System Components
1. **`server/dca-calculator.ts`** - Mathematical DCA engine with:
   - ATR-based volatility scaling
   - Convex level spacing (levels get further apart)
   - Exponential size growth per level
   - Liquidation-aware risk management
   - Automatic take profit and stop loss calculation

2. **`server/dca-sql.ts`** - SQL wrapper module that:
   - Bypasses Drizzle's query cache using `db.execute(sql\`...\`)`
   - Provides safe CRUD operations for DCA parameters
   - Works with existing database columns

3. **`server/dca-integration-example.ts`** - Complete usage examples showing:
   - How to initialize DCA settings
   - How to open positions with DCA levels
   - How to monitor and adjust active DCA positions
   - How to adapt to market volatility
   - Preset modes (conservative/moderate/aggressive)

### Quick Start
```typescript
import { getStrategyWithDCA, updateStrategyDCAParams } from './dca-sql';
import { calculateDCALevels } from './dca-calculator';

// 1. Set DCA parameters for a strategy
await updateStrategyDCAParams(strategyId, {
  dcaStartStepPercent: "0.4",      // First DCA at 0.4% from entry
  dcaSpacingConvexity: "1.2",      // Convex spacing
  dcaSizeGrowth: "1.8",            // Each level 1.8x larger
  dcaMaxRiskPercent: "1.0",        // Max 1% account risk
  dcaVolatilityRef: "1.0",         // Volatility reference
  dcaExitCushionMultiplier: "0.6"  // Exit at 60% of DCA distance
});

// 2. Calculate DCA levels when opening a position
const strategy = await getStrategyWithDCA(strategyId);
const dcaLevels = calculateDCALevels({
  symbol, side, initialPrice, accountBalance,
  strategy: { /* DCA params from strategy */ },
  klines, precision
});

// 3. Place orders at calculated levels
// See server/dca-integration-example.ts for complete implementation
```

### Database Columns (Already Exist)
The following columns are in the database and accessible via the SQL wrapper:
- **Strategies**: `dca_start_step_percent`, `dca_spacing_convexity`, `dca_size_growth`, `dca_max_risk_percent`, `dca_volatility_ref`, `dca_exit_cushion_multiplier`
- **Positions**: `initial_entry_price`

### Why SQL Wrapper?
Drizzle ORM has a persistent caching bug with Neon where it reports "column does not exist" even though the columns physically exist. The SQL wrapper uses `db.execute(sql\`...\`)` to bypass the ORM's query cache entirely while still using Drizzle's connection driver.

### Next Steps to Enable DCA
1. Integrate `dca-sql.ts` functions into `strategy-engine.ts`
2. Call `calculateDCALevels()` when opening positions
3. Place limit orders at calculated DCA levels
4. Update position tracking to monitor layer fills
5. Adjust TP/SL as layers fill

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
- **Mobile Responsive Layout**: Optimized for mobile screens (320-414px) with overflow menu pattern for header - critical controls (Logo, Live Mode, Connection Status, Pause, Emergency Stop) remain visible, while secondary actions (Settings, Theme toggle) are accessed via Sheet menu. Cascade risk indicator uses fixed-width metric badges with horizontal scroll capability to prevent overlapping.
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
- **Live Trading**: Implemented HMAC-SHA256 signature authentication for Aster DEX with comprehensive safety checks, including API credential validation, order parameter checks, receive window for clock sync, and "REAL MONEY" warnings. **Automatic TP/SL management**: Take profit and stop loss orders are automatically placed on the exchange after position entry, then UPDATED (not duplicated) after each layer to reflect increased position size. Uses place-then-cancel strategy to avoid exposure window. Queue-based locking ensures sequential updates even with rapid fills (3+ concurrent). Orders filtered by position side in dual mode to prevent cross-position interference. Exit orders use correct types (limit for TP, stop market for SL). Session-based tracking with `liveSessionStartedAt` timestamp ensures each live mode session starts fresh, showing only trades from the current session (similar to paper trading behavior).
- **Paper Trading**: Mirrors live trading exactly - uses real exchange balance for accurate position sizing, applies same fee schedule (0.01% maker for TP limit orders, 0.035% taker for SL stop market orders and entries), and follows identical entry/exit logic. Only difference: does not send API signals to the exchange. Realistic simulation of limit order behavior, including dynamic price chasing and automatic cancellation.
- **Strategy Management**: Singleton session model with one continuous trading session per user; strategy parameters are adjustable settings. Configurable liquidation lookback window for percentile-based trade signals. Live mode sessions tracked via timestamp - toggling to live mode creates a new session boundary, toggling back to paper clears it. **Single toggle control** - live mode toggle in header controls entire system, Trading Settings dialog only contains strategy parameters (no duplicate toggle).
- **Exit Order Types**: Take profit exits use LIMIT orders (0.01% maker fee), stop loss exits use STOP_MARKET orders (0.035% taker fee), manual closes use LIMIT orders (0.01% maker fee). All fees correctly applied in both paper and live modes.
- **Real Exchange Data Integration**: Live mode now uses actual fill data from Aster DEX `/fapi/v1/userTrades` endpoint instead of calculated values. After placing entry/exit orders, system fetches actual fills with retry logic (3 attempts, 500ms delay) and uses real commission, fill price, and quantity. Multi-fill orders are aggregated (weighted avg price, total qty/commission) for accurate P&L accounting. Shared utilities in `server/exchange-utils.ts` handle fill fetching and aggregation. **Known Issue**: Manual close for exchange-displayed positions (ID prefix "live-") bypasses fill sync - places market order on exchange but doesn't update database session balance or create fill records.
- **Data Integrity**: Comprehensive data validation and integrity fixes, including removal of duplicate liquidations and fills, correct session update logic, and recalculated session statistics. Added database-level idempotency protection via unique constraint on (orderId, sessionId) with graceful duplicate handling. **Atomic cooldown system** eliminates race conditions: cooldown is set immediately and atomically when entry/layer decision is made (inside `shouldEnterPosition()` for entries, at start of `executeLayer()` for layers), preventing duplicate orders when multiple liquidations arrive within milliseconds.
- **Position Display**: Live mode fetches and displays ONLY exchange positions via `/fapi/v2/positionRisk` API, never showing paper trading positions. Paper mode shows only simulated positions from database. Data sources are completely separated by mode.
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