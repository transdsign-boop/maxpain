# Aster DEX Liquidations Dashboard

## Overview
A real-time liquidation monitoring dashboard for the Aster DEX exchange, designed for traders and analysts. It provides live trading liquidation data, advanced filtering, analysis tools, and a professional trading interface, offering immediate insight into market liquidation events across various cryptocurrency and tokenized stock pairs. The project aims to provide a robust, production-ready system for real-money trading with comprehensive safety checks and detailed performance tracking, including a sophisticated Dollar Cost Averaging (DCA) system.

## User Preferences
Preferred communication style: Simple, everyday language.
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
- **Settings Organization**: All trading configuration, DCA settings, historical sessions, and API connection management are consolidated in the single Trading Settings dialog (TradingStrategyDialog) accessed via the Settings button in the header.

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
- **Data Retention**: Liquidation data automatically retained for 5 days only; older data deleted every 5 minutes. Trading data (positions, fills, sessions) is permanently preserved through archiving (never deleted).
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

### Trading System
- **Live Trading**: HMAC-SHA256 signature authentication for Aster DEX with safety checks. Automatic TP/SL management (updated after each layer). Queue-based locking for sequential updates. Uses actual fill data from Aster DEX `/fapi/v1/userTrades`. Session-based tracking.
- **Paper Trading**: Mirrors live trading logic, using real exchange balance and fee schedule for accurate simulation, but without sending API signals.
- **Strategy Management**: Singleton session model with continuous trading per user. Configurable liquidation lookback window. Live mode toggle creates new session boundaries.
- **DCA System**: Integrated Dollar Cost Averaging (DCA) system with ATR-based volatility scaling, convex level spacing, exponential size growth, liquidation-aware risk management, and automatic take profit/stop loss calculation. Uses a SQL wrapper to bypass Drizzle ORM caching issues for DCA parameter management. All DCA parameters are accessible in the Trading Settings dialog under "DCA Settings (Advanced)".
- **Historical Sessions**: Complete trading history viewer in Trading Settings dialog showing all current and archived sessions with positions, fills, P&L, and win rates. Accessible via "History" button in dialog footer.
- **Data Integrity**: Idempotency protection for orders. Atomic cooldown system for entries/layers to prevent duplicate orders.
- **Position Display**: Live mode displays only exchange positions; paper mode shows simulated positions.

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