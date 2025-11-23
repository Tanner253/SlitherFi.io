import fs from 'fs';
import path from 'path';

const BAN_FILE = path.join(process.cwd(), 'banned-ips.json');

interface BanRecord {
  ip: string;
  playerName: string;
  reason: string;
  timestamp: number;
}

/**
 * Load banned IPs from file
 */
export function loadBannedIPs(): Set<string> {
  try {
    if (fs.existsSync(BAN_FILE)) {
      const data = fs.readFileSync(BAN_FILE, 'utf-8');
      const bans: BanRecord[] = JSON.parse(data);
      console.log(`📋 Loaded ${bans.length} banned IPs from file`);
      return new Set(bans.map(b => b.ip));
    }
  } catch (error) {
    console.error('Error loading banned IPs:', error);
  }
  return new Set();
}

/**
 * Save a new ban to file
 */
export function saveBan(ip: string, playerName: string, reason: string): void {
  try {
    let bans: BanRecord[] = [];
    
    // Load existing bans
    if (fs.existsSync(BAN_FILE)) {
      const data = fs.readFileSync(BAN_FILE, 'utf-8');
      bans = JSON.parse(data);
    }
    
    // Add new ban
    bans.push({
      ip,
      playerName,
      reason,
      timestamp: Date.now()
    });
    
    // Save to file
    fs.writeFileSync(BAN_FILE, JSON.stringify(bans, null, 2), 'utf-8');
    console.log(`💾 Ban saved to file: ${ip} (${playerName})`);
  } catch (error) {
    console.error('Error saving ban:', error);
  }
}

/**
 * Get all bans (for admin review)
 */
export function getAllBans(): BanRecord[] {
  try {
    if (fs.existsSync(BAN_FILE)) {
      const data = fs.readFileSync(BAN_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading bans:', error);
  }
  return [];
}

