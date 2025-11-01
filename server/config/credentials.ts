/**
 * Centralized credential management
 * Provides secure access to API credentials with validation
 * Prevents direct access to process.env throughout codebase
 */

class CredentialManager {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly telegramBotToken?: string;
  private readonly telegramChatId?: string;

  constructor() {
    // Support both env variable names for backward compatibility
    this.apiKey = process.env.ASTER_API_KEY || process.env.ASTER_DEX_API_KEY || '';
    this.secretKey = process.env.ASTER_SECRET_KEY || '';
    this.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    this.telegramChatId = process.env.TELEGRAM_CHAT_ID;

    // Validate required credentials
    if (!this.apiKey || !this.secretKey) {
      console.error('❌ Missing required API credentials!');
      console.error('   Set ASTER_API_KEY and ASTER_SECRET_KEY in .env file');
    }
  }

  getApiKey(): string {
    if (!this.apiKey) {
      throw new Error('ASTER_API_KEY not configured');
    }
    return this.apiKey;
  }

  getSecretKey(): string {
    if (!this.secretKey) {
      throw new Error('ASTER_SECRET_KEY not configured');
    }
    return this.secretKey;
  }

  getTelegramBotToken(): string | undefined {
    return this.telegramBotToken;
  }

  getTelegramChatId(): string | undefined {
    return this.telegramChatId;
  }

  /**
   * Check if all required credentials are configured
   */
  isConfigured(): boolean {
    return !!(this.apiKey && this.secretKey);
  }

  /**
   * Never expose secrets in logs or error messages
   */
  toString(): string {
    return '[CredentialManager - secrets redacted]';
  }

  /**
   * Prevent serialization of secrets
   */
  toJSON(): any {
    return {
      configured: this.isConfigured(),
      hasTelegram: !!(this.telegramBotToken && this.telegramChatId)
    };
  }
}

// Singleton instance
export const credentials = new CredentialManager();

// Also export class for testing
export { CredentialManager };
