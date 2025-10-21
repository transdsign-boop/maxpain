# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MPI™ Liquidation Hunter Bot - A sophisticated algorithmic trading system for cryptocurrency futures markets on Aster DEX. The bot detects and counter-trades liquidation events using advanced DCA (Dollar Cost Averaging), cascade risk analysis, and institutional-grade risk management.

**Tech Stack:**
- **Frontend**: React 18 + TypeScript + Vite, Radix UI + shadcn/ui + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: Neon PostgreSQL (serverless) with Drizzle ORM
- **Real-time**: WebSocket (ws library) for live liquidation streams and user data
- **Build**: Vite (client), esbuild (server)

## Development Commands

### Essential Commands

```bash
# Development (runs both client and server with hot reload)
npm run dev

# Type checking (validate TypeScript without building)
npm run check

# Production build (builds both client and server)
npm run build

# Production start (runs built application)
npm start

# Database schema push (DO NOT USE - see Database section)
npm run db:push
```

### Running Single Tests

This project does not have a test suite configured. All testing is done manually via the UI and live trading validation.

## Critical Database Configuration

**🚨 CRITICAL: This project uses Neon PostgreSQL exclusively**

- **NEVER use `execute_sql_tool`** - it connects to a worthless development database
- **NEVER use `npm run db:push`** - DATABASE_URL ≠ NEON_DATABASE_URL
- **ALWAYS use manual SQL scripts** executed directly in Neon SQL Editor for schema changes
- **ALWAYS use application API endpoints** to check database state (e.g., `/api/strategies`, `/api/positions`)

**Schema Change Process:**
1. Update `shared/schema.ts` with new schema definition
2. Write manual SQL migration script in `migrations/`
3. Execute script directly in Neon SQL Editor (never via Drizzle)
4. Verify changes via application API endpoints

**Connection Configuration:**
- Production: `NEON_DATABASE_URL` environment variable (with `?sslmode=require`)
- Local dev: Same Neon database (no local database)
- Database client: `@neondatabase/serverless`

## Architecture Overview

### High-Level Structure

```
/
├── client/              # React frontend application
│   └── src/
│       ├── components/  # Reusable UI components (shadcn/ui + custom)
│       ├── hooks/       # Custom React hooks
│       ├── lib/         # Utilities (queryClient, utils)
│       └── pages/       # Route pages (Dashboard, Documentation)
├── server/              # Node.js backend services
│   ├── exchanges/       # Exchange adapters (aster-stream.ts, registry.ts)
│   ├── scripts/         # Maintenance/analysis scripts
│   ├── routes.ts        # API endpoint definitions
│   ├── strategy-engine.ts        # Core trading logic coordinator
│   ├── dca-calculator.ts         # DCA mathematical computations
│   ├── cascade-detector-service.ts # Liquidation cascade analysis
│   ├── order-protection-service.ts # TP/SL order management
│   ├── live-data-orchestrator.ts   # WebSocket stream manager
│   ├── user-data-stream.ts         # User account/order updates
│   ├── exchange-sync.ts            # Trade history synchronization
│   ├── storage.ts                  # Database access layer
│   ├── exchange-utils.ts           # Aster DEX API utilities
│   ├── telegram-service.ts         # Trade notifications
│   └── index.ts                    # Express server entry point
├── shared/              # Shared TypeScript definitions
│   └── schema.ts        # Drizzle ORM schema + Zod validators
└── migrations/          # Manual SQL migration scripts
```

### Core Trading System Components

**Strategy Engine** (`strategy-engine.ts`):
- Entry point for all trading decisions
- Processes liquidation signals from WebSocket
- Coordinates DCA layer execution
- Manages position lifecycle (entry → layers → exit)
- Enforces portfolio risk limits and blocking logic
- **Duplicate prevention**: Global cooldown + liquidation ID tracking ensures 1 liquidation = 1 order max
- **Adaptive stop loss**: Uses ATR-based SL when enabled instead of fixed fallback
- **Filled risk blocking**: Blocks trades when actual current exposure exceeds max portfolio risk

**DCA Calculator** (`dca-calculator.ts`):
- Mathematical framework for volatility-scaled DCA levels
- ATR-based spacing: `ck = Δ1 × k^p × max(1, ATR/Vref)`
- Exponential size growth: `wk = g^(k-1)`
- Layer 1 uses Start Step %; subsequent layers use convex spacing
- Risk calculations use adaptive SL (ATR × multiplier, clamped to min/max)

**Cascade Detector Service** (`cascade-detector-service.ts`):
- Real-time liquidation quality analysis (LQ/RET/OI scores)
- Reversal quality classification (Poor/OK/Good/Excellent)
- Auto-block trigger logic (prevents trading during extreme cascades)
- 1-second update frequency via WebSocket

**Order Protection Service** (`order-protection-service.ts`):
- Simplified position-level TP/SL management
- Place-then-cancel atomic pattern
- Scheduled reconciliation (every 2 minutes)
- Automatic retry and orphaned order cleanup

