# Aster DEX Liquidations Dashboard

## Overview

A real-time liquidation monitoring dashboard for the Aster DEX exchange. This application displays live trading liquidation data with advanced filtering, analysis tools, and a professional trading interface. Built for traders and analysts who need immediate insight into market liquidation events across various cryptocurrency and tokenized stock pairs.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

- **Fixed Duplicate Position Creation Race Condition (2025-10-01):** Resolved massive position duplication bug where concurrent liquidations for the same symbol created duplicate positions. When multiple liquidations arrived milliseconds apart, both checked for existing positions BEFORE either could create one, causing both to execute entry logic. Fixed by adding session+symbol atomic locking with same proven pattern as liquidation deduplication - concurrent processes now wait for lock, then re-check if position was created. Deleted 180 duplicate positions and 24 incorrectly distributed fills. Corrected metrics: totalTrades 196→22, openTrades 9→7
- **Fixed Race Condition in Liquidation Deduplication (2025-10-01):** Resolved critical race condition causing duplicate liquidations to appear in UI and database. When duplicate WebSocket messages arrived milliseconds apart, they both bypassed deduplication checks. Fixed by reordering logic to check processingQueue first, creating an atomic lock per signature. Deleted 14 existing duplicates from database. System now properly handles Aster DEX's duplicate message broadcasts
- **Comprehensive Data Validation & Integrity Fixes (2025-10-01):** Performed full database audit and fixed critical data integrity issues:
  - Deleted 1,281 duplicate liquidations from database (Aster WebSocket occasionally sends duplicates milliseconds apart)
  - Fixed duplicate exit fills bug - deleted 293 duplicates and added position.isOpen guard to prevent future re-closings
  - Fixed session update logic to fetch from database instead of stale in-memory cache, preventing incorrect balance calculations after server restarts
  - Recalculated session statistics from actual data: balance $11,524.21 (was $9,990.66), P&L +$1,524.21 (was -$6.22), trades 196 (was 6)
  - Fixed performance overview endpoint to count only closed positions as totalTrades (was incorrectly counting all positions including open ones)
  - Verified all 227 positions have valid layer structure (≤5 layers, no duplicates)
  - Confirmed all new fills have correct 0.035% fees; 81 historical fills with $0 fees are from before fee system was implemented
- **Fixed Exit Fee Calculation Bug:** Resolved issue where exit fees were always $0 due to session lookup mismatch. The strategy engine now stores sessions by both strategy ID and session ID, ensuring exit fees are properly calculated at 0.035% for paper trading mode. This fix applies to all future position closings
- **Enhanced Completed Trade Details:** Completed trades now display comprehensive layer-by-layer information in a collapsible interface. When expanded, each trade shows all entry layers (quantity, price, timestamp, and individual fee) grouped together, followed by the exit fill with its details. Fees are now separated into "Entry Fees" and "Exit Fees" for precise cost tracking. The collapsible design keeps the UI clean while providing detailed insights when needed
- **Live Strategy Editing with Change Tracking:** Trading strategies can now be edited while actively running, with all changes automatically tracked and visualized. Strategy modifications are recorded in the database with before/after field values and displayed as blue change cards interspersed chronologically with completed trades. Performance chart includes vertical reference lines marking exact timestamps when strategy parameters were updated, providing complete visibility into how strategy adjustments affect trading performance
- **Consistent Long/Short Color Scheme:** Standardized color coding across entire application - green for LONG positions/liquidations, red for SHORT positions/liquidations. Applied to all badges, labels, charts, and position indicators throughout LiveLiquidationsSidebar, StrategyStatus, LiquidationAnalytics, HistoricalLiquidationTable, and LiquidationPriceChart
- **Global Trading Strategy Button:** Replaced collapsible trading control panel with a prominent "Trading Strategy" button in the top header bar. Opens a full-screen dialog popup for strategy configuration, providing easier access and better organization of settings
- **Performance Chart Visualization:** Added interactive chart to Performance Overview showing all completed trades with individual trade P&L bars (green for wins, red for losses) and cumulative P&L line graph. Chart includes detailed tooltips with trade information, timestamps, and P&L breakdown. Updates in real-time as new trades complete. Chart is always visible even with no trades (shows empty state)
- **Realistic Limit Order Simulation (Paper Mode):** Paper trading now fully simulates limit order behavior identical to live trading. Limit orders remain pending until market price crosses the limit price, with dynamic price chasing when market moves beyond slippage tolerance, and automatic cancellation after maxRetryDurationMs timeout. Market orders continue to fill immediately
- **Simulated Trading Fees (Paper Mode Only):** Added realistic Aster DEX taker fee simulation (0.035%) for paper trading mode to provide accurate P&L calculations. Fees are calculated on both entry and exit trades, deducted from balance, and displayed in completed trade logs. Live trading mode does not simulate fees as real fees are handled by the exchange
- **Position Cards Current Price Display:** Added real-time current price to position cards, calculated from unrealized P&L and displayed alongside average entry, stop loss, and take profit prices
- **Cross-Browser Settings Persistence:** Settings and strategies now automatically persist to the database using a fixed user ID. No login required - all data is stored in PostgreSQL and available across any browser or device accessing the application
- **Removed Authentication:** Removed Replit Auth system per user request - this is a personal app that doesn't need login functionality
- **Fixed duplicate liquidation entries:** Implemented multi-layer deduplication to prevent identical liquidations from being stored twice:
  - Queue-based processing to serialize duplicate signatures  
  - Numeric comparison for decimal columns (size/price) instead of string equality
  - Database error handling as fallback for race conditions
  - Note: Aster DEX WebSocket sometimes sends duplicate messages milliseconds apart, which the system now handles gracefully
