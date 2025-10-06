import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";
import { Link } from "wouter";

export default function Documentation() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-md">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              <h1 className="text-lg font-bold">Professional Documentation</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        <article className="prose prose-slate dark:prose-invert max-w-none">
          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-2">MPI™ Liquidation Hunter Bot</h1>
            <p className="text-xl text-muted-foreground">Professional Trading Documentation</p>
            <p className="text-sm text-muted-foreground">Version 2.0 | Max Pain Industry™</p>
          </div>

          <hr className="my-8" />

          <section className="mb-8">
            <h2 className="text-2xl font-bold mb-4">Executive Summary</h2>
            <p className="mb-4">
              The <strong>MPI™ Liquidation Hunter Bot</strong> is a sophisticated algorithmic trading system designed to capitalize on liquidation events in cryptocurrency futures markets. By detecting and counter-trading forced liquidations on the Aster DEX exchange, the bot exploits temporary price dislocations to generate consistent returns with advanced risk management.
            </p>
            <div className="bg-muted/50 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Key Highlights:</p>
              <ul className="space-y-1">
                <li>✅ <strong>Real-Time Liquidation Detection</strong> with cascade risk analysis</li>
                <li>✅ <strong>Advanced DCA System</strong> with volatility-based position sizing</li>
                <li>✅ <strong>Institutional-Grade Risk Management</strong> with multi-layer protection</li>
                <li>✅ <strong>Paper Trading Mode</strong> for risk-free strategy testing</li>
                <li>✅ <strong>Complete Performance Analytics</strong> with historical trade tracking</li>
                <li>✅ <strong>24/7 Automated Trading</strong> with live exchange integration</li>
              </ul>
            </div>
          </section>

          <hr className="my-8" />

          <section className="mb-8">
            <h2 className="text-2xl font-bold mb-4">Table of Contents</h2>
            <nav className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[
                { title: "What is Liquidation Hunting?", id: "liquidation-hunting" },
                { title: "Core Features", id: "core-features" },
                { title: "Trading Strategy", id: "trading-strategy" },
                { title: "Risk Management System", id: "risk-management" },
                { title: "Advanced Technology", id: "advanced-technology" },
                { title: "Performance Tracking", id: "performance-tracking" },
                { title: "Getting Started", id: "getting-started" },
                { title: "Technical Architecture", id: "technical-architecture" },
                { title: "Safety & Security", id: "safety-security" },
                { title: "Support", id: "support" },
              ].map((item, idx) => (
                <a 
                  key={idx}
                  href={`#${item.id}`}
                  className="text-primary hover:underline p-2 rounded-md hover:bg-muted/50"
                >
                  {idx + 1}. {item.title}
                </a>
              ))}
            </nav>
          </section>

          <hr className="my-8" />

          <section id="liquidation-hunting" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">What is Liquidation Hunting?</h2>
            
            <h3 className="text-xl font-semibold mb-3">The Opportunity</h3>
            <p className="mb-4">
              When leveraged traders get liquidated, their positions are forcefully closed at market price, creating temporary price dislocations. These events often cause:
            </p>
            <ul className="space-y-2 mb-4">
              <li><strong>Oversold/Overbought Conditions</strong>: Forced selling/buying creates price extremes</li>
              <li><strong>Liquidity Cascades</strong>: One liquidation can trigger others, amplifying moves</li>
              <li><strong>Mean Reversion Opportunities</strong>: Prices typically revert after liquidation pressure subsides</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3">Our Approach</h3>
            <p className="mb-3">The MPI™ Liquidation Hunter Bot:</p>
            <ol className="space-y-2 mb-4">
              <li><strong>Monitors</strong> real-time liquidation streams from Aster DEX</li>
              <li><strong>Analyzes</strong> cascade risk and market microstructure</li>
              <li><strong>Identifies</strong> high-quality reversal opportunities</li>
              <li><strong>Executes</strong> counter-trend positions with precision</li>
              <li><strong>Manages</strong> risk through dynamic DCA and protective stops</li>
            </ol>
            <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg">
              <p className="font-semibold">Strategy:</p>
              <p>When long positions get liquidated (selling pressure) → We go <span className="text-lime-500">LONG</span> (buy the dip).</p>
              <p>When short positions get liquidated (buying pressure) → We go <span className="text-orange-500">SHORT</span> (sell the rally).</p>
            </div>
          </section>

          <hr className="my-8" />

          <section id="core-features" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">Core Features</h2>

            <h3 className="text-xl font-semibold mb-3">1. Real-Time Liquidation Detection</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Intelligent Signal Processing:</p>
              <ul className="space-y-1">
                <li>• WebSocket connection to Aster DEX liquidation stream</li>
                <li>• Configurable percentile thresholds (1st-99th percentile)</li>
                <li>• Symbol-specific monitoring across 18+ crypto pairs</li>
                <li>• Lookback window analysis (1-24 hours)</li>
                <li>• Duplicate liquidation filtering</li>
              </ul>
            </div>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Cascade Risk Analysis:</p>
              <ul className="space-y-1">
                <li>• <strong>LQ Score</strong>: Liquidation quantity vs. median (scale: 0-∞)</li>
                <li>• <strong>RET Score</strong>: Realized volatility indicator (scale: 0-∞)</li>
                <li>• <strong>OI Delta</strong>: Open interest changes (1min & 3min windows)</li>
                <li>• <strong>Reversal Quality</strong>: 4-tier system (Poor → OK → Good → Excellent)</li>
                <li>• <strong>Auto-Block</strong>: Prevents trading during extreme cascade events</li>
              </ul>
            </div>

            <h3 className="text-xl font-semibold mb-3">2. Advanced DCA (Dollar Cost Averaging) System</h3>
            <p className="mb-3">The bot uses a sophisticated DCA system with:</p>
            <div className="space-y-3 mb-4">
              <div className="bg-muted/30 p-4 rounded-lg">
                <p className="font-semibold mb-2">Volatility Scaling:</p>
                <p className="font-mono text-sm mb-2">ck = Δ1 × k^p × max(1, ATR/Vref)</p>
                <ul className="text-sm space-y-1">
                  <li>• Δ1 = Starting step distance (e.g., 0.4%)</li>
                  <li>• p = Convexity factor (e.g., 1.2) for widening spacing</li>
                  <li>• Vref = Reference volatility baseline</li>
                </ul>
              </div>
              <div className="bg-muted/30 p-4 rounded-lg">
                <p className="font-semibold mb-2">Exponential Size Growth:</p>
                <p className="font-mono text-sm mb-2">wk = g^(k-1)</p>
                <p className="text-sm">Where g = growth ratio (e.g., 1.8x)</p>
              </div>
              <div className="bg-muted/30 p-4 rounded-lg">
                <p className="font-semibold mb-2">Dynamic Exit Pricing:</p>
                <ul className="text-sm space-y-1">
                  <li>• Take Profit: Volatility-adjusted distance with exit cushion</li>
                  <li>• Stop Loss: Calculated from weighted average entry price</li>
                  <li>• Auto-updates after each layer fill</li>
                </ul>
              </div>
              <div className="bg-muted/30 p-4 rounded-lg">
                <p className="font-semibold mb-2">Risk-Aware Sizing:</p>
                <p className="text-sm">Total position risk capped at configurable % of account</p>
              </div>
            </div>

            <h3 className="text-xl font-semibold mb-3">3. Portfolio Risk Management</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Multi-Layer Protection:</p>
              <ul className="space-y-1">
                <li>• Max open positions (0-20, 0 = unlimited)</li>
                <li>• Max portfolio risk percentage (1-100%)</li>
                <li>• Configurable margin allocation (1-100% of account)</li>
                <li>• Per-trade leverage control (1-125x)</li>
                <li>• Real-time exposure monitoring</li>
                <li>• Emergency "Close All Positions" button</li>
              </ul>
            </div>

            <h3 className="text-xl font-semibold mb-3">4. Intelligent Order Execution</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Smart Order Placement:</p>
              <ul className="space-y-1">
                <li>• <strong>Price Chase Mode</strong>: Auto-adjusts limit prices during rapid moves</li>
                <li>• <strong>Order Delay</strong>: Configurable wait time (100ms-30s)</li>
                <li>• <strong>Slippage Tolerance</strong>: Max acceptable price deviation (0.1-5%)</li>
                <li>• <strong>Retry Duration</strong>: Max time to chase price (5s-5min)</li>
                <li>• Batch order execution for efficiency</li>
                <li>• Atomic cancel-and-replace for TP/SL updates</li>
              </ul>
            </div>

            <h3 className="text-xl font-semibold mb-3">5. Dominant Direction Analysis</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Multi-Factor Market Sentiment:</p>
              <ul className="space-y-1">
                <li>• <strong>Order Book Pressure</strong> (60% weight): Bid/Ask depth analysis</li>
                <li>• <strong>Funding Rates</strong> (40% weight): Current funding rate sentiment</li>
                <li>• Output: Directional bias with confidence score (0-100%)</li>
              </ul>
            </div>

            <h3 className="text-xl font-semibold mb-3">6. Liquidity & Asset Ranking</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Real-Time Liquidity Metrics:</p>
              <ul className="space-y-1">
                <li>• Bid/Ask depth at best prices</li>
                <li>• Trade size capacity analysis</li>
                <li>• Slippage estimation for position sizes</li>
              </ul>
              <p className="font-semibold mt-3 mb-2">Asset Ranking Modes:</p>
              <ul className="space-y-1">
                <li>1. <strong>By Liquidation Activity</strong> (default)</li>
                <li>2. <strong>By Best Liquidity</strong></li>
                <li>3. <strong>Alphabetical</strong></li>
              </ul>
            </div>
          </section>

          <hr className="my-8" />

          <section id="trading-strategy" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">Trading Strategy</h2>

            <h3 className="text-xl font-semibold mb-3">Entry Logic</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Signal Requirements (ALL must be met):</p>
              <ol className="space-y-2">
                <li>✅ <strong>Asset Filter</strong>: Symbol must be in selected assets list</li>
                <li>✅ <strong>Percentile Threshold</strong>: Liquidation size ≥ configured percentile</li>
                <li>✅ <strong>Cascade Risk</strong>: Reversal quality meets minimum threshold</li>
                <li>✅ <strong>Portfolio Limits</strong>: Not at max position count or risk limit</li>
                <li>✅ <strong>Cooldown Cleared</strong>: No recent entry for same symbol</li>
              </ol>
            </div>

            <h3 className="text-xl font-semibold mb-3">Layer Addition Logic</h3>
            <p className="mb-3">When to Add Layers:</p>
            <ul className="space-y-1 mb-4">
              <li>• New liquidation detected for same symbol</li>
              <li>• Price has moved against position (DCA trigger)</li>
              <li>• Current layer count &lt; max layers</li>
              <li>• Additional risk &lt; portfolio risk limit</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3">Exit Logic</h3>
            <div className="space-y-3">
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Take Profit:</p>
                <p className="text-sm">Calculated using volatility-adjusted distance with exit cushion multiplier</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Stop Loss:</p>
                <p className="text-sm">Fixed percentage from weighted average entry (typical: 2-5%)</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Manual Exit:</p>
                <p className="text-sm">Close individual positions or all positions via emergency stop</p>
              </div>
            </div>
          </section>

          <hr className="my-8" />

          <section id="risk-management" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">Risk Management System</h2>

            <h3 className="text-xl font-semibold mb-3">1. Position-Level Controls</h3>
            <ul className="space-y-2 mb-4">
              <li>• Maximum risk per trade (% of account)</li>
              <li>• Position size limits (notional value)</li>
              <li>• Minimum position size enforcement</li>
              <li>• Leverage limits (1-125x with warnings)</li>
              <li>• Dynamic stop loss protection</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3">2. Portfolio-Level Controls</h3>
            <ul className="space-y-2 mb-4">
              <li>• Max total exposure (% of account)</li>
              <li>• Max positions per symbol</li>
              <li>• Max open positions across all symbols</li>
              <li>• Symbol concentration limits</li>
              <li>• Real-time P&L monitoring</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3">3. Market Condition Filters</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Cascade Detection Auto-Block:</p>
              <ul className="space-y-1">
                <li>• <span className="text-red-500">Red Light</span> (Score ≥6): All entries blocked</li>
                <li>• <span className="text-orange-500">Orange Light</span> (Score ≥4): High-risk warning</li>
                <li>• <span className="text-yellow-500">Yellow Light</span> (Score ≥2): Moderate caution</li>
                <li>• <span className="text-green-500">Green Light</span> (Score &lt;2): Normal operation</li>
              </ul>
            </div>

            <h3 className="text-xl font-semibold mb-3">4. Order Execution Safety</h3>
            <ul className="space-y-2 mb-4">
              <li>• Idempotency protection (prevents duplicate orders)</li>
              <li>• Atomic cancel-then-place for TP/SL updates</li>
              <li>• Live order verification and correction</li>
              <li>• Orphaned order cleanup</li>
              <li>• Price chase safety limits</li>
            </ul>
          </section>

          <hr className="my-8" />

          <section id="advanced-technology" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">Advanced Technology</h2>

            <h3 className="text-xl font-semibold mb-3">Real-Time Data Infrastructure</h3>
            <ul className="space-y-2 mb-4">
              <li>• WebSocket streams with sub-second latency</li>
              <li>• REST API integration with HMAC-SHA256 authentication</li>
              <li>• Rate limiting and request queuing</li>
              <li>• Connection pooling for efficiency</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3">Database Architecture</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Neon PostgreSQL (Serverless):</p>
              <ul className="space-y-1">
                <li>• Permanent data retention (ALL trades preserved forever)</li>
                <li>• Session-based organization</li>
                <li>• Automatic archiving (liquidations 30-day retention)</li>
                <li>• Connection pooling for high performance</li>
              </ul>
            </div>

            <h3 className="text-xl font-semibold mb-3">Tech Stack</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Frontend:</p>
                <p className="text-sm">React 18 + TypeScript + Vite</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Backend:</p>
                <p className="text-sm">Node.js + Express + TypeScript</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Database:</p>
                <p className="text-sm">PostgreSQL (Neon Serverless)</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">UI Framework:</p>
                <p className="text-sm">Radix UI + shadcn/ui + Tailwind</p>
              </div>
            </div>
          </section>

          <hr className="my-8" />

          <section id="performance-tracking" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">Performance Tracking</h2>

            <h3 className="text-xl font-semibold mb-3">Key Metrics</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">Total Trades</p>
                <p className="font-semibold">Open + Closed</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">Win Rate</p>
                <p className="font-semibold">% Profitable</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">Total P&L</p>
                <p className="font-semibold">Realized + Unrealized</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">Profit Factor</p>
                <p className="font-semibold">Gross Profit / Loss</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">Max Drawdown</p>
                <p className="font-semibold">Peak to Trough</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">Avg Win/Loss</p>
                <p className="font-semibold">Per Trade</p>
              </div>
            </div>

            <h3 className="text-xl font-semibold mb-3">Interactive Performance Chart</h3>
            <ul className="space-y-2 mb-4">
              <li>• Per-trade P&L bars (lime = profit, orange = loss)</li>
              <li>• Cumulative P&L line graph</li>
              <li>• Day grouping with trade counts</li>
              <li>• Strategy change markers</li>
              <li>• Pagination for large datasets</li>
              <li>• Auto-scaling with zero reference line</li>
            </ul>
          </section>

          <hr className="my-8" />

          <section id="getting-started" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">Getting Started</h2>

            <h3 className="text-xl font-semibold mb-3">1. Initial Setup</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Prerequisites:</p>
              <ul className="space-y-1">
                <li>• Aster DEX account with API access</li>
                <li>• API Key and Secret Key</li>
                <li>• Funded account (minimum: $100 recommended)</li>
              </ul>
              <p className="font-semibold mt-3 mb-2">Configuration:</p>
              <ol className="space-y-1">
                <li>1. Access Settings via header Settings button</li>
                <li>2. Navigate to "API Connection" tab</li>
                <li>3. Enter Aster DEX API credentials</li>
                <li>4. Test connection (displays account balance)</li>
              </ol>
            </div>

            <h3 className="text-xl font-semibold mb-3">2. Paper Trading (Recommended First)</h3>
            <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Purpose: Test strategies risk-free with simulated funds</p>
              <ol className="space-y-1">
                <li>1. Create new strategy or use default</li>
                <li>2. Ensure "Trading Mode" = Paper</li>
                <li>3. Configure desired parameters</li>
                <li>4. Click "Activate Strategy"</li>
                <li>5. Monitor performance without real capital at risk</li>
              </ol>
            </div>

            <h3 className="text-xl font-semibold mb-3">3. Live Trading</h3>
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">⚠️ Transition Checklist:</p>
              <ul className="space-y-1">
                <li>✅ Tested strategy in paper mode</li>
                <li>✅ Reviewed and understood all risk parameters</li>
                <li>✅ Set appropriate position limits</li>
                <li>✅ Configured portfolio risk caps</li>
                <li>✅ Verified API credentials are correct</li>
                <li>✅ Ensured sufficient account balance</li>
              </ul>
            </div>

            <h3 className="text-xl font-semibold mb-3">4. Best Practices</h3>
            <div className="space-y-2">
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Risk Management:</p>
                <p className="text-sm">Start with paper trading • Use conservative leverage (5-10x) • Set stop losses • Never risk more than 2-5% per trade</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Strategy Optimization:</p>
                <p className="text-sm">Review performance after 20-50 trades • Adjust percentile based on win rate • Fine-tune DCA parameters</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Operational:</p>
                <p className="text-sm">Check bot status daily • Monitor cascade risk • Keep sufficient balance • Export settings monthly</p>
              </div>
            </div>
          </section>

          <hr className="my-8" />

          <section id="technical-architecture" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">Technical Architecture</h2>

            <h3 className="text-xl font-semibold mb-3">Backend Services</h3>
            <div className="space-y-3 mb-4">
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Strategy Engine</p>
                <p className="text-sm">Core trading logic, signal processing, position management</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Cascade Detector</p>
                <p className="text-sm">Real-time liquidation analysis, reversal quality scoring</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">DCA Calculator</p>
                <p className="text-sm">Mathematical DCA computation, volatility scaling, dynamic exits</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Order Protection Service</p>
                <p className="text-sm">TP/SL management, idempotency, orphaned order cleanup</p>
              </div>
            </div>

            <h3 className="text-xl font-semibold mb-3">Database Schema</h3>
            <div className="bg-muted/30 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Core Tables:</p>
              <ul className="space-y-1 text-sm">
                <li>• <code>strategies</code>: Trading strategy configurations</li>
                <li>• <code>trade_sessions</code>: Session boundaries (live/paper)</li>
                <li>• <code>positions</code>: Open and closed positions</li>
                <li>• <code>fills</code>: Individual order fills</li>
                <li>• <code>liquidations</code>: Real-time events (30-day retention)</li>
                <li>• <code>pnl_snapshots</code>: Performance snapshots</li>
              </ul>
            </div>
          </section>

          <hr className="my-8" />

          <section id="safety-security" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">Safety & Security</h2>

            <h3 className="text-xl font-semibold mb-3">API Security</h3>
            <ul className="space-y-2 mb-4">
              <li>• HMAC-SHA256 signature authentication</li>
              <li>• API keys stored as environment variables</li>
              <li>• Rate limiting to prevent API abuse</li>
              <li>• Request queuing for order management</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3">Trading Safety</h3>
            <div className="space-y-3 mb-4">
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Pre-Trade Validations</p>
                <p className="text-sm">Balance check • Position size limits • Portfolio risk calculations • Exchange requirements</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">In-Trade Protection</p>
                <p className="text-sm">Immediate TP/SL placement • Order verification • Orphaned order cleanup • 5-second monitoring</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold">Post-Trade Safeguards</p>
                <p className="text-sm">Fill confirmation • P&L reconciliation • Position synchronization • Funding tracking</p>
              </div>
            </div>

            <h3 className="text-xl font-semibold mb-3">Emergency Controls</h3>
            <ul className="space-y-2">
              <li>• One-click close all positions</li>
              <li>• Strategy pause/resume</li>
              <li>• Live session termination</li>
              <li>• Manual position override</li>
            </ul>
          </section>

          <hr className="my-8" />

          <section id="support" className="mb-8 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-4">Support</h2>

            <h3 className="text-xl font-semibold mb-3">Common Issues</h3>
            <div className="space-y-4">
              <div className="bg-muted/30 p-4 rounded-lg">
                <p className="font-semibold mb-2">Issue: Bot not entering trades</p>
                <ul className="text-sm space-y-1">
                  <li>• Check cascade risk indicator (may be on red/auto-block)</li>
                  <li>• Verify percentile threshold not too high</li>
                  <li>• Ensure selected assets have active liquidations</li>
                  <li>• Confirm strategy is activated</li>
                </ul>
              </div>
              <div className="bg-muted/30 p-4 rounded-lg">
                <p className="font-semibold mb-2">Issue: API connection errors</p>
                <ul className="text-sm space-y-1">
                  <li>• Verify API key/secret are correct</li>
                  <li>• Check Aster DEX API status</li>
                  <li>• Ensure IP not rate-limited</li>
                  <li>• Test connection in Settings</li>
                </ul>
              </div>
            </div>

            <h3 className="text-xl font-semibold mt-6 mb-3">Performance Optimization</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold text-sm mb-2">Improving Win Rate:</p>
                <ul className="text-xs space-y-1">
                  <li>• Increase percentile threshold</li>
                  <li>• Require higher reversal quality</li>
                  <li>• Enable cascade auto-block</li>
                  <li>• Trade high-liquidity symbols</li>
                </ul>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="font-semibold text-sm mb-2">Reducing Drawdown:</p>
                <ul className="text-xs space-y-1">
                  <li>• Lower leverage</li>
                  <li>• Tighten stop losses</li>
                  <li>• Reduce max layers</li>
                  <li>• Set stricter portfolio limits</li>
                </ul>
              </div>
            </div>
          </section>

          <hr className="my-8" />

          <section className="mb-8">
            <h2 className="text-2xl font-bold mb-4">Disclaimer</h2>
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg">
              <p className="font-semibold mb-2">⚠️ Risk Warning</p>
              <p className="text-sm mb-3">
                Trading cryptocurrency derivatives involves substantial risk of loss and is not suitable for all investors. Past performance is not indicative of future results. The MPI™ Liquidation Hunter Bot is an algorithmic trading tool and does not guarantee profits.
              </p>
              <p className="font-semibold mb-2">Key Risks:</p>
              <ul className="text-sm space-y-1 mb-3">
                <li>• Market volatility can cause rapid losses</li>
                <li>• Leverage amplifies both gains and losses</li>
                <li>• Liquidation cascades can be unpredictable</li>
                <li>• Exchange downtime may prevent order management</li>
                <li>• Software bugs or errors may occur</li>
              </ul>
              <p className="font-semibold mb-2">User Responsibility:</p>
              <p className="text-sm">
                You are solely responsible for your trading decisions. Always use paper trading first. Never trade with money you cannot afford to lose. Set appropriate risk limits and monitor positions regularly.
              </p>
            </div>
          </section>

          <hr className="my-8" />

          <section className="mb-8">
            <h2 className="text-2xl font-bold mb-4">Conclusion</h2>
            <p className="mb-4">
              The <strong>MPI™ Liquidation Hunter Bot</strong> represents a sophisticated approach to algorithmic trading, combining real-time market microstructure analysis with advanced risk management to capitalize on liquidation-driven price inefficiencies.
            </p>
            <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg mb-4">
              <p className="font-semibold mb-2">Key Strengths:</p>
              <ul className="space-y-1">
                <li>✅ Institutional-grade DCA system with mathematical precision</li>
                <li>✅ Multi-layer risk management protecting capital</li>
                <li>✅ Real-time cascade detection preventing dangerous trades</li>
                <li>✅ Complete performance transparency with permanent data retention</li>
                <li>✅ Paper trading mode for risk-free strategy development</li>
                <li>✅ Flexible configuration for all risk tolerances</li>
              </ul>
            </div>
            <p className="text-center text-lg font-semibold mt-6">
              MPI™ - Max Pain Industry<br />
              <span className="text-muted-foreground">"Hunt the Hunters"</span>
            </p>
          </section>

          <div className="text-center text-sm text-muted-foreground mt-8 pb-8">
            Document Version 2.0 | Last Updated: October 2025
          </div>
        </article>
      </main>
    </div>
  );
}
