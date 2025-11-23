# AgarFi - Phase 1 Demo

## 🎮 What's Included

Phase 1 delivers a **fully functional Agar.io clone** with:

✅ **Core Gameplay**
- Eat pellets to grow
- Consume smaller players
- Split to catch opponents
- Eject mass to escape
- Server-authoritative physics (60Hz)
- Canvas rendering (60fps target)

✅ **Lobby System**
- 6 game modes ($1, $5, $10, $25, $50, $100)
- Real-time player counts
- 120-second auto-start countdown
- Dynamic lobby management

✅ **Stats Tracking**
- Pellets eaten
- Cells eaten
- Highest mass
- Leader time (#1 position)
- Best rank
- Time survived

✅ **Testing Features**
- AI bots for solo testing
- Configurable minimum players (dev mode: 2)
- Auto-fill lobbies with bots

✅ **Phase 2 Complete - x402 Payments**
- USDC entry fee payments (x402 protocol)
- HTTP 402 status codes with payment requirements
- Blockchain verification of all transactions
- Token gating (100k $AgarFi required)
- Database persistence (MongoDB)
- Transaction logging and transparency

✅ **Phase 3 Complete - x403 Authentication**
- Wallet signature authentication (x403 protocol)
- HTTP 403 challenges with cryptographic verification
- 30-minute session management
- One wallet = one active game session
- Progressive rate limiting (5 free attempts, then timeouts)
- Anti-bot and anti-farming protection
- Replay attack prevention

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Install server dependencies
cd packages/server
npm install
cd ../..

# Install client dependencies
cd packages/client
npm install
cd ../..
```

### Configuration

1. Create `.env` file in root `agarFi/` directory:

```env
NODE_ENV=development
MIN_PLAYERS_DEV=2
AUTO_FILL_BOTS=true
SERVER_PORT=3001
```

2. See `ENV_CONFIG.md` for full configuration options.

### Running the Demo

```bash
# From agarFi/ directory

# Option 1: Run both server and client together
npm run dev

# Option 2: Run separately (in different terminals)
# Terminal 1:
npm run dev:server

# Terminal 2:
npm run dev:client
```

The game will be available at:
- **Client**: http://localhost:3000
- **Server**: http://localhost:3001

---

## 🎯 How to Demo

### Single Player Testing

1. **Start the server and client**: `npm run dev`
2. **Open browser**: http://localhost:3000
3. **Enter your name**: Any name you want
4. **Select a game mode**: Click any tier ($1-$100)
5. **Wait for countdown**: Bots will auto-fill to meet minimum (2 players in dev mode)
6. **Game starts**: After 120 seconds or when lobby fills
7. **Play the game**:
   - Move mouse to control your blob
   - Press `SPACE` to split
   - Press `W` to eject mass
   - Eat pellets (small dots) to grow
   - Eat smaller blobs to absorb their mass
8. **Game ends**: Last alive or after 30 minutes
9. **View stats**: See your performance metrics

### Multi-Player Testing

1. **Start server**: `npm run dev:server`
2. **Open multiple browser windows**: http://localhost:3000 in each
3. **Join same tier**: All players select the same game mode
4. **Wait for 10 players** or countdown to complete
5. **Compete**: Play against each other in real-time!

### Testing Different Game Modes

- **$1 Micro**: Quick casual games
- **$5 Low**: Standard gameplay
- **$10 Medium**: Balanced competition
- **$25 High**: Serious matches
- **$50 Very High**: Elite tier
- **$100 Elite**: Maximum stakes
- **🐋 Whale** Mode: Locked (coming in Phase 3)

---

## 🎮 Controls

### Mouse/Keyboard
- **Move**: Mouse cursor (blob follows)
- **Split**: `SPACE` key
- **Eject Mass**: `W` key

### Touch (Mobile)
- **Move**: Tap/drag on screen
- **Split**: Tap "SPLIT" button (bottom right)
- **Eject**: Tap "EJECT" button (bottom right)

---

## 📊 Understanding Stats

After each game, you'll see these stats:

| Stat | What It Means |
|------|---------------|
| **Food Eaten** | Total pellets consumed |
| **Cells Eaten** | How many players you eliminated |
| **Highest Mass** | Peak size you achieved |
| **Time Survived** | How long you lasted |
| **Leader Time** | Seconds spent as #1 on leaderboard |
| **Best Rank** | Your highest placement during the game |

### Tie-Breakers

If multiple players have the same mass at game end:

1. **Time Survived** (longer wins)
2. **Cells Eaten** (more wins)
3. **Pellets Eaten** (more wins)

---

## 🧪 Development Configuration

### Change Minimum Players

Edit `.env`:

```env
# Require only 2 players for testing
MIN_PLAYERS_DEV=2

# Require 10 players (production-like)
MIN_PLAYERS_DEV=10
```

### Disable Auto-Fill Bots

```env
AUTO_FILL_BOTS=false
```

### Adjust Game Parameters

```env
MAP_WIDTH=5000
MAP_HEIGHT=5000
STARTING_MASS=100
PELLET_COUNT=500
SPATIAL_HASH_GRID_SIZE=200
```

---

## 🐛 Troubleshooting

### Server won't start

```bash
# Make sure port 3001 is free
netstat -ano | findstr :3001

# Kill process if needed
taskkill /PID <PID> /F
```

### Client can't connect to server

1. Check server is running: http://localhost:3001/api/health
2. Verify `NEXT_PUBLIC_SOCKET_URL` in ENV_CONFIG.md
3. Check browser console for errors

### Game is laggy

1. Close other applications
2. Reduce `PELLET_COUNT` in `.env`
3. Check server CPU usage
4. Try different browser (Chrome recommended)

### Bots not spawning

1. Verify `AUTO_FILL_BOTS=true` in `.env`
2. Check server logs for errors
3. Restart server

---

## 📁 Project Structure

```
agarFi/
├── packages/
│   ├── server/              # Socket.io game server
│   │   ├── src/
│   │   │   ├── index.ts     # Server entry point
│   │   │   ├── gameRoom.ts  # Game loop & physics
│   │   │   ├── lobbyManager.ts
│   │   │   ├── botManager.ts
│   │   │   ├── physics.ts   # Physics calculations
│   │   │   ├── spatialHash.ts
│   │   │   ├── types.ts
│   │   │   └── config.ts
│   │   └── package.json
│   └── client/              # Next.js frontend
│       ├── app/
│       │   ├── page.tsx     # Homepage/Lobby
│       │   └── game/
│       │       └── page.tsx # Game canvas
│       └── package.json
├── .env                     # Your config (create this)
├── ENV_CONFIG.md            # Environment docs
├── package.json             # Root package
└── README.md                # This file
```

---

## 🔍 Technical Details

### Server (60Hz Tick Rate)

- **Physics Engine**: Custom, deterministic
- **Collision Detection**: Spatial hashing (O(n) complexity)
- **Speed Formula**: `2.2 × (32 / sqrt(mass))`
- **Radius Formula**: `sqrt(mass / PI)`
- **Eat Condition**: Predator must be 10% larger

### Client (60fps Rendering)

- **Rendering**: Raw Canvas API (no libraries)
- **Camera**: Follows player blob center
- **Zoom**: Dynamic based on player mass
- **Prediction**: Client-side for smooth movement
- **Sync**: Server-authoritative (server corrects client)

### Network

- **Protocol**: WebSocket via Socket.io
- **Full State**: Every 500ms
- **Delta Updates**: Every ~33ms (30Hz client)
- **Latency Handling**: Client prediction + server reconciliation

---

## ✅ Phase 1 Checklist

- [x] Socket.io server with 60Hz tick
- [x] Canvas rendering with 60fps
- [x] Blob physics (movement, eating, splitting, ejecting)
- [x] Spatial hashing collision detection
- [x] 6 game modes
- [x] Lobby system with countdown
- [x] Real-time leaderboard
- [x] Stats tracking (6 metrics)
- [x] End-game results modal
- [x] AI bots for testing
- [x] Mobile controls (split/eject buttons)

---

## 🎯 Development Status

### ✅ Phase 1 (Days 1-2) - COMPLETE
- Core game mechanics and multiplayer
- 60fps Canvas + 60Hz server tick
- All game modes implemented

### ✅ Phase 2 (Days 3-4) - COMPLETE
- **x402 USDC payment integration** ✅
- Entry fee collection with blockchain verification
- Automatic pot distribution (80/15/5 split)
- Refund system for lobby abandonment
- **$AgarFi token gating** (100k tokens required)
- MongoDB integration (users, transactions, games)
- Real-time transaction logging
- Public leaderboards (top 50 winners)

### 📅 Phase 3 (Days 5-6) - SCHEDULED
- **x403 wallet authentication**
- Wallet signature verification (ECDSA)
- Session management with cryptographic proofs
- One game per wallet enforcement
- Anti-farming pattern detection

### 📅 Phase 4 (Day 7) - SCHEDULED
- End-to-end testing on mainnet
- Security audits
- Performance optimization
- Production deployment
- **🎉 PUBLIC LAUNCH**

---

## 📝 Current Features

- ✅ **Real money gameplay** with USDC
- ✅ **Token gated** - Must hold 100k $AgarFi
- ✅ **6 game tiers** ($1, $5, $10, $25, $50, $100)
- ✅ **Dream Mode** - Free hourly game ($1 USDC prize)
- ✅ **Instant payouts** - Winners paid on Solana blockchain
- ✅ **Transaction transparency** - All payouts publicly visible
- ✅ **Persistent stats** - MongoDB database
- ✅ **Global chat** - Wallet-gated communication

---

## 💻 Development

### Watch Mode

Both server and client have hot-reload:

```bash
# Server auto-restarts on file changes
npm run dev:server

# Client auto-refreshes on file changes
npm run dev:client
```

### Build for Production

```bash
npm run build
```

---

## 📧 Questions?

- Check the feature spec: `../feature_spec.md`
- Review code comments in source files
- Test with different configurations in `.env`

---

**Phase 1 Complete! Ready to test and demo.** 🎉

