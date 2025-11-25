import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CosmeticsConfig, CosmeticItem } from './types.js';
import { User, IUser } from './models/User.js';
import { Cosmetic } from './models/Cosmetic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CosmeticsService {
  private cosmetics: CosmeticsConfig | null = null;

  /**
   * Load cosmetics from database (with fallback to seed from JSON)
   */
  async loadCosmetics(): Promise<void> {
    try {
      // Check mongoose connection
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 1) {
        this.cosmetics = { trails: [], headItems: [], nameStyles: [] };
        return;
      }
      
      // Try to load from database first
      const cosmeticsFromDB = await (Cosmetic as any).find({}).lean();
      
      if (cosmeticsFromDB && cosmeticsFromDB.length > 0) {
        // Group by category
        this.cosmetics = {
          trails: cosmeticsFromDB.filter((c: any) => c.category === 'trail'),
          headItems: cosmeticsFromDB.filter((c: any) => c.category === 'headItem'),
          nameStyles: cosmeticsFromDB.filter((c: any) => c.category === 'nameStyle'),
        };
        console.log(`✅ Loaded ${cosmeticsFromDB.length} cosmetics (${this.cosmetics.trails.length} trails, ${this.cosmetics.headItems.length} items, ${this.cosmetics.nameStyles.length} styles)`);
      } else {
        // Database is empty - seed from JSON file
        console.log('📦 Seeding cosmetics from JSON...');
        await this.seedFromJSON();
      }
    } catch (error) {
      console.error('❌ Failed to load cosmetics:', error);
      // Try to seed from JSON as fallback
      try {
        await this.seedFromJSON();
      } catch (seedError) {
        console.error('❌ Failed to seed from JSON:', seedError);
        this.cosmetics = { trails: [], headItems: [], nameStyles: [] };
      }
    }
  }

  /**
   * Seed cosmetics from JSON file into database
   */
  private async seedFromJSON(): Promise<void> {
    try {
      const cosmeticsPath = path.join(__dirname, '../cosmetics.json');
      const data = await fs.readFile(cosmeticsPath, 'utf-8');
      const jsonData: CosmeticsConfig = JSON.parse(data);
      
      // Flatten all cosmetics
      const allCosmetics = [
        ...jsonData.trails || [],
        ...jsonData.headItems || [],
        ...jsonData.nameStyles || []
      ];
      
      // Insert into database (upsert to avoid duplicates)
      for (const cosmetic of allCosmetics) {
        await (Cosmetic as any).findOneAndUpdate(
          { id: cosmetic.id },
          cosmetic,
          { upsert: true, new: true }
        );
      }
      
      console.log(`✅ Seeded ${allCosmetics.length} cosmetics into database`);
      
      // Now load from database
      const cosmeticsFromDB = await (Cosmetic as any).find({});
      this.cosmetics = {
        trails: cosmeticsFromDB.filter((c: any) => c.category === 'trail'),
        headItems: cosmeticsFromDB.filter((c: any) => c.category === 'headItem'),
        nameStyles: cosmeticsFromDB.filter((c: any) => c.category === 'nameStyle'),
      };
    } catch (error) {
      console.error('❌ Failed to seed cosmetics:', error);
      throw error;
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

      // Ensure apples field exists (backwards compatibility)
      if (user.apples === undefined || user.apples === null) {
        user.apples = 0;
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
      user.markModified('equippedCosmetics'); // Ensure Mongoose tracks the change
      await user.save();
      
      console.log(`✅ ${user.username} equipped ${cosmeticId} to ${slot}`);

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

      // Initialize equippedCosmetics if it doesn't exist
      if (!user.equippedCosmetics) {
        user.equippedCosmetics = {};
      }

      // Unequip cosmetic from slot by setting it to null/undefined
      if (user.equippedCosmetics[slot]) {
        // Use markModified to ensure Mongoose tracks the change
        user.equippedCosmetics[slot] = undefined;
        user.markModified('equippedCosmetics');
        await user.save();
      }

      // Clean the object for return (remove undefined values)
      const cleanedCosmetics: any = {};
      if (user.equippedCosmetics.trail) cleanedCosmetics.trail = user.equippedCosmetics.trail;
      if (user.equippedCosmetics.headItem) cleanedCosmetics.headItem = user.equippedCosmetics.headItem;
      if (user.equippedCosmetics.nameStyle) cleanedCosmetics.nameStyle = user.equippedCosmetics.nameStyle;

      return {
        success: true,
        equippedCosmetics: cleanedCosmetics,
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

      // Ensure apples field exists (backwards compatibility)
      if (user.apples === undefined || user.apples === null) {
        user.apples = 0;
        await user.save();
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

      // Ensure apples field exists (backwards compatibility)
      if (user.apples === undefined || user.apples === null) {
        user.apples = 0;
      }

      user.apples += 1;
      await user.save();
    } catch (error) {
      console.error('❌ Failed to award apple:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const cosmeticsService = new CosmeticsService();

