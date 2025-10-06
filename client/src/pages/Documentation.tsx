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
        <article className="space-y-12">
          
          {/* Title */}
          <div className="text-center pb-8 border-b">
            <h1 className="text-4xl font-bold mb-3">MPI™ Liquidation Hunter Bot</h1>
            <p className="text-xl text-muted-foreground mb-2">Professional Trading Documentation</p>
            <p className="text-sm text-muted-foreground">Version 2.0 | Max Pain Industry™ | October 2025</p>
          </div>

          {/* Executive Summary */}
          <section>
            <h2 className="text-2xl font-semibold mb-6">Executive Summary</h2>
            <p className="text-lg mb-6">
              The MPI™ Liquidation Hunter Bot is a sophisticated algorithmic trading system designed to capitalize on liquidation events in cryptocurrency futures markets. By detecting and counter-trading forced liquidations on the Aster DEX exchange, the bot exploits temporary price dislocations to generate consistent returns with advanced risk management.
            </p>
            
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 my-8">
              <div className="border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold mb-1">18+</div>
                <div className="text-sm text-muted-foreground">Trading Pairs</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold mb-1">&lt;1s</div>
                <div className="text-sm text-muted-foreground">Detection Latency</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold mb-1">24/7</div>
                <div className="text-sm text-muted-foreground">Automated Trading</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold mb-1">1-125x</div>
                <div className="text-sm text-muted-foreground">Leverage Range</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold mb-1">∞</div>
                <div className="text-sm text-muted-foreground">Data Retention</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-3xl font-bold mb-1">4-Tier</div>
                <div className="text-sm text-muted-foreground">Risk Scoring</div>
              </div>
            </div>

            <div className="border-l-4 border-muted pl-4 my-6">
              <p className="font-semibold mb-3">Core Capabilities:</p>
              <ul className="space-y-2 text-muted-foreground">
                <li>• Real-time liquidation detection with cascade risk analysis</li>
                <li>• Advanced Dollar Cost Averaging (DCA) with volatility-based sizing</li>
                <li>• Multi-layer risk management with portfolio-level controls</li>
                <li>• Paper trading mode for risk-free strategy testing</li>
                <li>• Complete performance analytics with permanent data retention</li>
              </ul>
            </div>
          </section>

          {/* What is Liquidation Hunting */}
          <section>
            <h2 className="text-2xl font-semibold mb-6">What is Liquidation Hunting?</h2>
            
            <h3 className="text-xl font-semibold mb-4">The Market Opportunity</h3>
            <p className="mb-4">
              When leveraged traders get liquidated, their positions are forcefully closed at market price, creating temporary price dislocations:
            </p>

            {/* Opportunity Table */}
            <div className="border rounded-lg overflow-hidden mb-6">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-semibold">Event Type</th>
                    <th className="text-left p-3 font-semibold">Market Impact</th>
                    <th className="text-left p-3 font-semibold">Trading Opportunity</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="p-3">Oversold Conditions</td>
                    <td className="p-3 text-muted-foreground">Forced selling creates price extremes</td>
                    <td className="p-3">Buy at discount</td>
                  </tr>
                  <tr>
                    <td className="p-3">Cascade Effects</td>
                    <td className="p-3 text-muted-foreground">One liquidation triggers others</td>
                    <td className="p-3">Amplified reversals</td>
                  </tr>
                  <tr>
                    <td className="p-3">Mean Reversion</td>
                    <td className="p-3 text-muted-foreground">Prices normalize after pressure</td>
                    <td className="p-3">Profit on reversion</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-xl font-semibold mb-4">Trading Strategy Process</h3>
            
            {/* Process Flow */}
            <div className="space-y-3 mb-6">
              <div className="flex items-start gap-4 p-4 border rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold">1</div>
                <div>
                  <div className="font-semibold mb-1">Monitor</div>
                  <div className="text-sm text-muted-foreground">Real-time liquidation streams from Aster DEX</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 border rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold">2</div>
                <div>
                  <div className="font-semibold mb-1">Analyze</div>
                  <div className="text-sm text-muted-foreground">Cascade risk and market microstructure indicators</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 border rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold">3</div>
                <div>
                  <div className="font-semibold mb-1">Identify</div>
                  <div className="text-sm text-muted-foreground">High-quality reversal opportunities using proprietary scoring</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 border rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold">4</div>
                <div>
                  <div className="font-semibold mb-1">Execute</div>
                  <div className="text-sm text-muted-foreground">Counter-trend positions with precision order placement</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 border rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold">5</div>
                <div>
                  <div className="font-semibold mb-1">Manage</div>
                  <div className="text-sm text-muted-foreground">Dynamic risk control through DCA and protective stops</div>
                </div>
              </div>
            </div>

            {/* Counter-Trading Logic */}
            <div className="border rounded-lg p-6 bg-muted/30">
              <h4 className="font-semibold mb-4 text-center">Counter-Trading Logic</h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="text-center p-4 border rounded">
                  <div className="font-semibold mb-2">Long Liquidations</div>
                  <div className="text-sm text-muted-foreground mb-2">Selling Pressure Detected</div>
                  <div className="text-sm">→ Execute <strong>LONG</strong> Position</div>
                </div>
                <div className="text-center p-4 border rounded">
                  <div className="font-semibold mb-2">Short Liquidations</div>
                  <div className="text-sm text-muted-foreground mb-2">Buying Pressure Detected</div>
                  <div className="text-sm">→ Execute <strong>SHORT</strong> Position</div>
                </div>
              </div>
            </div>
          </section>

          {/* Core Features */}
          <section>
            <h2 className="text-2xl font-semibold mb-6">Core Features</h2>

            {/* Feature 1: Detection */}
            <div className="mb-8">
              <h3 className="text-xl font-semibold mb-4">1. Real-Time Liquidation Detection</h3>
              
              <div className="border rounded-lg overflow-hidden mb-4">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-semibold">Component</th>
                      <th className="text-left p-3 font-semibold">Specification</th>
                      <th className="text-left p-3 font-semibold">Range</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr>
                      <td className="p-3">Connection Type</td>
                      <td className="p-3 text-muted-foreground">WebSocket Stream</td>
                      <td className="p-3">&lt;1s latency</td>
                    </tr>
                    <tr>
                      <td className="p-3">Percentile Filter</td>
                      <td className="p-3 text-muted-foreground">Configurable Threshold</td>
                      <td className="p-3">1st - 99th</td>
                    </tr>
                    <tr>
                      <td className="p-3">Symbol Coverage</td>
                      <td className="p-3 text-muted-foreground">Multi-Asset Monitoring</td>
                      <td className="p-3">18+ pairs</td>
                    </tr>
                    <tr>
                      <td className="p-3">Lookback Window</td>
                      <td className="p-3 text-muted-foreground">Historical Analysis</td>
                      <td className="p-3">1-24 hours</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="border-l-4 border-muted pl-4">
                <p className="font-semibold mb-2">Cascade Risk Scoring:</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="font-semibold">LQ Score</div>
                    <div className="text-muted-foreground">Liquidation quantity vs median</div>
                  </div>
                  <div>
                    <div className="font-semibold">RET Score</div>
                    <div className="text-muted-foreground">Realized volatility indicator</div>
                  </div>
                  <div>
                    <div className="font-semibold">OI Delta</div>
                    <div className="text-muted-foreground">Open interest changes</div>
                  </div>
                  <div>
                    <div className="font-semibold">Quality Tier</div>
                    <div className="text-muted-foreground">Poor / OK / Good / Excellent</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 2: DCA */}
            <div className="mb-8">
              <h3 className="text-xl font-semibold mb-4">2. Advanced DCA System</h3>
              
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div className="border rounded-lg p-4">
                  <div className="font-semibold mb-3">Volatility-Based Spacing</div>
                  <div className="font-mono text-sm bg-muted p-3 rounded mb-3">
                    c<sub>k</sub> = Δ<sub>1</sub> × k<sup>p</sup> × max(1, ATR/V<sub>ref</sub>)
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Δ<sub>1</sub> = Starting step (e.g., 0.4%)</div>
                    <div>p = Convexity factor (e.g., 1.2)</div>
                    <div>V<sub>ref</sub> = Volatility baseline</div>
                  </div>
                </div>
                
                <div className="border rounded-lg p-4">
                  <div className="font-semibold mb-3">Exponential Size Growth</div>
                  <div className="font-mono text-sm bg-muted p-3 rounded mb-3">
                    w<sub>k</sub> = g<sup>(k-1)</sup>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>g = Growth ratio (e.g., 1.8x)</div>
                    <div>k = Layer number</div>
                    <div>Progressive position sizing</div>
                  </div>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-semibold">Exit Type</th>
                      <th className="text-left p-3 font-semibold">Calculation Method</th>
                      <th className="text-left p-3 font-semibold">Update Frequency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr>
                      <td className="p-3">Take Profit</td>
                      <td className="p-3 text-muted-foreground">Volatility-adjusted + exit cushion</td>
                      <td className="p-3">After each layer</td>
                    </tr>
                    <tr>
                      <td className="p-3">Stop Loss</td>
                      <td className="p-3 text-muted-foreground">% from weighted avg entry</td>
                      <td className="p-3">After each layer</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Feature 3: Risk Management */}
            <div className="mb-8">
              <h3 className="text-xl font-semibold mb-4">3. Portfolio Risk Management</h3>
              
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-semibold">Control Type</th>
                      <th className="text-left p-3 font-semibold">Parameter</th>
                      <th className="text-left p-3 font-semibold">Range</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr>
                      <td className="p-3">Position Limits</td>
                      <td className="p-3 text-muted-foreground">Max open positions</td>
                      <td className="p-3">0-20 (0 = unlimited)</td>
                    </tr>
                    <tr>
                      <td className="p-3">Portfolio Risk</td>
                      <td className="p-3 text-muted-foreground">Max exposure %</td>
                      <td className="p-3">1-100%</td>
                    </tr>
                    <tr>
                      <td className="p-3">Margin Allocation</td>
                      <td className="p-3 text-muted-foreground">Available funds %</td>
                      <td className="p-3">1-100%</td>
                    </tr>
                    <tr>
                      <td className="p-3">Leverage Control</td>
                      <td className="p-3 text-muted-foreground">Per-trade leverage</td>
                      <td className="p-3">1-125x</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Feature 4: Order Execution */}
            <div className="mb-8">
              <h3 className="text-xl font-semibold mb-4">4. Intelligent Order Execution</h3>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="border rounded-lg p-4 text-center">
                  <div className="font-semibold mb-2">Price Chase</div>
                  <div className="text-2xl font-bold mb-1">Yes</div>
                  <div className="text-xs text-muted-foreground">Auto-adjust limits</div>
                </div>
                <div className="border rounded-lg p-4 text-center">
                  <div className="font-semibold mb-2">Order Delay</div>
                  <div className="text-2xl font-bold mb-1">100ms-30s</div>
                  <div className="text-xs text-muted-foreground">Configurable wait</div>
                </div>
                <div className="border rounded-lg p-4 text-center">
                  <div className="font-semibold mb-2">Slippage</div>
                  <div className="text-2xl font-bold mb-1">0.1-5%</div>
                  <div className="text-xs text-muted-foreground">Max deviation</div>
                </div>
                <div className="border rounded-lg p-4 text-center">
                  <div className="font-semibold mb-2">Retry</div>
                  <div className="text-2xl font-bold mb-1">5s-5min</div>
                  <div className="text-xs text-muted-foreground">Chase duration</div>
                </div>
              </div>
            </div>
          </section>

          {/* Risk Management System */}
          <section>
            <h2 className="text-2xl font-semibold mb-6">Risk Management System</h2>

            {/* Cascade Auto-Block */}
            <div className="border rounded-lg p-6 mb-6 bg-muted/20">
              <h3 className="text-lg font-semibold mb-4">Cascade Detection Auto-Block</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 border rounded">
                  <div className="font-bold text-lg mb-1">Red</div>
                  <div className="text-sm mb-2">Score ≥6</div>
                  <div className="text-xs text-muted-foreground">All entries blocked</div>
                </div>
                <div className="text-center p-3 border rounded">
                  <div className="font-bold text-lg mb-1">Orange</div>
                  <div className="text-sm mb-2">Score ≥4</div>
                  <div className="text-xs text-muted-foreground">High risk warning</div>
                </div>
                <div className="text-center p-3 border rounded">
                  <div className="font-bold text-lg mb-1">Yellow</div>
                  <div className="text-sm mb-2">Score ≥2</div>
                  <div className="text-xs text-muted-foreground">Moderate caution</div>
                </div>
                <div className="text-center p-3 border rounded">
                  <div className="font-bold text-lg mb-1">Green</div>
                  <div className="text-sm mb-2">Score &lt;2</div>
                  <div className="text-xs text-muted-foreground">Normal operation</div>
                </div>
              </div>
            </div>

            {/* Multi-Layer Protection */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="border rounded-lg p-4">
                <h4 className="font-semibold mb-3">Position-Level Controls</h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Max risk per trade (% of account)</li>
                  <li>• Position size limits (min/max)</li>
                  <li>• Leverage limits with warnings</li>
                  <li>• Dynamic stop loss protection</li>
                </ul>
              </div>
              <div className="border rounded-lg p-4">
                <h4 className="font-semibold mb-3">Portfolio-Level Controls</h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Max total exposure (% of account)</li>
                  <li>• Max positions per symbol</li>
                  <li>• Concentration limits</li>
                  <li>• Real-time P&L monitoring</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Performance Metrics */}
          <section>
            <h2 className="text-2xl font-semibold mb-6">Performance Tracking</h2>

            <div className="border rounded-lg overflow-hidden mb-6">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-semibold">Metric</th>
                    <th className="text-left p-3 font-semibold">Description</th>
                    <th className="text-left p-3 font-semibold">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="p-3 font-medium">Total Trades</td>
                    <td className="p-3 text-muted-foreground">Open + Closed positions</td>
                    <td className="p-3 text-sm">Activity volume</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Win Rate</td>
                    <td className="p-3 text-muted-foreground">% of profitable trades</td>
                    <td className="p-3 text-sm">Strategy accuracy</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Total P&L</td>
                    <td className="p-3 text-muted-foreground">Realized + Unrealized</td>
                    <td className="p-3 text-sm">Account growth</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Profit Factor</td>
                    <td className="p-3 text-muted-foreground">Gross profit / loss ratio</td>
                    <td className="p-3 text-sm">Strategy efficiency</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Max Drawdown</td>
                    <td className="p-3 text-muted-foreground">Peak to trough decline</td>
                    <td className="p-3 text-sm">Risk assessment</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Avg Win/Loss</td>
                    <td className="p-3 text-muted-foreground">Mean per trade</td>
                    <td className="p-3 text-sm">Trade sizing</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="border-l-4 border-muted pl-4">
              <p className="font-semibold mb-2">Interactive Chart Features:</p>
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <div>• Per-trade P&L bars with color coding</div>
                <div>• Cumulative P&L trend line</div>
                <div>• Day-based grouping with counts</div>
                <div>• Strategy change markers</div>
                <div>• Pagination for large datasets</div>
                <div>• Auto-scaling Y-axis</div>
              </div>
            </div>
          </section>

          {/* Getting Started */}
          <section>
            <h2 className="text-2xl font-semibold mb-6">Getting Started</h2>

            <div className="space-y-6">
              {/* Step 1 */}
              <div className="border rounded-lg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold text-lg">1</div>
                  <h3 className="text-lg font-semibold">Initial Setup</h3>
                </div>
                <div className="ml-13 space-y-3">
                  <div>
                    <div className="font-semibold text-sm mb-1">Prerequisites:</div>
                    <div className="text-sm text-muted-foreground">Aster DEX account • API credentials • Minimum $100 balance</div>
                  </div>
                  <div>
                    <div className="font-semibold text-sm mb-1">Steps:</div>
                    <div className="text-sm text-muted-foreground">Settings → API Connection → Enter credentials → Test connection</div>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="border rounded-lg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold text-lg">2</div>
                  <h3 className="text-lg font-semibold">Paper Trading</h3>
                </div>
                <div className="ml-13">
                  <div className="text-sm text-muted-foreground mb-3">Test strategies risk-free with simulated funds</div>
                  <div className="grid md:grid-cols-3 gap-3 text-sm">
                    <div className="border rounded p-3">
                      <div className="font-semibold mb-1">Configure</div>
                      <div className="text-muted-foreground text-xs">Set parameters</div>
                    </div>
                    <div className="border rounded p-3">
                      <div className="font-semibold mb-1">Set Mode</div>
                      <div className="text-muted-foreground text-xs">Select Paper</div>
                    </div>
                    <div className="border rounded p-3">
                      <div className="font-semibold mb-1">Activate</div>
                      <div className="text-muted-foreground text-xs">Monitor results</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="border rounded-lg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold text-lg">3</div>
                  <h3 className="text-lg font-semibold">Live Trading Checklist</h3>
                </div>
                <div className="ml-13">
                  <div className="grid md:grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border rounded flex items-center justify-center text-xs">✓</div>
                      <span className="text-muted-foreground">Tested in paper mode (20+ trades)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border rounded flex items-center justify-center text-xs">✓</div>
                      <span className="text-muted-foreground">Reviewed risk parameters</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border rounded flex items-center justify-center text-xs">✓</div>
                      <span className="text-muted-foreground">Set position limits</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border rounded flex items-center justify-center text-xs">✓</div>
                      <span className="text-muted-foreground">Verified sufficient balance</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Technical Architecture */}
          <section>
            <h2 className="text-2xl font-semibold mb-6">Technical Architecture</h2>

            <div className="grid md:grid-cols-4 gap-4 mb-6">
              <div className="border rounded-lg p-4 text-center">
                <div className="font-semibold mb-1">Frontend</div>
                <div className="text-sm text-muted-foreground">React + TypeScript</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="font-semibold mb-1">Backend</div>
                <div className="text-sm text-muted-foreground">Node.js + Express</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="font-semibold mb-1">Database</div>
                <div className="text-sm text-muted-foreground">Neon PostgreSQL</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="font-semibold mb-1">UI</div>
                <div className="text-sm text-muted-foreground">Radix + Tailwind</div>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-semibold">Service</th>
                    <th className="text-left p-3 font-semibold">Function</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="p-3 font-medium">Strategy Engine</td>
                    <td className="p-3 text-muted-foreground">Core trading logic, signal processing, position management</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Cascade Detector</td>
                    <td className="p-3 text-muted-foreground">Real-time liquidation analysis, reversal quality scoring</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">DCA Calculator</td>
                    <td className="p-3 text-muted-foreground">Mathematical position sizing, volatility scaling, exits</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Order Protection</td>
                    <td className="p-3 text-muted-foreground">TP/SL management, idempotency, orphaned order cleanup</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Disclaimer */}
          <section>
            <h2 className="text-2xl font-semibold mb-6">Risk Disclaimer</h2>
            
            <div className="border-2 rounded-lg p-6 bg-muted/20">
              <p className="font-semibold mb-4">
                Trading cryptocurrency derivatives involves substantial risk of loss and is not suitable for all investors.
              </p>
              
              <div className="space-y-4 text-sm">
                <div>
                  <div className="font-semibold mb-2">Market Risks:</div>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>• Extreme volatility can cause rapid losses</li>
                    <li>• Leverage amplifies gains and losses</li>
                    <li>• Cascades may be unpredictable</li>
                  </ul>
                </div>
                
                <div>
                  <div className="font-semibold mb-2">Technical Risks:</div>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>• Exchange downtime may prevent order management</li>
                    <li>• Software bugs or errors may occur</li>
                    <li>• Network latency may impact execution</li>
                  </ul>
                </div>

                <p className="font-semibold pt-2">
                  You are solely responsible for trading decisions. Always use paper trading first. Never trade with money you cannot afford to lose.
                </p>
              </div>
            </div>
          </section>

          {/* Footer */}
          <div className="text-center pt-8 border-t">
            <p className="font-bold text-lg mb-1">MPI™ - Max Pain Industry</p>
            <p className="text-sm text-muted-foreground italic mb-4">"Hunt the Hunters"</p>
            <p className="text-xs text-muted-foreground">Document Version 2.0 | October 2025</p>
          </div>
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
          
          h1, h2, h3, h4, h5, h6 {
            page-break-after: avoid;
            break-after: avoid;
          }
          
          table, .border {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