- **Live/Paper Trading Toggle:** Added ability to switch between paper trading (simulated) and live trading (real orders on Aster DEX). Trading mode is configurable per strategy with a simple toggle switch
- **Collapsible Trading Strategy Panel:** Trading strategy configuration section is now collapsible for better screen space management
- **Real-time Price Data:** Eliminated all cached price data - all P&L calculations, position closings, and order placements now use live prices fetched directly from Aster DEX API
- **Added dominant direction analysis feature:** Integrates real-time Aster DEX order book and funding rate data to determine market sentiment (bullish/bearish/neutral) with confidence scoring algorithm that combines order book pressure (60%) and funding rates (40%)
- **Database cleanup:** Removed 237 fake liquidation entries to ensure database contains only real Aster DEX data
- **Enhanced analytics filtering:** Analytics section now only shows user-selected tracked assets instead of all available assets in database

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript for type safety and modern component patterns
- **Build Tool**: Vite for fast development and optimized production builds
- **UI Framework**: Radix UI primitives with shadcn/ui component library for consistent, accessible design
- **Styling**: Tailwind CSS with custom design system based on financial trading aesthetics
- **State Management**: React hooks with TanStack Query for server state management
- **Routing**: Wouter for lightweight client-side routing

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript for full-stack type safety
- **Database ORM**: Drizzle ORM for type-safe database operations
- **API Design**: RESTful endpoints with `/api` prefix for clear separation

### Data Storage
- **Database**: PostgreSQL with Neon serverless hosting
- **Schema**: Dedicated tables for liquidations and users with proper indexing
- **Connection**: Connection pooling with `@neondatabase/serverless` for optimal performance
- **Migrations**: Drizzle Kit for database schema management

### Real-time Data Features
- **Mock Data**: Currently using static mock data for development/testing
- **WebSocket Ready**: Architecture prepared for real-time WebSocket integration
- **Connection Status**: Built-in connection monitoring and status display
- **Auto-refresh**: Configurable refresh intervals for data updates

### UI/UX Design System
- **Theme Support**: Dark/light mode toggle with system preference detection
- **Professional Aesthetic**: Trading-focused color scheme with success/danger indicators
- **Typography**: Inter font for readability, JetBrains Mono for numerical data
- **Responsive Design**: Mobile-first approach with breakpoint-based layouts
- **Data Visualization**: Optimized tables and cards for financial data display

### Security & Performance
- **Type Safety**: End-to-end TypeScript implementation
- **Input Validation**: Zod schemas for runtime validation
- **Error Handling**: Comprehensive error boundaries and API error handling
- **Performance**: Virtualized tables, memoized components, and optimized re-renders

## External Dependencies

### Core Dependencies
- **@radix-ui/react-\***: Comprehensive set of accessible UI primitives for consistent component behavior
- **@tanstack/react-query**: Server state management with caching, background updates, and error handling
- **drizzle-orm**: Type-safe database ORM with PostgreSQL support
- **@neondatabase/serverless**: Serverless PostgreSQL database client with connection pooling

### Development Tools
- **Vite**: Fast build tool with HMR and optimized bundling
- **TypeScript**: Static type checking across the entire application
- **Tailwind CSS**: Utility-first CSS framework with custom design tokens
- **ESBuild**: Fast JavaScript bundler for production builds

### UI & Styling
- **class-variance-authority**: Component variant management for consistent styling
- **clsx & tailwind-merge**: Conditional class name utilities
- **Lucide React**: Modern icon library with consistent design
- **date-fns**: Date manipulation and formatting utilities

### Font Integration
- **Google Fonts**: Inter for UI text and JetBrains Mono for monospace data display
- **Self-hosted**: Fonts loaded via Google Fonts CDN for performance

### Deployment & Hosting
- **Replit Integration**: Configured for Replit hosting with development tooling
- **Environment Variables**: Database connection and configuration via environment variables
- **Production Build**: Optimized builds with asset bundling and code splitting