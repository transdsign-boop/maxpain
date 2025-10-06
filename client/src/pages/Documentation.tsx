import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, TrendingDown, TrendingUp, Shield, Zap, Target, Activity, Brain, AlertTriangle, DollarSign, BarChart3, Settings } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function Documentation() {
  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header - No Print */}
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-md print:hidden">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="font-bold text-lg">MPI™</span>
                <Badge variant="outline" className="bg-lime-500/10 text-lime-500 border-lime-500/20">
                  LIQUIDATION HUNTER
                </Badge>
              </div>
            </div>
          </div>
          <Button 
            variant="default" 
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
      <main className="max-w-5xl mx-auto px-6 py-8">
        <article className="prose prose-slate dark:prose-invert max-w-none">
          {/* Title Section */}
          <div className="mb-8 text-center print:mb-6">
            <h1 className="text-5xl font-bold mb-3 print:text-4xl">
              <span className="bg-gradient-to-r from-lime-500 to-emerald-500 text-transparent bg-clip-text">
                MPI™
              </span>{" "}
              Liquidation Hunter Bot
            </h1>
            <p className="text-xl text-muted-foreground mb-2">Professional Trading Documentation</p>
            <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
              <span>Version 2.0</span>
              <span>•</span>
              <span>Max Pain Industry™</span>
              <span>•</span>
              <span>October 2025</span>
            </div>
          </div>

          <hr className="my-8" />

          {/* Executive Summary */}
          <section className="mb-8">
            <h2 className="text-3xl font-bold mb-4 flex items-center gap-2">
              <Target className="h-7 w-7 text-lime-500" />
              Executive Summary
            </h2>
            <p className="mb-4 text-lg">
              The <strong className="text-lime-500">MPI™ Liquidation Hunter Bot</strong> is a sophisticated algorithmic trading system designed to capitalize on liquidation events in cryptocurrency futures markets. By detecting and counter-trading forced liquidations on the Aster DEX exchange, the bot exploits temporary price dislocations to generate consistent returns with advanced risk management.
            </p>
            
            {/* Key Highlights Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
              <Card className="border-lime-500/20 bg-lime-500/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Activity className="h-5 w-5 text-lime-500 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold mb-1">Real-Time Detection</h3>
                      <p className="text-sm text-muted-foreground">Live liquidation streaming with cascade risk analysis</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="border-lime-500/20 bg-lime-500/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <DollarSign className="h-5 w-5 text-lime-500 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold mb-1">Advanced DCA System</h3>
                      <p className="text-sm text-muted-foreground">Volatility-based position sizing with exponential growth</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="border-lime-500/20 bg-lime-500/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-lime-500 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold mb-1">Risk Management</h3>
                      <p className="text-sm text-muted-foreground">Multi-layer protection with portfolio-level controls</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="border-lime-500/20 bg-lime-500/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <BarChart3 className="h-5 w-5 text-lime-500 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold mb-1">Performance Analytics</h3>
                      <p className="text-sm text-muted-foreground">Complete trade tracking with historical data retention</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          <hr className="my-8" />

          {/* What is Liquidation Hunting */}
          <section id="liquidation-hunting" className="mb-8 scroll-mt-20">
            <h2 className="text-3xl font-bold mb-4 flex items-center gap-2">
              <TrendingDown className="h-7 w-7 text-lime-500" />
              What is Liquidation Hunting?
            </h2>
            
            <h3 className="text-xl font-semibold mb-3">The Opportunity</h3>
            <p className="mb-4">
              When leveraged traders get liquidated, their positions are forcefully closed at market price, creating temporary price dislocations. These events often cause:
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card>
                <CardContent className="p-4">
                  <div className="text-center">
                    <TrendingDown className="h-8 w-8 text-orange-500 mx-auto mb-2" />
                    <h4 className="font-semibold mb-1">Oversold Conditions</h4>
                    <p className="text-sm text-muted-foreground">Forced selling creates price extremes</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4">
                  <div className="text-center">
                    <Activity className="h-8 w-8 text-red-500 mx-auto mb-2" />
                    <h4 className="font-semibold mb-1">Cascades</h4>
                    <p className="text-sm text-muted-foreground">One liquidation triggers others</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4">
                  <div className="text-center">
                    <TrendingUp className="h-8 w-8 text-lime-500 mx-auto mb-2" />
                    <h4 className="font-semibold mb-1">Mean Reversion</h4>
                    <p className="text-sm text-muted-foreground">Prices revert after pressure subsides</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <h3 className="text-xl font-semibold mb-3">Our Approach</h3>
            <Card className="border-lime-500/30 bg-lime-500/5 mb-4">
              <CardContent className="p-6">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30 mt-1">1</Badge>
                    <p><strong>Monitor</strong> real-time liquidation streams from Aster DEX</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30 mt-1">2</Badge>
                    <p><strong>Analyze</strong> cascade risk and market microstructure</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30 mt-1">3</Badge>
                    <p><strong>Identify</strong> high-quality reversal opportunities</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30 mt-1">4</Badge>
                    <p><strong>Execute</strong> counter-trend positions with precision</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30 mt-1">5</Badge>
                    <p><strong>Manage</strong> risk through dynamic DCA and protective stops</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="border-lime-500/30">
              <CardContent className="p-6">
                <h4 className="font-semibold mb-3 text-center">Counter-Trading Strategy</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-lime-500/10 border border-lime-500/20">
                    <TrendingUp className="h-6 w-6 text-lime-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm"><strong>Long Liquidations</strong></p>
                      <p className="text-xs text-muted-foreground">Selling pressure → We go <span className="text-lime-500 font-semibold">LONG</span></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                    <TrendingDown className="h-6 w-6 text-orange-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm"><strong>Short Liquidations</strong></p>
                      <p className="text-xs text-muted-foreground">Buying pressure → We go <span className="text-orange-500 font-semibold">SHORT</span></p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <hr className="my-8" />

          {/* Core Features */}
          <section id="core-features" className="mb-8 scroll-mt-20">
            <h2 className="text-3xl font-bold mb-4 flex items-center gap-2">
              <Zap className="h-7 w-7 text-lime-500" />
              Core Features
            </h2>

            <div className="space-y-6">
              {/* Real-Time Detection */}
              <Card className="border-lime-500/20">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Activity className="h-8 w-8 text-lime-500 flex-shrink-0 mt-1" />
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold mb-3">Real-Time Liquidation Detection</h3>
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-semibold text-sm mb-2">Intelligent Signal Processing:</h4>
                          <ul className="space-y-1 text-sm text-muted-foreground">
                            <li>• WebSocket connection with sub-second latency</li>
                            <li>• Configurable percentile thresholds (1st-99th)</li>
                            <li>• 18+ crypto pair monitoring</li>
                            <li>• Lookback window analysis (1-24 hours)</li>
                          </ul>
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm mb-2">Cascade Risk Analysis:</h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                            <Badge variant="outline" className="justify-center">LQ Score</Badge>
                            <Badge variant="outline" className="justify-center">RET Score</Badge>
                            <Badge variant="outline" className="justify-center">OI Delta</Badge>
                            <Badge variant="outline" className="justify-center">Quality Tier</Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* DCA System */}
              <Card className="border-lime-500/20">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <DollarSign className="h-8 w-8 text-lime-500 flex-shrink-0 mt-1" />
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold mb-3">Advanced DCA System</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-muted/50">
                          <h4 className="font-semibold text-sm mb-2">Volatility Scaling</h4>
                          <code className="text-xs block mb-2 font-mono">c<sub>k</sub> = Δ₁ × k<sup>p</sup> × max(1, ATR/V<sub>ref</sub>)</code>
                          <p className="text-xs text-muted-foreground">Dynamic step distances based on market conditions</p>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <h4 className="font-semibold text-sm mb-2">Size Growth</h4>
                          <code className="text-xs block mb-2 font-mono">w<sub>k</sub> = g<sup>(k-1)</sup></code>
                          <p className="text-xs text-muted-foreground">Exponential position sizing (e.g., 1.8x per layer)</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Risk Management */}
              <Card className="border-lime-500/20">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Shield className="h-8 w-8 text-lime-500 flex-shrink-0 mt-1" />
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold mb-3">Portfolio Risk Management</h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="p-3 rounded-lg bg-muted/30 text-center">
                          <p className="text-xs text-muted-foreground mb-1">Max Positions</p>
                          <p className="font-semibold">0-20</p>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/30 text-center">
                          <p className="text-xs text-muted-foreground mb-1">Portfolio Risk</p>
                          <p className="font-semibold">1-100%</p>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/30 text-center">
                          <p className="text-xs text-muted-foreground mb-1">Leverage</p>
                          <p className="font-semibold">1-125x</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Order Execution */}
              <Card className="border-lime-500/20">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Zap className="h-8 w-8 text-lime-500 flex-shrink-0 mt-1" />
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold mb-3">Smart Order Execution</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                          <Badge variant="outline" className="bg-lime-500/10 text-lime-500 border-lime-500/20">Price Chase</Badge>
                          <p className="text-xs">Auto-adjusts during rapid moves</p>
                        </div>
                        <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                          <Badge variant="outline" className="bg-lime-500/10 text-lime-500 border-lime-500/20">Delay</Badge>
                          <p className="text-xs">Configurable 100ms-30s wait</p>
                        </div>
                        <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                          <Badge variant="outline" className="bg-lime-500/10 text-lime-500 border-lime-500/20">Slippage</Badge>
                          <p className="text-xs">Max deviation 0.1-5%</p>
                        </div>
                        <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                          <Badge variant="outline" className="bg-lime-500/10 text-lime-500 border-lime-500/20">Retry</Badge>
                          <p className="text-xs">Duration 5s-5min</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          <hr className="my-8" />

          {/* Risk Management */}
          <section id="risk-management" className="mb-8 scroll-mt-20">
            <h2 className="text-3xl font-bold mb-4 flex items-center gap-2">
              <Shield className="h-7 w-7 text-lime-500" />
              Risk Management System
            </h2>

            <Card className="border-red-500/30 bg-red-500/5 mb-6">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-red-500 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-2">Cascade Detection Auto-Block</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-center">
                        <Badge variant="outline" className="bg-red-500/20 text-red-500 border-red-500/30 mb-1">Red</Badge>
                        <p className="text-xs">Score ≥6: Blocked</p>
                      </div>
                      <div className="p-2 rounded bg-orange-500/10 border border-orange-500/20 text-center">
                        <Badge variant="outline" className="bg-orange-500/20 text-orange-500 border-orange-500/30 mb-1">Orange</Badge>
                        <p className="text-xs">Score ≥4: High Risk</p>
                      </div>
                      <div className="p-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-center">
                        <Badge variant="outline" className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 mb-1">Yellow</Badge>
                        <p className="text-xs">Score ≥2: Caution</p>
                      </div>
                      <div className="p-2 rounded bg-lime-500/10 border border-lime-500/20 text-center">
                        <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30 mb-1">Green</Badge>
                        <p className="text-xs">Score &lt;2: Normal</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-3">Position-Level Controls</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• Max risk per trade (% of account)</li>
                    <li>• Position size limits (notional value)</li>
                    <li>• Leverage limits with warnings</li>
                    <li>• Dynamic stop loss protection</li>
                  </ul>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-3">Portfolio-Level Controls</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• Max total exposure (% of account)</li>
                    <li>• Max positions per symbol</li>
                    <li>• Symbol concentration limits</li>
                    <li>• Real-time P&L monitoring</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </section>

          <hr className="my-8" />

          {/* Getting Started */}
          <section id="getting-started" className="mb-8 scroll-mt-20">
            <h2 className="text-3xl font-bold mb-4 flex items-center gap-2">
              <Settings className="h-7 w-7 text-lime-500" />
              Getting Started
            </h2>

            <div className="space-y-6">
              <Card className="border-lime-500/20">
                <CardContent className="p-6">
                  <h3 className="text-xl font-semibold mb-4">Step 1: Initial Setup</h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30 mt-1">1</Badge>
                      <p className="text-sm">Create Aster DEX account with API access</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30 mt-1">2</Badge>
                      <p className="text-sm">Navigate to Settings → API Connection</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30 mt-1">3</Badge>
                      <p className="text-sm">Enter API credentials and test connection</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-blue-500/30 bg-blue-500/5">
                <CardContent className="p-6">
                  <h3 className="text-xl font-semibold mb-4">Step 2: Paper Trading (Recommended)</h3>
                  <p className="text-sm mb-4">Test strategies risk-free with simulated funds</p>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>• Configure desired parameters</p>
                    <p>• Set Trading Mode = Paper</p>
                    <p>• Activate strategy and monitor performance</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-red-500/30 bg-red-500/5">
                <CardContent className="p-6">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-6 w-6 text-red-500 flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="text-xl font-semibold mb-4">Step 3: Live Trading Checklist</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30">✓</Badge>
                          <span>Tested strategy in paper mode</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30">✓</Badge>
                          <span>Reviewed risk parameters</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30">✓</Badge>
                          <span>Set appropriate position limits</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-lime-500/20 text-lime-500 border-lime-500/30">✓</Badge>
                          <span>Verified sufficient account balance</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          <hr className="my-8" />

          {/* Technical Stack */}
          <section id="technical-stack" className="mb-8 scroll-mt-20">
            <h2 className="text-3xl font-bold mb-4 flex items-center gap-2">
              <Brain className="h-7 w-7 text-lime-500" />
              Technical Architecture
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="font-semibold mb-1">Frontend</p>
                  <p className="text-xs text-muted-foreground">React + TypeScript</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="font-semibold mb-1">Backend</p>
                  <p className="text-xs text-muted-foreground">Node.js + Express</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="font-semibold mb-1">Database</p>
                  <p className="text-xs text-muted-foreground">Neon PostgreSQL</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="font-semibold mb-1">UI Framework</p>
                  <p className="text-xs text-muted-foreground">Radix + Tailwind</p>
                </CardContent>
              </Card>
            </div>

            <Card className="border-lime-500/20">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Core Services</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/30">
                    <p className="font-semibold text-sm mb-1">Strategy Engine</p>
                    <p className="text-xs text-muted-foreground">Core trading logic & signal processing</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <p className="font-semibold text-sm mb-1">Cascade Detector</p>
                    <p className="text-xs text-muted-foreground">Real-time liquidation analysis</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <p className="font-semibold text-sm mb-1">DCA Calculator</p>
                    <p className="text-xs text-muted-foreground">Mathematical position sizing</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30">
                    <p className="font-semibold text-sm mb-1">Order Protection</p>
                    <p className="text-xs text-muted-foreground">TP/SL management & cleanup</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <hr className="my-8" />

          {/* Disclaimer */}
          <section className="mb-8">
            <h2 className="text-3xl font-bold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-7 w-7 text-red-500" />
              Risk Disclaimer
            </h2>
            <Card className="border-red-500/30 bg-red-500/5">
              <CardContent className="p-6">
                <div className="space-y-4 text-sm">
                  <p>
                    <strong>Trading cryptocurrency derivatives involves substantial risk of loss and is not suitable for all investors.</strong> Past performance is not indicative of future results. The MPI™ Liquidation Hunter Bot is an algorithmic trading tool and does not guarantee profits.
                  </p>
                  <div>
                    <p className="font-semibold mb-2">Key Risks:</p>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• Market volatility can cause rapid losses</li>
                      <li>• Leverage amplifies both gains and losses</li>
                      <li>• Liquidation cascades can be unpredictable</li>
                      <li>• Exchange downtime may prevent order management</li>
                      <li>• Software bugs or errors may occur</li>
                    </ul>
                  </div>
                  <p>
                    <strong>You are solely responsible for your trading decisions.</strong> Always use paper trading first. Never trade with money you cannot afford to lose.
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>

          <hr className="my-8" />

          {/* Conclusion */}
          <section className="mb-8">
            <Card className="border-lime-500/30 bg-gradient-to-br from-lime-500/10 to-emerald-500/10">
              <CardContent className="p-8 text-center">
                <h2 className="text-3xl font-bold mb-4">
                  <span className="bg-gradient-to-r from-lime-500 to-emerald-500 text-transparent bg-clip-text">
                    MPI™
                  </span>
                </h2>
                <p className="text-xl font-semibold mb-2">Max Pain Industry</p>
                <p className="text-muted-foreground italic">"Hunt the Hunters"</p>
                <div className="mt-6 text-sm text-muted-foreground">
                  Document Version 2.0 | October 2025
                </div>
              </CardContent>
            </Card>
          </section>
        </article>
      </main>

      {/* Print Styles */}
      <style>{`
        @media print {
          @page {
            margin: 1.5cm;
            size: A4;
          }
          
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          
          .print\\:hidden {
            display: none !important;
          }
          
          .print\\:mb-6 {
            margin-bottom: 1.5rem;
          }
          
          .print\\:text-4xl {
            font-size: 2.25rem;
          }
          
          /* Ensure cards print with borders */
          [class*="border"] {
            border: 1px solid #e5e7eb !important;
          }
          
          /* Prevent page breaks inside cards */
          [class*="Card"] {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          h2, h3 {
            page-break-after: avoid;
            break-after: avoid;
          }
          
          /* Ensure backgrounds print */
          [class*="bg-"] {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}
