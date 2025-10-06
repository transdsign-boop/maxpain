import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import { Link } from "wouter";

export default function Documentation() {
  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header - No Print */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 print:hidden">
        <div className="flex items-center justify-between px-6 py-3">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleExportPDF}
            data-testid="button-export-pdf"
          >
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <article className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-semibold prose-h1:text-4xl prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3">
          
          {/* Title */}
          <div className="text-center mb-16 print:mb-12">
            <h1 className="mb-3">MPI™ Liquidation Hunter Bot</h1>
            <p className="text-xl text-muted-foreground mb-2">Professional Trading Documentation</p>
            <p className="text-sm text-muted-foreground">Version 2.0 | Max Pain Industry™ | October 2025</p>
          </div>

          {/* Executive Summary */}
          <section>
            <h2>Executive Summary</h2>
            <p className="lead">
              The MPI™ Liquidation Hunter Bot is a sophisticated algorithmic trading system designed to capitalize on liquidation events in cryptocurrency futures markets. By detecting and counter-trading forced liquidations on the Aster DEX exchange, the bot exploits temporary price dislocations to generate consistent returns with advanced risk management.
            </p>
            
            <p><strong>Key Capabilities:</strong></p>
            <ul>
              <li>Real-time liquidation detection with cascade risk analysis</li>
              <li>Advanced Dollar Cost Averaging (DCA) with volatility-based sizing</li>
              <li>Multi-layer risk management with portfolio-level controls</li>
              <li>Paper trading mode for risk-free strategy testing</li>
              <li>Complete performance analytics with permanent data retention</li>
              <li>24/7 automated trading with live exchange integration</li>
            </ul>
          </section>

          {/* What is Liquidation Hunting */}
          <section>
            <h2>What is Liquidation Hunting?</h2>
            
            <h3>The Market Opportunity</h3>
            <p>
              When leveraged traders get liquidated, their positions are forcefully closed at market price, creating temporary price dislocations. These liquidation events create three key opportunities:
            </p>
            <ol>
              <li><strong>Oversold/Overbought Conditions:</strong> Forced market orders create temporary price extremes</li>
              <li><strong>Cascade Effects:</strong> One liquidation can trigger others, amplifying price movements</li>
              <li><strong>Mean Reversion:</strong> Prices typically revert after forced liquidation pressure subsides</li>
            </ol>

            <h3>Our Trading Strategy</h3>
            <p>The MPI™ Liquidation Hunter Bot employs a systematic five-step approach:</p>
            <ol>
              <li><strong>Monitor:</strong> Real-time liquidation streams from Aster DEX</li>
              <li><strong>Analyze:</strong> Cascade risk and market microstructure indicators</li>
              <li><strong>Identify:</strong> High-quality reversal opportunities using proprietary scoring</li>
              <li><strong>Execute:</strong> Counter-trend positions with precision order placement</li>
              <li><strong>Manage:</strong> Dynamic risk control through DCA and protective stops</li>
            </ol>

            <p><strong>Counter-Trading Logic:</strong></p>
            <ul>
              <li>When long positions liquidate (selling pressure) → Execute LONG positions (buy the dip)</li>
              <li>When short positions liquidate (buying pressure) → Execute SHORT positions (sell the rally)</li>
            </ul>
          </section>

          {/* Core Features */}
          <section>
            <h2>Core Features</h2>

            <h3>1. Real-Time Liquidation Detection</h3>
            <p><strong>Intelligent Signal Processing:</strong></p>
            <ul>
              <li>WebSocket connection to Aster DEX with sub-second latency</li>
              <li>Configurable percentile thresholds (1st through 99th percentile)</li>
              <li>Multi-symbol monitoring across 18+ cryptocurrency pairs</li>
              <li>Lookback window analysis (1-24 hours configurable)</li>
              <li>Duplicate liquidation filtering and deduplication</li>
            </ul>

            <p><strong>Cascade Risk Analysis:</strong></p>
            <ul>
              <li><strong>LQ Score:</strong> Liquidation quantity relative to median (scale: 0-∞)</li>
              <li><strong>RET Score:</strong> Realized volatility indicator (scale: 0-∞)</li>
              <li><strong>OI Delta:</strong> Open interest changes (1min & 3min windows)</li>
              <li><strong>Reversal Quality:</strong> Four-tier classification (Poor, OK, Good, Excellent)</li>
              <li><strong>Auto-Block System:</strong> Prevents trading during extreme cascade events</li>
            </ul>

            <h3>2. Advanced DCA (Dollar Cost Averaging) System</h3>
            
            <p><strong>Volatility-Based Step Spacing:</strong></p>
            <p className="font-mono text-sm">c<sub>k</sub> = Δ<sub>1</sub> × k<sup>p</sup> × max(1, ATR/V<sub>ref</sub>)</p>
            <ul>
              <li>Δ<sub>1</sub> = Starting step distance (e.g., 0.4%)</li>
              <li>p = Convexity factor (e.g., 1.2) for widening layer spacing</li>
              <li>V<sub>ref</sub> = Reference volatility baseline</li>
            </ul>

            <p><strong>Exponential Size Growth:</strong></p>
            <p className="font-mono text-sm">w<sub>k</sub> = g<sup>(k-1)</sup></p>
            <p>Where g = growth ratio (e.g., 1.8x per layer)</p>

            <p><strong>Dynamic Exit Pricing:</strong></p>
            <ul>
              <li><strong>Take Profit:</strong> Volatility-adjusted distance with exit cushion multiplier</li>
              <li><strong>Stop Loss:</strong> Calculated from weighted average entry price</li>
              <li><strong>Auto-Update:</strong> TP/SL recalculated after each layer fill</li>
            </ul>

            <p><strong>Risk-Aware Position Sizing:</strong></p>
            <ul>
              <li>Total position risk capped at configurable percentage of account balance</li>
              <li>Layer-by-layer risk calculation accounting for cumulative exposure</li>
            </ul>

            <h3>3. Portfolio Risk Management</h3>
            <p><strong>Multi-Layer Protection:</strong></p>
            <ul>
              <li>Maximum open positions (0-20 concurrent positions, 0 = unlimited)</li>
              <li>Maximum portfolio risk percentage (1-100% of account balance)</li>
              <li>Configurable margin allocation (1-100% of available funds)</li>
              <li>Per-trade leverage control (1-125x with safety warnings)</li>
              <li>Real-time exposure monitoring and position tracking</li>
              <li>Emergency "Close All Positions" function</li>
            </ul>

            <h3>4. Intelligent Order Execution</h3>
            <p><strong>Smart Order Management:</strong></p>
            <ul>
              <li><strong>Price Chase Mode:</strong> Automatically adjusts limit prices during rapid market moves</li>
              <li><strong>Order Delay:</strong> Configurable wait time between detection and execution (100ms-30s)</li>
              <li><strong>Slippage Tolerance:</strong> Maximum acceptable price deviation (0.1-5%)</li>
              <li><strong>Retry Duration:</strong> Maximum time to pursue price target (5s-5min)</li>
              <li><strong>Batch Execution:</strong> Efficient order placement for multiple layers</li>
              <li><strong>Atomic Updates:</strong> Cancel-and-replace for TP/SL modifications</li>
            </ul>

            <h3>5. Market Direction Analysis</h3>
            <p><strong>Multi-Factor Sentiment Scoring:</strong></p>
            <ul>
              <li><strong>Order Book Pressure (60% weight):</strong> Bid/ask depth imbalance analysis</li>
              <li><strong>Funding Rates (40% weight):</strong> Current funding rate directional bias</li>
              <li><strong>Output:</strong> Directional confidence score (0-100%) with bias indication</li>
            </ul>

            <h3>6. Liquidity Analysis & Asset Ranking</h3>
            <p><strong>Real-Time Liquidity Metrics:</strong></p>
            <ul>
              <li>Bid/ask depth measurement at best price levels</li>
              <li>Trade size capacity analysis for position sizing</li>
              <li>Slippage estimation for various order sizes</li>
            </ul>

            <p><strong>Asset Ranking Modes:</strong></p>
            <ol>
              <li>By Liquidation Activity (default ranking)</li>
              <li>By Best Liquidity (optimal for large positions)</li>
              <li>Alphabetical (simple symbol ordering)</li>
            </ol>
          </section>

          {/* Trading Strategy */}
          <section>
            <h2>Trading Strategy Logic</h2>

            <h3>Entry Requirements</h3>
            <p>All conditions must be satisfied for trade execution:</p>
            <ol>
              <li><strong>Asset Filter:</strong> Symbol must be in selected assets list</li>
              <li><strong>Percentile Threshold:</strong> Liquidation size must meet or exceed configured percentile</li>
              <li><strong>Cascade Risk:</strong> Reversal quality must meet minimum threshold requirement</li>
              <li><strong>Portfolio Limits:</strong> Must not exceed maximum position count or risk limit</li>
              <li><strong>Cooldown Period:</strong> No recent entry for the same symbol (prevents over-trading)</li>
            </ol>

            <h3>Layer Addition Logic</h3>
            <p>Additional layers are added when:</p>
            <ul>
              <li>New qualifying liquidation detected for existing position symbol</li>
              <li>Price has moved against current position (DCA trigger activated)</li>
              <li>Current layer count is below maximum configured layers</li>
              <li>Additional position risk remains below portfolio risk limit</li>
            </ul>

            <h3>Exit Conditions</h3>
            <p><strong>Take Profit:</strong> Calculated using volatility-adjusted distance with configurable exit cushion multiplier. Automatically updated after each layer addition.</p>
            
            <p><strong>Stop Loss:</strong> Fixed percentage from weighted average entry price (typical range: 2-5%). Protects against adverse price movements.</p>
            
            <p><strong>Manual Exit:</strong> Individual positions can be closed manually, or all positions can be emergency-stopped via dashboard controls.</p>
          </section>

          {/* Risk Management */}
          <section>
            <h2>Risk Management System</h2>

            <h3>Position-Level Controls</h3>
            <ul>
              <li>Maximum risk per trade (configurable % of account balance)</li>
              <li>Position size limits (minimum and maximum notional values)</li>
              <li>Minimum position size enforcement for cost efficiency</li>
              <li>Leverage limits (1-125x with visual warnings above 20x)</li>
              <li>Dynamic stop loss protection with automatic updates</li>
            </ul>

            <h3>Portfolio-Level Controls</h3>
            <ul>
              <li>Maximum total exposure (% of account balance)</li>
              <li>Maximum positions per symbol (prevents concentration)</li>
              <li>Maximum open positions across all symbols</li>
              <li>Symbol concentration limits and diversification enforcement</li>
              <li>Real-time profit & loss monitoring with alerts</li>
            </ul>

            <h3>Market Condition Filters</h3>
            <p><strong>Cascade Detection Auto-Block System:</strong></p>
            <ul>
              <li><strong>Red Status (Score ≥6):</strong> All new entries blocked - extreme risk</li>
              <li><strong>Orange Status (Score ≥4):</strong> High-risk warning - proceed with caution</li>
              <li><strong>Yellow Status (Score ≥2):</strong> Moderate caution - elevated risk</li>
              <li><strong>Green Status (Score &lt;2):</strong> Normal operation - acceptable risk</li>
            </ul>

            <h3>Order Execution Safety</h3>
            <ul>
              <li>Idempotency protection to prevent duplicate order placement</li>
              <li>Atomic cancel-then-place operations for TP/SL updates</li>
              <li>Live order verification and automatic correction</li>
              <li>Orphaned order cleanup (5-second monitoring cycle)</li>
              <li>Price chase safety limits to prevent runaway orders</li>
            </ul>
          </section>

          {/* Technical Architecture */}
          <section>
            <h2>Technical Architecture</h2>

            <h3>Real-Time Data Infrastructure</h3>
            <ul>
              <li>WebSocket streams with sub-second latency for liquidations</li>
              <li>REST API integration with HMAC-SHA256 authentication</li>
              <li>Rate limiting and request queuing for API compliance</li>
              <li>Connection pooling for high-performance database access</li>
            </ul>

            <h3>Database Architecture</h3>
            <p><strong>Neon PostgreSQL (Serverless):</strong></p>
            <ul>
              <li>Permanent data retention - ALL trading data preserved forever</li>
              <li>Session-based organization for live/paper mode separation</li>
              <li>Automatic archiving (liquidations: 30-day retention, trades: permanent)</li>
              <li>Connection pooling via serverless HTTP driver</li>
            </ul>

            <h3>Technology Stack</h3>
            <p><strong>Frontend:</strong> React 18, TypeScript, Vite, Radix UI, shadcn/ui, Tailwind CSS</p>
            <p><strong>Backend:</strong> Node.js, Express, TypeScript, Drizzle ORM</p>
            <p><strong>Database:</strong> PostgreSQL (Neon Serverless), Connection Pooling</p>
            <p><strong>Real-Time:</strong> WebSocket (Aster DEX), User Data Streams</p>

            <h3>Core Services</h3>
            <ul>
              <li><strong>Strategy Engine:</strong> Core trading logic, signal processing, position management</li>
              <li><strong>Cascade Detector:</strong> Real-time liquidation analysis, reversal quality scoring</li>
              <li><strong>DCA Calculator:</strong> Mathematical DCA computation, volatility scaling, dynamic exits</li>
              <li><strong>Order Protection Service:</strong> TP/SL management, idempotency, orphaned order cleanup</li>
            </ul>
          </section>

          {/* Performance Tracking */}
          <section>
            <h2>Performance Tracking</h2>

            <h3>Key Metrics</h3>
            <ul>
              <li><strong>Total Trades:</strong> Combined open and closed position count</li>
              <li><strong>Win Rate:</strong> Percentage of profitable closed trades</li>
              <li><strong>Total P&L:</strong> Realized gains/losses plus unrealized position values</li>
              <li><strong>Profit Factor:</strong> Gross profit divided by gross loss ratio</li>
              <li><strong>Maximum Drawdown:</strong> Largest peak-to-trough decline</li>
              <li><strong>Average Win/Loss:</strong> Mean profit and loss per trade</li>
            </ul>

            <h3>Interactive Performance Chart</h3>
            <ul>
              <li>Per-trade P&L bars with color coding (lime = profit, orange = loss)</li>
              <li>Cumulative P&L line graph tracking account growth</li>
              <li>Day-based grouping with trade count indicators</li>
              <li>Strategy change markers for parameter adjustments</li>
              <li>Pagination support for large historical datasets</li>
              <li>Automatic Y-axis scaling with zero reference baseline</li>
            </ul>
          </section>

          {/* Getting Started */}
          <section>
            <h2>Getting Started</h2>

            <h3>Step 1: Initial Setup</h3>
            <p><strong>Prerequisites:</strong></p>
            <ul>
              <li>Aster DEX account with API access enabled</li>
              <li>API Key and Secret Key credentials</li>
              <li>Funded account (minimum $100 recommended for testing)</li>
            </ul>

            <p><strong>Configuration Steps:</strong></p>
            <ol>
              <li>Access Settings via the header Settings button</li>
              <li>Navigate to "API Connection" tab</li>
              <li>Enter your Aster DEX API credentials</li>
              <li>Click "Test Connection" to verify (displays account balance)</li>
            </ol>

            <h3>Step 2: Paper Trading (Strongly Recommended)</h3>
            <p><strong>Purpose:</strong> Test strategies risk-free with simulated funds based on real market conditions.</p>
            
            <p><strong>Setup Process:</strong></p>
            <ol>
              <li>Create new strategy or use default configuration</li>
              <li>Ensure "Trading Mode" is set to Paper</li>
              <li>Configure desired risk parameters and asset selection</li>
              <li>Click "Activate Strategy" to begin simulation</li>
              <li>Monitor performance without risking real capital</li>
            </ol>

            <h3>Step 3: Transitioning to Live Trading</h3>
            <p><strong>Pre-Live Checklist:</strong></p>
            <ul>
              <li>Tested strategy thoroughly in paper mode (minimum 20-50 trades recommended)</li>
              <li>Reviewed and understood all risk parameters and their implications</li>
              <li>Set appropriate position limits based on account size</li>
              <li>Configured portfolio risk caps (recommended: start with 20-30% max)</li>
              <li>Verified API credentials are correct and have trading permissions</li>
              <li>Ensured sufficient account balance for planned position sizes</li>
            </ul>

            <h3>Best Practices</h3>
            <p><strong>Risk Management:</strong></p>
            <ul>
              <li>Always start with paper trading to validate strategy</li>
              <li>Use conservative leverage (5-10x recommended for beginners)</li>
              <li>Set stop losses on every position</li>
              <li>Never risk more than 2-5% of account per trade</li>
            </ul>

            <p><strong>Strategy Optimization:</strong></p>
            <ul>
              <li>Review performance after 20-50 trades before making adjustments</li>
              <li>Adjust percentile threshold based on win rate and market conditions</li>
              <li>Fine-tune DCA parameters gradually based on results</li>
            </ul>

            <p><strong>Operational Guidelines:</strong></p>
            <ul>
              <li>Check bot status daily for proper operation</li>
              <li>Monitor cascade risk indicator before major market events</li>
              <li>Maintain sufficient balance for margin requirements</li>
              <li>Export settings monthly for backup purposes</li>
            </ul>
          </section>

          {/* Safety & Security */}
          <section>
            <h2>Safety & Security</h2>

            <h3>API Security</h3>
            <ul>
              <li>HMAC-SHA256 signature authentication for all exchange requests</li>
              <li>API keys stored securely as environment variables</li>
              <li>Rate limiting implementation to prevent API abuse</li>
              <li>Request queuing for proper order management</li>
            </ul>

            <h3>Trading Safety Layers</h3>
            <p><strong>Pre-Trade Validations:</strong></p>
            <ul>
              <li>Account balance verification before order placement</li>
              <li>Position size limit checks against configured maximums</li>
              <li>Portfolio risk calculations and limit enforcement</li>
              <li>Exchange-specific requirement validation</li>
            </ul>

            <p><strong>In-Trade Protection:</strong></p>
            <ul>
              <li>Immediate TP/SL placement upon position entry</li>
              <li>Continuous order verification and correction</li>
              <li>Orphaned order cleanup every 5 seconds</li>
              <li>Position state synchronization with exchange</li>
            </ul>

            <p><strong>Post-Trade Safeguards:</strong></p>
            <ul>
              <li>Fill confirmation and reconciliation</li>
              <li>P&L calculation and verification</li>
              <li>Position data synchronization</li>
              <li>Funding cost tracking and attribution</li>
            </ul>

            <h3>Emergency Controls</h3>
            <ul>
              <li>One-click emergency stop to close all positions</li>
              <li>Strategy pause/resume functionality</li>
              <li>Live session termination capability</li>
              <li>Manual position override and adjustment</li>
            </ul>
          </section>

          {/* Disclaimer */}
          <section>
            <h2>Risk Disclaimer</h2>
            
            <p className="font-semibold">
              Trading cryptocurrency derivatives involves substantial risk of loss and is not suitable for all investors.
            </p>
            
            <p>
              Past performance is not indicative of future results. The MPI™ Liquidation Hunter Bot is an algorithmic trading tool and does not guarantee profits. Users should be aware of the following risks:
            </p>

            <p><strong>Market Risks:</strong></p>
            <ul>
              <li>Cryptocurrency markets exhibit extreme volatility that can result in rapid and substantial losses</li>
              <li>Leverage amplifies both potential gains and potential losses</li>
              <li>Liquidation cascades can be unpredictable and may extend beyond historical patterns</li>
              <li>Market conditions can change rapidly, rendering historical strategies ineffective</li>
            </ul>

            <p><strong>Technical Risks:</strong></p>
            <ul>
              <li>Exchange downtime or connectivity issues may prevent proper order management</li>
              <li>Software bugs or errors may occur despite extensive testing</li>
              <li>API rate limits or restrictions may affect execution</li>
              <li>Network latency may impact order placement timing</li>
            </ul>

            <p><strong>User Responsibility:</strong></p>
            <p>
              You are solely responsible for your trading decisions and their outcomes. It is strongly recommended to:
            </p>
            <ul>
              <li>Always begin with paper trading to understand the system</li>
              <li>Never trade with money you cannot afford to lose</li>
              <li>Set appropriate risk limits based on your personal risk tolerance</li>
              <li>Monitor positions regularly and maintain adequate account balance</li>
              <li>Understand all features and risks before activating live trading</li>
            </ul>

            <p>
              By using this software, you acknowledge and accept these risks and agree that Max Pain Industry™ and its developers are not liable for any trading losses incurred.
            </p>
          </section>

          {/* Conclusion */}
          <section>
            <h2>Conclusion</h2>
            
            <p>
              The MPI™ Liquidation Hunter Bot represents a sophisticated approach to algorithmic trading, combining real-time market microstructure analysis with advanced risk management to capitalize on liquidation-driven price inefficiencies.
            </p>

            <p><strong>Core Strengths:</strong></p>
            <ul>
              <li>Institutional-grade DCA system with mathematical precision</li>
              <li>Multi-layer risk management protecting trading capital</li>
              <li>Real-time cascade detection preventing exposure to extreme events</li>
              <li>Complete performance transparency with permanent historical data retention</li>
              <li>Paper trading mode enabling risk-free strategy development</li>
              <li>Flexible configuration accommodating various risk tolerances and account sizes</li>
            </ul>

            <p className="text-center mt-12 mb-8">
              <strong className="text-lg">MPI™ - Max Pain Industry</strong><br/>
              <em className="text-muted-foreground">"Hunt the Hunters"</em>
            </p>
          </section>

          <hr className="my-8" />

          <p className="text-center text-sm text-muted-foreground">
            Document Version 2.0 | October 2025 | Max Pain Industry™
          </p>
        </article>
      </main>

      {/* Print Styles */}
      <style>{`
        @media print {
          @page {
            margin: 2cm;
            size: A4;
          }
          
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          
          .print\\:hidden {
            display: none !important;
          }
          
          .print\\:mb-12 {
            margin-bottom: 3rem;
          }
          
          h1, h2, h3, h4, h5, h6 {
            page-break-after: avoid;
            break-after: avoid;
          }
          
          p, li {
            orphans: 3;
            widows: 3;
          }
          
          ul, ol {
            page-break-inside: avoid;
          }
          
          .lead {
            font-size: 1.125rem;
            line-height: 1.75;
          }
        }
      `}</style>
    </div>
  );
}
