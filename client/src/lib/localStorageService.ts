import type { UserSettings, Strategy } from "@shared/schema";

const STORAGE_KEYS = {
  USER_SETTINGS: 'aster_dex_user_settings',
  STRATEGIES: 'aster_dex_strategies',
} as const;

export const localStorageService = {
  // User Settings
  getUserSettings(): UserSettings | null {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER_SETTINGS);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to load user settings from localStorage:', error);
      return null;
    }
  },

  saveUserSettings(settings: Partial<UserSettings>): void {
    try {
      const current = this.getUserSettings() || {};
      const updated = { ...current, ...settings };
      localStorage.setItem(STORAGE_KEYS.USER_SETTINGS, JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save user settings to localStorage:', error);
    }
  },

  // Strategies
  getStrategies(): Strategy[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.STRATEGIES);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to load strategies from localStorage:', error);
      return [];
    }
  },

  getStrategy(id: string): Strategy | null {
    const strategies = this.getStrategies();
    return strategies.find(s => s.id === id) || null;
  },

  saveStrategy(strategy: Strategy): void {
    try {
      const strategies = this.getStrategies();
      const index = strategies.findIndex(s => s.id === strategy.id);
      
      if (index >= 0) {
        strategies[index] = strategy;
      } else {
        strategies.push(strategy);
      }
      
      localStorage.setItem(STORAGE_KEYS.STRATEGIES, JSON.stringify(strategies));
    } catch (error) {
      console.error('Failed to save strategy to localStorage:', error);
    }
  },

  updateStrategy(id: string, updates: Partial<Strategy>): Strategy | null {
    try {
      const strategies = this.getStrategies();
      const index = strategies.findIndex(s => s.id === id);
      
      if (index >= 0) {
        strategies[index] = { ...strategies[index], ...updates, updatedAt: new Date() };
        localStorage.setItem(STORAGE_KEYS.STRATEGIES, JSON.stringify(strategies));
        return strategies[index];
      }
      
      return null;
    } catch (error) {
      console.error('Failed to update strategy in localStorage:', error);
      return null;
    }
  },

  deleteStrategy(id: string): boolean {
    try {
      const strategies = this.getStrategies();
      const filtered = strategies.filter(s => s.id !== id);
      
      if (filtered.length < strategies.length) {
        localStorage.setItem(STORAGE_KEYS.STRATEGIES, JSON.stringify(filtered));
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Failed to delete strategy from localStorage:', error);
      return false;
    }
  },

  // Clear all settings (useful for testing)
  clearAll(): void {
    localStorage.removeItem(STORAGE_KEYS.USER_SETTINGS);
    localStorage.removeItem(STORAGE_KEYS.STRATEGIES);
  }
};
