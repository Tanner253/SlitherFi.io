# 🔧 Environment Variables Template

**Copy the configuration below to a `.env` file in the `slitherfi/` directory**

```env
# ========================================
# SlitherFi Environment Configuration
# ========================================
# NEVER commit .env to git!

# ========================================
# NODE ENVIRONMENT
# ========================================
NODE_ENV=development

# ========================================
# SERVER CONFIGURATION
# ========================================
SERVER_PORT=3001
SERVER_TICK_RATE=60

# ========================================
# DATABASE (MongoDB)
# ========================================
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/slitherfi?retryWrites=true&w=majority

# ========================================
# BLOCKCHAIN - SOLANA
# ========================================
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
PLATFORM_WALLET_PRIVATE_KEY=your_base58_private_key_here
USDC_MINT_ADDRESS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# ========================================
# AUTHENTICATION & SECURITY
# ========================================
JWT_SECRET=your_secure_random_jwt_secret_here_minimum_64_characters

# ========================================
# GAME MODES & PRICING
# ========================================
GAME_MODE_1_ENTRY=0.10
GAME_MODE_5_ENTRY=0.15
GAME_MODE_10_ENTRY=0.25
GAME_MODE_25_ENTRY=0.50
GAME_MODE_50_ENTRY=1.00
GAME_MODE_100_ENTRY=5.00

GAME_MODE_1_STAT_MULTIPLIER=1.1
GAME_MODE_5_STAT_MULTIPLIER=1.15
GAME_MODE_10_STAT_MULTIPLIER=1.3
GAME_MODE_25_STAT_MULTIPLIER=1.5
GAME_MODE_50_STAT_MULTIPLIER=2
GAME_MODE_100_STAT_MULTIPLIER=3

# ========================================
# GAME CONFIGURATION
# ========================================
MAP_WIDTH=5000
MAP_HEIGHT=5000
STARTING_MASS=250
PELLET_COUNT=500
MAX_GAME_DURATION_MS=1800000
SHRINKING_ENABLED=true
SHRINK_START_PERCENT=0.5

# ========================================
# LOBBY CONFIGURATION
# ========================================
LOBBY_MIN_PLAYERS=10
MIN_PLAYERS_DEV=2
AUTO_FILL_BOTS=true

# ========================================
# CLIENT-SIDE (NEXT_PUBLIC_ prefix required)
# ========================================
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SOLANA_RPC=https://api.mainnet-beta.solana.com
NEXT_PUBLIC_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

## 🔐 Security Notes

1. **JWT_SECRET**: Generate with `openssl rand -base64 64`
2. **PLATFORM_WALLET_PRIVATE_KEY**: Use Solana wallet private key in base58 format
3. **MONGODB_URI**: Get from MongoDB Atlas
4. **NEVER** commit `.env` to git - it's already in `.gitignore`

## 📋 Required vs Optional

### ✅ Required for Development:
- `NODE_ENV`
- `SERVER_PORT`
- `MIN_PLAYERS_DEV`
- `AUTO_FILL_BOTS`

### ✅ Required for Production:
- All of the above PLUS:
- `MONGODB_URI`
- `SOLANA_RPC_URL`
- `PLATFORM_WALLET_PRIVATE_KEY`
- `JWT_SECRET`
- `USDC_MINT_ADDRESS`

