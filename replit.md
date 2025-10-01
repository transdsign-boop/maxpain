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
- **UI/UX Design**: Dark/light mode, professional trading aesthetic (green for long, red for short), Inter font for text, JetBrains Mono for numerical data, responsive design, optimized tables and cards for financial data.
- **Key Features**: Collapsible trade details showing layer-by-layer entry/exit information and fees; live strategy editing with tracked changes and performance chart visualization; interactive performance chart with individual trade P&L bars and cumulative P&L line graph.

### Backend Architecture
- **Runtime**: Node.js with Express.js.
- **Language**: TypeScript.
- **Database ORM**: Drizzle ORM.
- **API Design**: RESTful endpoints with `/api` prefix.

### Data Storage
- **Database**: PostgreSQL with Neon serverless hosting.
- **Schema**: Dedicated tables for liquidations and users with indexing.
- **Connection**: Connection pooling with `@neondatabase/serverless`.
- **Migrations**: Drizzle Kit.

### Real-time Data Features
- Architecture prepared for real-time WebSocket integration.
- Connection monitoring and status display.
- Configurable refresh intervals for data updates.
- Dominant direction analysis using order book and funding rate data.

### Security & Performance
- End-to-end TypeScript for type safety.
- Zod schemas for runtime input validation.
- Comprehensive error handling.
- Optimized performance with virtualized tables, memoized components, and efficient re-renders.
- Robust handling of duplicate liquidations and race conditions through atomic locking and queue-based processing.

### Trading System
- **Live Trading**: Implemented HMAC-SHA256 signature authentication for Aster DEX with comprehensive safety checks, including API credential validation, order parameter checks, receive window for clock sync, and "REAL MONEY" warnings. Exit orders automatically placed on Aster DEX using correct order types (limit for TP, stop market for SL).
- **Paper Trading**: Realistic simulation of limit order behavior, including dynamic price chasing and automatic cancellation. Uses correct Aster DEX fee schedule: 0.01% maker fee for limit orders (take profit exits), 0.035% taker fee for market orders (stop loss exits). Entry orders use 0.035% taker fee.
- **Strategy Management**: Singleton session model with one continuous trading session per user; strategy parameters are adjustable settings. Configurable liquidation lookback window for percentile-based trade signals.
- **Exit Order Types**: Take profit exits use LIMIT orders (0.01% maker fee), stop loss exits use STOP_MARKET orders (0.035% taker fee), manual closes use LIMIT orders (0.01% maker fee). All fees correctly applied in both paper and live modes.
- **Data Integrity**: Comprehensive data validation and integrity fixes, including removal of duplicate liquidations and fills, correct session update logic, and recalculated session statistics.
- **Features**: Live/Paper Trading Toggle; real-time price data directly from Aster DEX API for all calculations; cross-browser settings persistence to database.

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