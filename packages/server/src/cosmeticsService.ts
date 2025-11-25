import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CosmeticsConfig, CosmeticItem } from './types.js';
import { User, IUser } from './models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CosmeticsService {
  private cosmetics: CosmeticsConfig | null = null;
  private cosmeticsPath: string;

  constructor() {
    // Path to cosmetics.json in server root
    this.cosmeticsPath = path.join(__dirname, '../cosmetics.json');
  }

  /**
   * Load cosmetics config from JSON file
   */
  async loadCosmetics(): Promise<void> {
    try {
      const data = await fs.readFile(this.cosmeticsPath, 'utf-8');
      this.cosmetics = JSON.parse(data);
      console.log(`✅ Loaded ${this.getAllCosmetics().length} cosmetics from config`);
    } catch (error) {
      console.error('❌ Failed to load cosmetics config:', error);
      // Initialize with empty config
      this.cosmetics = {
        trails: [],
        headItems: [],
        nameStyles: [],
      };
    }
  }

  /**
   * Get all cosmetics as a flat array
   */
  getAllCosmetics(): CosmeticItem[] {
    if (!this.cosmetics) return [];
    return [
      ...this.cosmetics.trails,
      ...this.cosmetics.headItems,
      ...this.cosmetics.nameStyles,
    ];
  }

  /**
   * Get cosmetics config (for sending to client)
   */
  getCosmetics(): CosmeticsConfig {
    if (!this.cosmetics) {
      return {
        trails: [],
        headItems: [],
        nameStyles: [],
      };
    }
    return this.cosmetics;
  }

  /**
   * Get a specific cosmetic by ID
   */
  getCosmeticById(id: string): CosmeticItem | null {
    const all = this.getAllCosmetics();
    return all.find(c => c.id === id) || null;
  }

  /**
   * Purchase a cosmetic for a user
   */
  async purchaseCosmetic(walletAddress: string, cosmeticId: string): Promise<{
    success: boolean;
    error?: string;
    newBalance?: number;
    unlockedCosmetics?: string[];
  }> {
    try {
      // Find cosmetic
      const cosmetic = this.getCosmeticById(cosmeticId);
      if (!cosmetic) {
        return { success: false, error: 'invalid_cosmetic' };
      }

      // Find user
      const user = await (User as any).findOne({ walletAddress });
      if (!user) {
        return { success: false, error: 'user_not_found' };
      }

      // Check if already owned
      if (user.unlockedCosmetics.includes(cosmeticId)) {
        return { success: false, error: 'already_owned' };
      }

      // Check if user has enough apples
      if (user.apples < cosmetic.cost) {
        return { success: false, error: 'insufficient_balance' };
      }

      // Deduct apples and add cosmetic (atomic operation)
      user.apples -= cosmetic.cost;
      user.unlockedCosmetics.push(cosmeticId);
      await user.save();

      console.log(`🍎 ${user.username} purchased ${cosmetic.name} for ${cosmetic.cost} apples`);

      return {
        success: true,
        newBalance: user.apples,
        unlockedCosmetics: user.unlockedCosmetics,
      };
    } catch (error) {
      console.error('❌ Failed to purchase cosmetic:', error);
      return { success: false, error: 'server_error' };
    }
  }

  /**
   * Equip a cosmetic to a slot
   */
  async equipCosmetic(walletAddress: string, cosmeticId: string, slot: 'trail' | 'headItem' | 'nameStyle'): Promise<{
    success: boolean;
    error?: string;
    equippedCosmetics?: any;
  }> {
    try {
      // Find cosmetic
      const cosmetic = this.getCosmeticById(cosmeticId);
      if (!cosmetic) {
        return { success: false, error: 'invalid_cosmetic' };
      }

      // Validate slot matches category
      if (cosmetic.category !== slot) {
        return { success: false, error: 'invalid_slot' };
      }

      // Find user
      const user = await (User as any).findOne({ walletAddress });
      if (!user) {
        return { success: false, error: 'user_not_found' };
      }

      // Check if user owns the cosmetic
      if (!user.unlockedCosmetics.includes(cosmeticId)) {
        return { success: false, error: 'not_owned' };
      }

      // Equip cosmetic to slot
      if (!user.equippedCosmetics) {
        user.equippedCosmetics = {};
      }
      user.equippedCosmetics[slot] = cosmeticId;
      await user.save();

      console.log(`✨ ${user.username} equipped ${cosmetic.name} to ${slot}`);

      return {
        success: true,
        equippedCosmetics: user.equippedCosmetics,
      };
    } catch (error) {
      console.error('❌ Failed to equip cosmetic:', error);
      return { success: false, error: 'server_error' };
    }
  }

  /**
   * Unequip a cosmetic from a slot
   */
  async unequipCosmetic(walletAddress: string, slot: 'trail' | 'headItem' | 'nameStyle'): Promise<{
    success: boolean;
    error?: string;
    equippedCosmetics?: any;
  }> {
    try {
      // Find user
      const user = await (User as any).findOne({ walletAddress });
      if (!user) {
        return { success: false, error: 'user_not_found' };
      }

      // Unequip cosmetic from slot
      if (user.equippedCosmetics && user.equippedCosmetics[slot]) {
        delete user.equippedCosmetics[slot];
        await user.save();
        console.log(`✨ ${user.username} unequipped cosmetic from ${slot}`);
      }

      return {
        success: true,
        equippedCosmetics: user.equippedCosmetics || {},
      };
    } catch (error) {
      console.error('❌ Failed to unequip cosmetic:', error);
      return { success: false, error: 'server_error' };
    }
  }

  /**
   * Get user's cosmetics data
   */
  async getUserCosmetics(walletAddress: string): Promise<{
    success: boolean;
    appleBalance?: number;
    unlockedCosmetics?: string[];
    equippedCosmetics?: any;
    error?: string;
  }> {
    try {
      const user = await (User as any).findOne({ walletAddress });
      if (!user) {
        return { success: false, error: 'user_not_found' };
      }

      return {
        success: true,
        appleBalance: user.apples || 0,
        unlockedCosmetics: user.unlockedCosmetics || [],
        equippedCosmetics: user.equippedCosmetics || {},
      };
    } catch (error) {
      console.error('❌ Failed to get user cosmetics:', error);
      return { success: false, error: 'server_error' };
    }
  }

  /**
   * Award apple to user (called from game end)
   */
  async awardApple(walletAddress: string, reason: 'held_at_end' | 'killed_holder'): Promise<void> {
    try {
      const user = await (User as any).findOne({ walletAddress });
      if (!user) {
        console.error(`❌ User not found for apple reward: ${walletAddress}`);
        return;
      }

      user.apples += 1;
      await user.save();

      console.log(`🍎 Awarded +1 apple to ${user.username} (${reason}) - New balance: ${user.apples}`);
    } catch (error) {
      console.error('❌ Failed to award apple:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const cosmeticsService = new CosmeticsService();