**Live Data Orchestrator** (`live-data-orchestrator.ts`):
- Manages WebSocket connections to Aster DEX
- Coordinates liquidation stream and user data stream
- Broadcasts events to strategy engine
- Handles reconnection logic

**Exchange Sync** (`exchange-sync.ts`):
- Synchronizes trade history from exchange API
- Pagination handling (7-day chunks for large date ranges)
- Fetches realized P&L from `/fapi/v1/userTrades`
- Reconciles positions with exchange state

### Data Flow

1. **Liquidation Detection**: WebSocket → Cascade Detector → Strategy Engine
2. **Trade Decision**: Strategy Engine evaluates filters → DCA Calculator computes sizing → Order placed
3. **Position Management**: Exchange fill → User Data Stream → Strategy Engine → Database update
4. **TP/SL Protection**: Order Protection Service → Atomic place-then-cancel → Scheduled reconciliation
5. **Performance Tracking**: Exchange Sync fetches P&L → Storage layer persists → Frontend displays

### Key Design Patterns

**Race Condition Prevention**:
- **Async mutex serialization**: `fillLocks` Map serializes concurrent fills per session-symbol-side
- **Global cooldown**: 60-second minimum between orders for same symbol+side
- **Liquidation ID tracking**: Each liquidation processed maximum once
- **Cooldown timestamp**: Set atomically within mutex-protected code during fill

**Data Preservation**:
- **ALL trading data preserved forever** (positions, fills, sessions, P&L)
- **"Start Fresh" = Archive current session** (mark inactive) + create new session
- **Liquidations auto-deleted after 30 days** (not trading data)
- **Realized P&L stored in DB** when positions close (from exchange API)

**Risk Management Hierarchy**:
1. **Filled Risk** (actual current exposure): Blocks new positions + DCA layers when > max portfolio risk
2. **Reserved Risk** (theoretical maximum if all DCA layers fill): Calculated and displayed but does NOT block trades
3. **Margin Usage** (capital allocated): Separate from risk (3% margin might only have 0.8% risk with tight SL)

**Session Architecture**:
- **One active session per strategy** (live or paper mode)
- **Sessions never deleted** (archived when "Start Fresh" or mode change)
- **Position reconciliation** on session start (syncs with exchange)

## Common Development Patterns

### Adding a New API Endpoint

1. Define route in `server/routes.ts`:
```typescript
app.get("/api/your-endpoint", async (req, res) => {
  const data = await storage.yourMethod();
  res.json(data);
});
```

2. Add storage method in `server/storage.ts` if needed:
```typescript
async yourMethod() {
  return await db.select().from(yourTable);
}
```

3. Create frontend query in component:
```typescript
const { data } = useQuery({
  queryKey: ["your-endpoint"],
  queryFn: async () => {
    const res = await fetch("/api/your-endpoint");
    return res.json();
  }
});
```

### Adding a New Database Column

1. Update `shared/schema.ts`:
```typescript
export const positions = pgTable("positions", {
  // ... existing columns
  newColumn: text("new_column").notNull().default("value"),
});
```

2. Create manual SQL migration in `migrations/`:
```sql
-- migrations/add_new_column.sql
ALTER TABLE positions ADD COLUMN new_column TEXT NOT NULL DEFAULT 'value';
```

3. Execute in Neon SQL Editor (NOT via npm run db:push)

4. Verify via API endpoint: `GET /api/positions/:sessionId`

### Working with Trading Logic

**Entry Point**: `strategy-engine.ts` → `handleLiquidation()`
- Checks global cooldown + liquidation ID (duplicate prevention)
- Evaluates cascade risk, percentile threshold, portfolio limits
- Sets reservation (cooldown + marks liquidation ID) immediately before order
- Places order via `enterPosition()` or `addDCALayer()`

**DCA Layer Execution**: `strategy-engine.ts` → `addDCALayer()`
- Only triggers on liquidations ≥60th percentile
- Enforces 2-minute cooldown between fills (not placements)
- Uses adaptive SL for risk calculations
- Updates avgEntryPrice with actual fill prices

**Fill Processing**: `strategy-engine.ts` → `fillLiveOrder()` or `fillPaperOrder()`
- Async mutex serialization prevents race conditions
- Sets cooldown timestamp atomically within mutex
- Fetches actual P&L from exchange API
- Updates position in database

**Risk Blocking**: Evaluated before EVERY new position or DCA layer
- **Filled risk** = sum of (position size × (current price - stop loss price)) across all open positions
- If filled risk > max portfolio risk → block trade
- Reserved risk displayed but doesn't block (theoretical maximum if all layers fill)

## Important Constraints

### Strategy Creation Policy

**🚨 NEVER AUTO-CREATE STRATEGIES**
- Strategies are created manually via UI only (future feature)
- If operation expects strategy but none exists → return error gracefully
- Default strategy may exist but NEVER create new ones automatically

### Data Preservation Policy

**PERMANENT PRESERVATION REQUIRED**
- ALL positions, fills, trade sessions preserved forever
- User must be able to recall historical trading data at any time
- "Start Fresh" = archive session (mark inactive) + create new session
- NEVER DELETE trading data under any circumstances

