import TelegramBot from 'node-telegram-bot-api';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { Chart, registerables } from 'chart.js';
import type { Position, Fill } from '@shared/schema';
import { storage } from './storage';

// Register Chart.js components before creating chart renderer
Chart.register(...registerables);

class TelegramService {
  private bot: TelegramBot | null = null;
  private chatId: string | null = null;
  private chartRenderer: ChartJSNodeCanvas;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (token && chatId) {
      try {
        this.bot = new TelegramBot(token, { polling: false });
        this.chatId = chatId;
        console.log('✅ Telegram service initialized');
      } catch (error) {
        console.error('❌ Failed to initialize Telegram bot:', error);
      }
    } else {
      console.warn('⚠️ Telegram credentials not found. Alerts disabled.');
    }

    // Initialize chart renderer (800x400px canvas)
    this.chartRenderer = new ChartJSNodeCanvas({ 
      width: 800, 
      height: 400,
      backgroundColour: '#1a1a1a'
    });
  }

  /**
   * Send position opened alert
   */
  async sendPositionOpenedAlert(position: Position, fills: Fill[]): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      const totalCost = fills.reduce((sum, f) => sum + (parseFloat(f.price) * parseFloat(f.quantity)), 0);
      const avgPrice = totalCost / parseFloat(position.totalQuantity);
      const totalQty = parseFloat(position.totalQuantity);

      const message = `
🟢 <b>POSITION OPENED</b>

<b>Symbol:</b> ${position.symbol}
<b>Side:</b> ${position.side.toUpperCase()}
<b>Entry Price:</b> $${avgPrice.toFixed(6)}
<b>Quantity:</b> ${totalQty.toLocaleString()}
<b>Position Size:</b> $${totalCost.toFixed(2)}
<b>Leverage:</b> ${position.leverage}x

<b>Layers Filled:</b> ${position.layersFilled} / ${position.layersPlaced}
<b>Time:</b> ${new Date().toLocaleString()}
      `.trim();

      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      console.log(`📤 Sent Telegram alert: Position opened ${position.symbol} ${position.side}`);
    } catch (error) {
      console.error('❌ Failed to send position opened alert:', error);
    }
  }

  /**
   * Send position closed alert
   */
  async sendPositionClosedAlert(position: Position, realizedPnl: number, fills: Fill[]): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      const avgEntry = parseFloat(position.avgEntryPrice || '0');
      const totalQty = parseFloat(position.totalQuantity);
      const exitPrice = fills.length > 0 ? parseFloat(fills[fills.length - 1].price) : 0;
      const positionValue = avgEntry * totalQty;
      const roi = positionValue > 0 ? (realizedPnl / positionValue) * 100 : 0;
      const isProfitable = realizedPnl >= 0;
      
      const emoji = isProfitable ? '🟢' : '🔴';
      const pnlSign = realizedPnl >= 0 ? '+' : '';

      const message = `
${emoji} <b>POSITION CLOSED</b>

<b>Symbol:</b> ${position.symbol}
<b>Side:</b> ${position.side.toUpperCase()}
<b>Entry Price:</b> $${avgEntry.toFixed(6)}
<b>Exit Price:</b> $${exitPrice.toFixed(6)}
<b>Quantity:</b> ${totalQty.toLocaleString()}

<b>Realized P&L:</b> ${pnlSign}$${realizedPnl.toFixed(2)} (${pnlSign}${roi.toFixed(2)}%)
<b>Position Size:</b> $${positionValue.toFixed(2)}
<b>Leverage:</b> ${position.leverage}x

<b>Layers Filled:</b> ${position.layersFilled}
<b>Time:</b> ${new Date().toLocaleString()}
      `.trim();

      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      console.log(`📤 Sent Telegram alert: Position closed ${position.symbol} ${position.side} P&L: $${realizedPnl.toFixed(2)}`);
    } catch (error) {
      console.error('❌ Failed to send position closed alert:', error);
    }
  }

  /**
   * Send DCA layer filled alert
   */
  async sendLayerFilledAlert(position: Position, layerNumber: number, fillPrice: number, fillQty: number): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      const message = `
🔵 <b>DCA LAYER FILLED</b>

<b>Symbol:</b> ${position.symbol}
<b>Side:</b> ${position.side.toUpperCase()}
<b>Layer:</b> ${layerNumber} / ${position.layersPlaced}
<b>Fill Price:</b> $${fillPrice.toFixed(6)}
<b>Quantity:</b> ${fillQty.toLocaleString()}
<b>Layers Filled:</b> ${position.layersFilled} / ${position.layersPlaced}

<b>Time:</b> ${new Date().toLocaleString()}
      `.trim();

      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      console.log(`📤 Sent Telegram alert: Layer ${layerNumber} filled for ${position.symbol}`);
    } catch (error) {
      console.error('❌ Failed to send layer filled alert:', error);
    }
  }

  /**
   * Generate portfolio risk chart as PNG buffer
   */
  private async generatePortfolioRiskChart(data: { label: string; value: number; color: string }[]): Promise<Buffer> {
    const configuration = {
      type: 'doughnut' as const,
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.value),
          backgroundColor: data.map(d => d.color),
          borderColor: '#1a1a1a',
          borderWidth: 2
        }]
      },
      options: {
        plugins: {
          legend: {
            position: 'right' as const,
            labels: {
              color: '#ffffff',
              font: { size: 14 }
            }
          },
          title: {
            display: true,
            text: 'Portfolio Risk Allocation',
            color: '#ffffff',
            font: { size: 18, weight: 'bold' as const }
          }
        }
      }
    };

    return await this.chartRenderer.renderToBuffer(configuration);
  }

  /**
   * Generate P&L chart as PNG buffer
   */
  private async generatePnLChart(pnlHistory: { date: string; pnl: number }[]): Promise<Buffer> {
    const configuration = {
      type: 'line' as const,
      data: {
        labels: pnlHistory.map(d => d.date),
        datasets: [{
          label: 'Cumulative P&L ($)',
          data: pnlHistory.map(d => d.pnl),
          borderColor: '#84cc16',
          backgroundColor: 'rgba(132, 204, 22, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        plugins: {
          legend: {
            labels: {
              color: '#ffffff',
              font: { size: 14 }
            }
          },
          title: {
            display: true,
            text: '24h P&L Performance',
            color: '#ffffff',
            font: { size: 18, weight: 'bold' as const }
          }
        },
        scales: {
          x: {
            ticks: { color: '#ffffff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
          },
          y: {
            ticks: { 
              color: '#ffffff',
              callback: (value: any) => '$' + value.toFixed(2)
            },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
          }
        }
      }
    };

    return await this.chartRenderer.renderToBuffer(configuration);
  }

  /**
   * Send daily performance report
   */
  async sendDailyReport(strategyId: string): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      console.log('📊 Generating daily Telegram report...');

      // Fetch strategy and session data
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        console.error('❌ Strategy not found for daily report');
        return;
      }

      const sessions = await storage.getSessionsByStrategy(strategyId);
      const activeSession = sessions.find((s: any) => s.status === 'active');
      if (!activeSession) {
        console.warn('⚠️ No active session found for daily report');
        return;
      }

      // Fetch open positions for portfolio risk
      const allPositions = await storage.getPositionsBySession(activeSession.id);
      const openPositions = allPositions.filter((p: any) => p.isOpen);
      
      // Calculate portfolio risk allocation
      let filledRiskTotal = 0;
      let reservedRiskTotal = 0;
      const riskBySymbol: Map<string, { filled: number; reserved: number }> = new Map();

      for (const pos of openPositions) {
        // Calculate filled risk from actual position cost
        const filledRisk = parseFloat(pos.totalCost || '0');
        const reservedRisk = parseFloat(pos.reservedRiskDollars || '0');
        
        filledRiskTotal += filledRisk;
        reservedRiskTotal += reservedRisk;

        const existing = riskBySymbol.get(pos.symbol) || { filled: 0, reserved: 0 };
        riskBySymbol.set(pos.symbol, {
          filled: existing.filled + filledRisk,
          reserved: existing.reserved + reservedRisk
        });
      }

      // Fetch closed positions from last 24h
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const closedPositions = allPositions.filter((p: any) => !p.isOpen);
      const recentClosed = closedPositions.filter((p: any) => p.closedAt && new Date(p.closedAt) >= oneDayAgo);

      // Calculate 24h P&L
      let totalPnl24h = 0;
      let winningTrades = 0;
      let losingTrades = 0;

      for (const pos of recentClosed) {
        const pnl = parseFloat(pos.realizedPnl || '0');
        totalPnl24h += pnl;
        if (pnl > 0) winningTrades++;
        if (pnl < 0) losingTrades++;
      }

      const winRate = recentClosed.length > 0 ? (winningTrades / recentClosed.length) * 100 : 0;

      // Fetch account balance for risk percentage calculation
      const balance = parseFloat(activeSession.currentBalance || '0');
      const totalRisk = filledRiskTotal + reservedRiskTotal;
      
      // Generate portfolio risk chart (as percentage of account balance)
      const riskChartData = Array.from(riskBySymbol.entries()).map(([symbol, risk]) => ({
        label: symbol,
        value: balance > 0 ? ((risk.filled + risk.reserved) / balance) * 100 : 0,
        color: `hsl(${Math.random() * 360}, 70%, 50%)`
      }));

      // Add available balance to chart (percentage)
      const riskPercent = balance > 0 ? (totalRisk / balance) * 100 : 0;
      const availablePercent = Math.max(0, 100 - riskPercent);
      
      if (availablePercent > 0) {
        riskChartData.push({
          label: 'Available',
          value: availablePercent,
          color: '#666666'
        });
      }

      // Generate P&L history (simplified - hourly buckets)
      const pnlHistory: { date: string; pnl: number }[] = [];
      let cumulativePnl = 0;
      
      for (let i = 23; i >= 0; i--) {
        const hourDate = new Date(Date.now() - i * 60 * 60 * 1000);
        const hourPositions = recentClosed.filter((p: any) => 
          p.closedAt && new Date(p.closedAt) <= hourDate
        );
        cumulativePnl = hourPositions.reduce((sum: number, p: any) => sum + parseFloat(p.realizedPnl || '0'), 0);
        
        pnlHistory.push({
          date: hourDate.getHours() + ':00',
          pnl: cumulativePnl
        });
      }

      // Generate charts
      const [riskChart, pnlChart] = await Promise.all([
        this.generatePortfolioRiskChart(riskChartData),
        this.generatePnLChart(pnlHistory)
      ]);

      // Send performance message
      const pnlSign = totalPnl24h >= 0 ? '+' : '';
      const pnlEmoji = totalPnl24h >= 0 ? '🟢' : '🔴';

      const message = `
📊 <b>DAILY PERFORMANCE REPORT</b>
📅 ${new Date().toLocaleDateString()}

${pnlEmoji} <b>24h P&L:</b> ${pnlSign}$${totalPnl24h.toFixed(2)}

<b>📈 Trading Activity:</b>
• Total Trades: ${recentClosed.length}
• Winning: ${winningTrades} (${winRate.toFixed(1)}%)
• Losing: ${losingTrades}

<b>💼 Portfolio Status:</b>
• Open Positions: ${openPositions.length}
• Filled Risk: $${filledRiskTotal.toFixed(2)}
• Reserved Risk: $${reservedRiskTotal.toFixed(2)}
• Total Risk: $${totalRisk.toFixed(2)}

<b>Strategy:</b> ${strategy.name || 'Default'}
<b>Session ID:</b> ${activeSession.id.slice(0, 8)}...
      `.trim();

      // Send message with charts
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      await this.bot.sendPhoto(this.chatId, riskChart, { caption: 'Portfolio Risk Allocation' });
      await this.bot.sendPhoto(this.chatId, pnlChart, { caption: '24h P&L Performance' });

      console.log('✅ Daily Telegram report sent successfully');
    } catch (error) {
      console.error('❌ Failed to send daily report:', error);
    }
  }

  /**
   * Test connection by sending a simple message
   */
  async sendTestMessage(): Promise<boolean> {
    if (!this.bot || !this.chatId) {
      console.error('❌ Telegram not configured');
      return false;
    }

    try {
      await this.bot.sendMessage(this.chatId, '✅ Telegram bot connected successfully!');
      console.log('✅ Test message sent');
      return true;
    } catch (error) {
      console.error('❌ Failed to send test message:', error);
      return false;
    }
  }

  /**
   * Send market condition change alert
   */
  async sendMarketConditionAlert(changes: { symbol: string; oldCondition: string; newCondition: string; reason: string }[]): Promise<void> {
    if (!this.bot || !this.chatId || changes.length === 0) return;

    try {
      const changesList = changes.map(c => 
        `• <b>${c.symbol}:</b> ${c.oldCondition} → ${c.newCondition}\n  <i>${c.reason}</i>`
      ).join('\n\n');

      const message = `
🌍 <b>MARKET CONDITION CHANGE</b>

${changesList}

<b>Time:</b> ${new Date().toLocaleString()}
      `.trim();

      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      console.log(`📤 Sent market condition alert for ${changes.length} symbols`);
    } catch (error) {
      console.error('❌ Failed to send market condition alert:', error);
    }
  }

  /**
   * Send risk level warning alert
   */
  async sendRiskLevelWarning(portfolioRisk: number, threshold: number, filledRisk: number, reservedRisk: number, accountBalance: number): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      const riskPct = (portfolioRisk / accountBalance) * 100;
      const emoji = riskPct >= 90 ? '🔴' : riskPct >= 80 ? '🟠' : '🟡';

      const message = `
${emoji} <b>RISK LEVEL WARNING</b>

<b>Total Portfolio Risk:</b> ${riskPct.toFixed(1)}% (${emoji} Threshold: ${threshold}%)

<b>Risk Breakdown:</b>
• Filled Risk: $${filledRisk.toFixed(2)}
• Reserved Risk: $${reservedRisk.toFixed(2)}
• Total Risk: $${portfolioRisk.toFixed(2)}

<b>Account Balance:</b> $${accountBalance.toFixed(2)}

⚠️ <b>Action Required:</b> Consider closing positions or reducing exposure

<b>Time:</b> ${new Date().toLocaleString()}
      `.trim();

      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      console.log(`📤 Sent risk level warning: ${riskPct.toFixed(1)}%`);
    } catch (error) {
      console.error('❌ Failed to send risk level warning:', error);
    }
  }

  /**
   * Send cascade detector alert for high-quality setups
   */
  async sendCascadeDetectorAlert(symbol: string, score: number, reversalQuality: number, liquidationQuality: number, reason: string): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      const scoreEmoji = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🟠';

      const message = `
${scoreEmoji} <b>HIGH-QUALITY SETUP DETECTED</b>

<b>Symbol:</b> ${symbol}
<b>Cascade Score:</b> ${score}/100

<b>Quality Metrics:</b>
• Reversal Quality: ${reversalQuality}/10
• Liquidation Quality: ${liquidationQuality}/10

<b>Reason:</b>
${reason}

<b>Time:</b> ${new Date().toLocaleString()}
      `.trim();

      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      console.log(`📤 Sent cascade detector alert for ${symbol} (score: ${score})`);
    } catch (error) {
      console.error('❌ Failed to send cascade detector alert:', error);
    }
  }

  /**
   * Send system health alert
   */
  async sendSystemHealthAlert(type: 'error' | 'warning' | 'reconnect' | 'pause', message: string, details?: string): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      const emojiMap = {
        error: '🔴',
        warning: '🟡',
        reconnect: '🔄',
        pause: '⏸️'
      };

      const titleMap = {
        error: 'SYSTEM ERROR',
        warning: 'SYSTEM WARNING',
        reconnect: 'CONNECTION RESTORED',
        pause: 'TRADING PAUSED'
      };

      const emoji = emojiMap[type];
      const title = titleMap[type];

      const alertMessage = `
${emoji} <b>${title}</b>

<b>Message:</b> ${message}
${details ? `\n<b>Details:</b>\n${details}` : ''}

<b>Time:</b> ${new Date().toLocaleString()}
      `.trim();

      await this.bot.sendMessage(this.chatId, alertMessage, { parse_mode: 'HTML' });
      console.log(`📤 Sent system health alert: ${type} - ${message}`);
    } catch (error) {
      console.error('❌ Failed to send system health alert:', error);
    }
  }
}

// Export singleton instance
export const telegramService = new TelegramService();
