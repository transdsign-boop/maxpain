import { telegramService } from './telegram-service';
import { storage } from './storage';

class TelegramScheduler {
  private dailyReportTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the daily report scheduler
   * Sends a report at 00:00 UTC every day
   */
  start(strategyId: string): void {
    if (this.isRunning) {
      console.log('⚠️ Telegram scheduler already running');
      return;
    }

    console.log('✅ Starting Telegram daily report scheduler');
    this.isRunning = true;

    // Schedule next report
    this.scheduleNextReport(strategyId);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.dailyReportTimer) {
      clearTimeout(this.dailyReportTimer);
      this.dailyReportTimer = null;
    }
    this.isRunning = false;
    console.log('🛑 Telegram scheduler stopped');
  }

  /**
   * Send immediate daily report (for testing)
   */
  async sendImmediateReport(strategyId: string): Promise<void> {
    console.log('📊 Sending immediate daily report...');
    await telegramService.sendDailyReport(strategyId);
  }

  /**
   * Schedule the next report at midnight UTC
   */
  private scheduleNextReport(strategyId: string): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0); // Midnight UTC

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    console.log(`📅 Next daily report scheduled in ${(msUntilMidnight / 1000 / 60 / 60).toFixed(2)} hours`);

    this.dailyReportTimer = setTimeout(async () => {
      try {
        console.log('🕛 Sending scheduled daily report...');
        await telegramService.sendDailyReport(strategyId);
        
        // Schedule next report after this one completes
        this.scheduleNextReport(strategyId);
      } catch (error) {
        console.error('❌ Failed to send scheduled daily report:', error);
        // Still schedule next report even if this one failed
        this.scheduleNextReport(strategyId);
      }
    }, msUntilMidnight);
  }

  /**
   * Get scheduler status
   */
  getStatus(): { isRunning: boolean; nextReport: Date | null } {
    const nextReport = this.dailyReportTimer ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;
    return {
      isRunning: this.isRunning,
      nextReport
    };
  }
}

// Export singleton instance
export const telegramScheduler = new TelegramScheduler();