### DCA Layer Timing

**Cooldown Enforcement**:
- 2-minute minimum between consecutive FILLS (not placements) for same symbol+side
- Liquidations below 60th percentile rejected WITHOUT setting cooldown
- Timestamp set when order actually fills on exchange
- Prevents rapid-fire DCA layers even if orders placed quickly

### Position Architecture

**Single Source of Truth**:
- Database `positions` table is authoritative
- Each realized P&L event = one position with real exchange fills
- `realizedPnl` field populated when position closes (from exchange API)
- Nullable `realizedPnl` distinguishes "never stored" vs "stored as zero"

## Environment Variables

Required in `.env` (see `.env.example`):
- `NEON_DATABASE_URL`: PostgreSQL connection string (must include `?sslmode=require`)
- `ASTER_API_KEY`: Aster DEX API key
- `ASTER_SECRET_KEY`: Aster DEX secret key
- `SESSION_SECRET`: Random string for session encryption
- `NODE_ENV`: `development` or `production`

Optional:
- `PORT`: Server port (default: 5000)
- `TELEGRAM_BOT_TOKEN`: For trade notifications
- `TELEGRAM_CHAT_ID`: Telegram chat ID for notifications

## Exchange Integration

**Aster DEX API**:
- Base URL: `https://api.aster.exchange`
- Authentication: HMAC-SHA256 signature
- Rate limiting: Handled via queue-based system in `exchange-utils.ts`

**WebSocket Streams**:
- Liquidation feed: `wss://stream.aster.exchange/liquidations`
- User data stream: `wss://stream.aster.exchange/userDataStream`
- Managed by `live-data-orchestrator.ts`

**Key Endpoints Used**:
- `/fapi/v3/exchangeInfo`: Symbol precision, min notional, filters
- `/fapi/v3/account`: Account balance, positions
- `/fapi/v1/order`: Place/cancel orders
- `/fapi/v1/userTrades`: Trade history with P&L
- `/fapi/v1/income`: Commissions, funding fees

## UI/UX Guidelines

**Color Scheme** (Financial Trading Focus):
- Lime green: Profit, margin usage (inner ring)
- Orange: Loss, warnings, risk threshold (80%+)
- Red: Critical risk (exceeds limit)
- Blue: Normal risk level

**Risk Visualization**:
- Dual-ring meter: Inner (margin usage, fixed lime), Outer (filled risk, dynamic colors)
- Color computation uses server-backed `maxPortfolioRiskPercent` (memoized helpers prevent desync)

**Performance Optimization**:
- `React.memo` on key components
- Memoized metric subcomponents prevent unnecessary re-renders
- CSS keyframe animations (no JS animations)

**Financial Data Display**:
- Numerical data: JetBrains Mono (monospace)
- Text: Inter font
- Precision: 2 decimals for USD, 4-8 for crypto (symbol-specific)

## Debugging Tips

**Check Strategy State**:
```bash
curl http://localhost:5000/api/strategies
```

**Check Active Positions**:
```bash
curl http://localhost:5000/api/positions/SESSION_ID
```

**Check Liquidation Stream**:
- Open browser DevTools → Network → WS tab
- Look for `wss://stream.aster.exchange/liquidations` connection
- Verify liquidation events arriving

**Check Trade Blocking**:
- WebSocket event `trade_block` broadcasts system-wide blocking info
- Check browser console for block reasons
- Cascade risk indicator shows current state (green/yellow/orange/red)

**Common Issues**:
1. **No trades executing**: Check cascade risk (may be auto-blocked), percentile threshold too high, or portfolio limits reached
2. **DCA layers not filling**: Verify 2-minute cooldown elapsed, liquidation ≥60th percentile, filled risk not exceeded
3. **TP/SL orders missing**: Check protective order reconciliation logs (runs every 2 minutes), verify exchange allows reduce-only orders
4. **Database sync errors**: Verify NEON_DATABASE_URL includes `?sslmode=require`, check Neon dashboard for connection issues

## Deployment

**Docker**:
- See `README-DOCKER.md` for detailed Docker deployment guide
- Supports DigitalOcean, AWS ECS, Google Cloud Run, Fly.io, VPS

**Replit** (Current Deployment):
- Uses `.replit` configuration
- Auto-detects port from environment (`PORT=5000`)
- Database: Neon PostgreSQL (serverless)

**Production Checklist**:
- Set `NODE_ENV=production`
- Configure strong `SESSION_SECRET`
- Verify `NEON_DATABASE_URL` has `?sslmode=require`
- Test API credentials with `/api/live/account`
- Enable HTTPS (required for WebSocket security)

## Additional Documentation

- **Full Trading Documentation**: `MPI_LIQUIDATION_HUNTER_DOCUMENTATION.md` (comprehensive strategy guide, risk management, performance tracking)
- **Docker Deployment**: `README-DOCKER.md` (cloud provider setup, VPS configuration, security checklist)
- **Replit Notes**: `replit.md` (system architecture, transfer exclusion, database warnings)
- **Design Guidelines**: `design_guidelines.md` (UI/UX specifications)
