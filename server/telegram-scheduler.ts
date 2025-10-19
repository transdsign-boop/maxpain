import { telegramService } from './telegram-service';
import { storage } from './storage';

class TelegramScheduler {
  private hourlyReportTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private strategyId: string | null = null;

  /**
   * Start the hourly report scheduler
   * Sends a report every hour
   */
  start(strategyId: string): void {
    if (this.isRunning) {
      console.log('⚠️ Telegram scheduler already running');
      return;
    }

    console.log('✅ Starting Telegram hourly report scheduler');
    this.isRunning = true;
    this.strategyId = strategyId;

    // Schedule next report in 1 hour
    this.scheduleNextReport();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.hourlyReportTimer) {
      clearInterval(this.hourlyReportTimer);
      this.hourlyReportTimer = null;
    }
    this.isRunning = false;
    this.strategyId = null;
    console.log('🛑 Telegram scheduler stopped');
  }

  /**
   * Send immediate report (for manual trigger)
   */
  async sendImmediateReport(strategyId: string): Promise<void> {
    console.log('📊 Sending immediate performance report...');
    await telegramService.sendDailyReport(strategyId);
  }

  /**
   * Schedule reports to run every hour
   */
  private scheduleNextReport(): void {
    const HOUR_IN_MS = 60 * 60 * 1000; // 1 hour

    console.log('⏰ Hourly performance reports scheduled (every 60 minutes)');

    // Use setInterval to run every hour
    this.hourlyReportTimer = setInterval(async () => {
      if (!this.strategyId) return;
      
      try {
        console.log('🕐 Sending scheduled hourly report...');
        await telegramService.sendDailyReport(this.strategyId);
      } catch (error) {
        console.error('❌ Failed to send scheduled hourly report:', error);
      }
    }, HOUR_IN_MS);

    // Send first report immediately
    if (this.strategyId) {
      this.sendImmediateReport(this.strategyId).catch(err => 
        console.error('❌ Failed to send initial report:', err)
      );
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): { isRunning: boolean; interval: string; strategyId: string | null } {
    return {
      isRunning: this.isRunning,
      interval: this.isRunning ? '1 hour' : 'stopped',
      strategyId: this.strategyId
    };
  }
}

// Export singleton instance
export const telegramScheduler = new TelegramScheduler();
