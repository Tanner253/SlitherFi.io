 Apple Collection & Cosmetics System - Feature Specification
Version: 1.0
Project: SlitherFi.io
Date: November 24, 2025EXECUTIVE SUMMARY
This specification defines the implementation of an in-game collectible system (Apples) and a cosmetic store where players can spend their collected apples to customize their snake's appearance. The system introduces:
Apple Collectible System: A rare in-game item that spawns during matches, can be held by players, and rewards the holder with +1 apple currency upon meeting win conditions
Cosmetic Store: A slot-based customization system with three categories (trails, head items, name styles) purchasable with apple currency
Visual Indicators: Real-time rendering of held apples, equipped cosmetics, and a crown for the first-place player
OBJECTIVES
2.1 Business Goals
Increase player engagement through collectible mechanics
Add progression system independent of USDC wagering
Incentivize repeated gameplay to accumulate apples
Provide visual status symbols and personalization options
2.2 Technical Goals
Implement server-authoritative collectible system with zero client-side manipulation potential
Create scalable cosmetic data architecture for future expansion
Maintain 60 tick/second performance with additional rendering requirements
Ensure data persistence and security for virtual currency (apples)
SYSTEM ARCHITECTURE
3.1 Architecture Principles
Server Authority: All apple spawn decisions, pickup detection, drop logic, and reward distribution occur server-side
Client Rendering Only: Client receives apple state via socket events and renders accordingly
Database Persistence: Apple balances and cosmetic ownership stored in MongoDB User collection
Stateless Cosmetics: Cosmetic definitions stored in JSON configuration file; ownership tracked per-user in database
3.2 Component Overview
Server Components:
Apple Manager (within GameRoom): Handles apple lifecycle during match
Cosmetics Service: Loads cosmetic definitions, validates purchases, processes transactions
User Model Extensions: Stores apple balance, unlocked cosmetics, equipped cosmetics
Client Components:
Apple Renderer (game canvas): Draws free and held apples
Crown Renderer (game canvas): Displays crown above first-place player
Cosmetics Renderer (game canvas): Renders trails, head items, and name styling
Cosmetics Store UI: Interface for browsing, purchasing, and equipping cosmetics
Profile Modal Extensions: Displays apple balance and cosmetic management
Data Components:
cosmetics.json: Configuration file defining all available cosmetics
User MongoDB Document: Extended with apple and cosmetic fields
APPLE COLLECTIBLE SYSTEM
4.1 Apple Spawn Mechanics
4.1.1 Spawn Rate Rules
Dream Mode (Free Games): 10% spawn chance (1 in 10 games)
Paid Entry Games: 100% spawn chance (10 in 10 games)
Maximum Per Game: Exactly 1 apple maximum per game session
Spawn Timing: Apple spawns at game initialization (when game starts, not during countdown)
4.1.2 Spawn Location Rules
Apple spawns at random X,Y coordinates within the current playable map bounds
Initial spawn uses full map dimensions (before shrinking zone activates)
Spawn position must not overlap with any player spawn positions (minimum 200 unit buffer)
Spawn position must be validated as within bounds before finalizing
4.1.3 Spawn Decision Logic
The server determines whether an apple spawns using the following logic:
Check game tier: Is this a Dream Mode game or paid entry game?
If Dream Mode: Generate random number 0-99. If number < 10, spawn apple. Otherwise, no apple this game.
If Paid Entry: Always spawn apple.
Generate random valid spawn position within map bounds
Create apple entity in game state
Broadcast apple spawn to all connected clients
4.2 Apple Pickup Mechanics
4.2.1 Pickup Conditions
Player's snake head segment collides with free apple position
Collision detection uses circular hitbox (snake head radius + apple radius)
Only the snake head can pick up apples (body segments cannot)
Apple must be in "free" state (not currently held by another player)
4.2.2 Pickup Effects
Apple entity state changes from "free" to "held"
Apple position becomes relative to holder's head position (offset in front)
Apple's heldBy property set to player ID
Server broadcasts applePickedUp event to all clients with player ID
All clients update their local rendering to show apple held by player
4.2.3 Visual Representation When Held
Apple renders as a small circular segment positioned in front of the snake's head
Apple position calculated as: headX + cos(headAngle) * offsetDistance, headY + sin(headAngle) * offsetDistance
Offset distance: 12-15 units from head center
Apple radius when held: 8 units (smaller than free apple)
Rendering order: Body segments → held apple → head (so head renders on top)
Effect creates appearance of apple "in the snake's mouth"
4.3 Apple Drop Mechanics
4.3.1 Drop Trigger Conditions
Player holding apple is eliminated (snake dies)
Player disconnects while holding apple
Game is forcibly terminated (server error/shutdown)
4.3.2 Drop Behavior
Apple drops at the exact position of the eliminated player's head segment at time of death
Apple state changes from "held" to "free"
Apple's heldBy property cleared
Server broadcasts appleDropped event with new apple position
Apple becomes immediately pickupable by other living players
If dropped apple is outside safe zone (see 4.4), respawn logic triggers immediately
4.3.3 Drop Edge Cases
Simultaneous Deaths: If two players die simultaneously and both are touching the dropped apple, first collision detection in next tick wins
Death on Boundary: If player dies while touching the red shrinking boundary, apple drops at last valid position inside boundary, or respawns in safe zone if no valid position
4.4 Apple Zone Safety & Respawn
4.4.1 Zone Shrinking Detection
Every server tick, check if apple position is outside the current shrinking boundary
Shrinking boundary defined by currentMapBounds (minX, maxX, minY, maxY)
If apple X or Y coordinate is outside these bounds, trigger respawn
4.4.2 Safe Zone Respawn Logic
Generate new random position within current valid map bounds
Validate position is at least 50 units inside boundary (buffer zone)
Validate position does not overlap with any living player (100 unit buffer)
Update apple position to new location
Broadcast appleRespawned event to all clients
If apple was held, it is dropped first (triggering drop logic), then respawned
4.4.3 Respawn Failure Handling
If no valid respawn position found after 10 attempts (extremely small safe zone), apple is removed from game
Broadcast appleRemoved event to all clients
Game continues without apple
4.5 Apple Reward Distribution
4.5.1 Reward Conditions
The apple reward (+1 apple to player's permanent balance) is distributed based on the following conditions when the game ends:
Primary Condition - Holder Survives:
If a player is holding the apple when the game ends (timer expires or natural conclusion), that player receives +1 apple regardless of final placement
Secondary Condition - Winner Kills Holder:
If the first-place player (by length) delivers the killing blow to the apple holder, the first-place player receives +1 apple
This only applies if the killing blow directly eliminates the apple holder
This prevents situations where the winner cannot pick up the dropped apple before the game ends
Tiebreaker Logic:
If the game ends with the apple holder alive but not in first place, the holder keeps the apple
If the game ends with exactly 2 players remaining: Player 1 (first place, larger length) and Player 2 (holding apple), Player 2 receives the apple even though they placed second
4.5.2 Reward Processing
Game end triggered (timer expires, only 1 player remains, or force end)
Server checks apple state:
If apple is held by player X, and player X is alive → Player X receives +1 apple
If apple was held by player Y, and player Y was killed by player Z (the winner) as the final kill → Player Z receives +1 apple
If no apple spawned this game → No apple rewards
Server updates User document in database: apples += 1
Server broadcasts appleRewarded event to recipient with updated balance
Recipient's client displays notification: " +1 Apple! Total: X"
4.5.3 Reward Edge Cases
Case: Apple holder disconnects before game ends
Apple drops and becomes free
If another player picks it up before game ends, new holder can win the apple
If nobody picks it up, no apple reward this game
Case: All remaining players die simultaneously (map boundary kills)
Determine final placement by time of death
Apple reward goes to last player eliminated if they were holding it
If apple was free at moment of simultaneous elimination, no reward
Case: Winner kills holder, but apple is picked up by third player before game ends
Third player who picked up the dropped apple receives the reward (standard holder rule)
Winner does not receive special reward (they missed the pickup window)
4.6 Apple Visual Design
4.6.1 Free Apple Appearance
Shape: Circular with apple-like features (optional: small stem/leaf on top)
Size: Radius of 12 units (slightly larger than regular pellets which are ~5 units)
Color: Red gradient (#FF3333 to #CC0000) or golden (#FFD700) depending on design preference
Animation: Floating/bobbing effect - oscillates vertically ±3 units over 2 second cycle
Glow Effect: Pulsing glow/shadow effect to make it stand out from pellets (shadow blur 20px, pulsing 0.5 to 1.0 opacity over 1.5 seconds)
4.6.2 Held Apple Appearance
Size: Radius of 8 units (smaller than free apple to fit "in mouth")
Position: 12-15 units in front of snake head, following head angle
Color: Same as free apple but no glow/pulse effects
Rendering Layer: Drawn before head segment so head renders on top
Indicator: Small indicator visible to all players showing "X is holding the apple" in UI
FIRST PLACE CROWN SYSTEM
5.1 Crown Display Logic
Crown appears above the snake head of the player currently in first place (longest length)
Crown updates in real-time as leaderboard positions change
If player loses first place, crown disappears
If new player takes first place, crown appears on their head
5.2 Crown Visual Specification
Position: Centered horizontally above snake head, offset vertically by (headRadius + 15 units)
Size: Approximately 20 units wide × 12 units tall
Design: Simple crown icon with 3-5 points, golden yellow color (#FFD700)
Rotation: Crown does NOT rotate with snake head (always upright/vertical)
Animation: Subtle scaling pulse (0.95 to 1.05 scale over 1 second cycle) or none
Rendering Layer: Draws above all snake segments and apples
5.3 Crown Position Tracking
Crown position recalculated every frame based on current head segment position
Formula: crownX = headX, crownY = headY - (headRadius + 15)
Crown follows snake smoothly with no lag or interpolation delay
COSMETICS SYSTEM
6.1 Cosmetic Architecture
6.1.1 Slot-Based System
The cosmetics system uses a slot-based architecture with exactly three slots:
Trail Slot: Visual effect that follows behind the snake's body
Head Item Slot: Decoration that appears on or around the snake's head
Name Style Slot: Styling applied to the player's name text (color, glow, effects)
Each slot can hold exactly one cosmetic item at a time, or be empty (default appearance).
6.1.2 Cosmetic Item Properties
Every cosmetic item has the following properties:
id: Unique identifier (string, format: category_name, e.g., trail_rainbow)
name: Display name (string, e.g., "Rainbow Trail")
description: Short description of the cosmetic (string, 1-2 sentences)
category: One of: trail, headItem, nameStyle
cost: Apple price to unlock (integer, 0 or positive)
rarity: Optional rarity tier for future sorting/filtering (common, rare, epic, legendary)
renderData: Object containing rendering parameters specific to cosmetic type (colors, particle settings, etc.)
6.1.3 Ownership Model
Players start with zero cosmetics unlocked (all slots empty)
Players must purchase cosmetics with apples to unlock them
Once unlocked, cosmetic is permanently available to that player
Players can equip/unequip unlocked cosmetics freely with no cost
Players can change equipped cosmetics at any time (in lobby, in profile, in game)
6.2 Cosmetic Categories
6.2.1 Trail Cosmetics
Trails are visual effects that render along the path of the snake's body.
Rendering Behavior:
Trails render behind each body segment (excluding head)
Trail particles/effects spawn at each segment position
Trails fade out over time (lifetime: 0.5-1 second depending on trail type)
Trails respect camera zoom (scale with game view)
Trail Types to Support:
Particle Trails: Emit small particles from each segment (e.g., Rainbow particles, Fire embers, Lightning sparks)
Solid Trails: Draw a continuous line or glow behind the snake (e.g., Neon glow, Shadow trail)
Animated Trails: Special effects that animate along the snake path (e.g., Energy pulse, Sparkle wave)
Default State (No Trail Equipped):
No trail renders (standard snake appearance)
6.2.2 Head Item Cosmetics
Head items are decorative objects that render on or around the snake's head segment.
Rendering Behavior:
Head item position calculated relative to head segment center
Head item rotates with snake head angle (maintains relative orientation)
Head items render on top of head segment (after head is drawn)
Head items scale with camera zoom
Head Item Types to Support:
Hats/Headwear: Render above head (e.g., Party hat, Top hat, Sunglasses)
Accessories: Render around head (e.g., Halo, Crown different from first-place crown, Horns)
Effects: Special visual effects attached to head (e.g., Glowing aura, Flames)
Positioning Formula:
X offset: headX + cos(headAngle + relativeAngle) * distance
Y offset: headY + sin(headAngle + relativeAngle) * distance
Where relativeAngle and distance are defined per cosmetic item
Default State (No Head Item Equipped):
Standard head appearance with eyes only (current implementation)
6.2.3 Name Style Cosmetics
Name styles apply visual effects to the player's name text displayed above their snake.
Rendering Behavior:
Name text renders above snake head (current position maintained)
Name style modifies text color, shadow, glow, outline, or animation
Name remains readable at all zoom levels
Name follows snake head with standard offset
Name Style Types to Support:
Color Gradients: Multi-color text fills (e.g., Rainbow gradient, Fire gradient, Gold-to-silver)
Glow Effects: Add shadow/glow around text (e.g., Neon glow, Soft glow, Pulsing glow)
Text Outlines: Add stroke around letters (e.g., Bold black outline, Gold outline)
Animations: Animate text properties (e.g., Color cycle, Pulsing opacity, Wave effect)
Default State (No Name Style Equipped):
White text with small black shadow (current implementation)
6.3 Cosmetics Data Structure
6.3.1 Configuration File Format
Cosmetics are defined in a JSON configuration file located at packages/server/cosmetics.json.
File Structure:
{  "trails": [ array of trail cosmetic objects ],  "headItems": [ array of head item cosmetic objects ],  "nameStyles": [ array of name style cosmetic objects ]}
Individual Cosmetic Object Structure:
{  "id": "unique_identifier",  "name": "Display Name",  "description": "Brief description of cosmetic effect",  "category": "trail | headItem | nameStyle",  "cost": integer (apple price),  "rarity": "common | rare | epic | legendary" (optional),  "renderData": {    // Category-specific rendering parameters    // Examples:    // For trails: { particleColor, particleSize, emissionRate, lifetime }    // For headItems: { offsetX, offsetY, rotation, scale, image/shape }    // For nameStyles: { color, gradient, shadowBlur, glowColor }  }}
6.3.2 Initial Cosmetics Seed Data
The initial release should include 3-5 cosmetics per category (9-15 total) to populate the store.
Suggested Initial Trails:
Basic Glow Trail (low cost, simple glow line)
Rainbow Trail (medium cost, multi-color particles)
Fire Trail (medium-high cost, fire embers with red-orange gradient)
Lightning Trail (high cost, electric sparks with branching effect)
Shadow Trail (medium cost, dark purple/black smoke particles)
Suggested Initial Head Items:
Party Hat (low cost, colorful cone hat)
Sunglasses (low-medium cost, cool shades on eyes)
Halo (medium cost, golden ring above head)
Devil Horns (medium cost, red horns protruding from head)
Crown (high cost, ornate crown distinct from first-place crown)
Suggested Initial Name Styles:
Rainbow Text (medium cost, color gradient)
Glowing Gold (medium cost, golden text with strong glow)
Neon Pulse (medium-high cost, animated neon glow)
Fire Text (high cost, flame-colored gradient with flicker)
Ice Text (medium cost, light blue with frost effect)
Pricing Guidelines:
Low cost: 25-50 apples
Medium cost: 50-100 apples
High cost: 100-200 apples
Premium/rare cost: 200+ apples
6.4 User Data Persistence
6.4.1 Database Schema Extensions
The User MongoDB document is extended with three new fields:
Field: apples
Type: Number
Default: 0
Description: Total number of apples the player has accumulated
Constraints: Cannot be negative (validate on deduction)
Indexed: Yes (for leaderboard queries in future)
Field: unlockedCosmetics
Type: Array of Strings
Default: [] (empty array)
Description: Array of cosmetic IDs that the player has purchased
Example: ["trail_rainbow", "head_sunglasses", "name_gold"]
Constraints: No duplicate IDs (validate on purchase)
Field: equippedCosmetics
Type: Object with optional properties
Default: {} (empty object)
Description: Currently equipped cosmetic for each slot
Structure:
  {    trail: "trail_rainbow" (optional),    headItem: "head_sunglasses" (optional),    nameStyle: "name_gold" (optional)  }

Constraints: Each value must be in unlockedCosmetics array or null/undefined
6.4.2 Data Validation Rules
Purchase Validation: Before deducting apples, verify user has sufficient balance
Unlock Validation: Before adding to unlockedCosmetics, verify cosmetic exists in config
Equip Validation: Before equipping, verify cosmetic is in user's unlockedCosmetics array
Equip Validation: Verify cosmetic category matches the slot being equipped to
Atomic Operations: All database updates use atomic operations to prevent race conditions
7. USER FLOWS
7.1 Apple Collection Flow
Flow: Player Joins Game With Apple
Player joins lobby (Dream or paid tier)
Game starts, server determines if apple spawns based on tier and random chance
If apple spawns, server broadcasts apple position to all players
Player navigates snake toward apple on map
Player's snake head touches apple, server detects collision
Server updates apple state to "held by player X"
Server broadcasts apple pickup event to all clients
All clients render apple in front of player X's head
Other players see player X holding the apple
Flow: Player Wins With Apple
Player holding apple survives until game end (timer expires or last player standing)
Server detects game end condition
Server checks apple state: held by player X
Server adds +1 to player X's apple balance in database
Server sends apple reward notification to player X
Player X sees toast notification: " +1 Apple! Total: X"
Player can view updated apple balance in profile
Flow: Player Killed While Holding Apple
Player X (holding apple) collides with player Y or boundary
Server detects player X death
Server drops apple at player X's death position
Server broadcasts apple drop event with new position
All clients render apple as free at new position
Other players can now pick up the dropped apple
If player Y (winner) picks up apple before game ends, player Y gets the reward
Flow: Apple Outside Safe Zone
Shrinking boundary contracts during game
Server detects apple position is outside currentMapBounds
Server generates new valid position inside safe zone
Server updates apple position
Server broadcasts apple respawn event
All clients render apple at new position
Game continues normally
7.2 Cosmetic Purchase Flow
Flow: Player Browses Cosmetics Store
Player clicks profile icon or dedicated "Cosmetics" button
Cosmetics interface opens (modal or new section in ProfileModal)
Interface displays:
Current apple balance prominently at top
Three tabs or sections for each category (Trails, Head Items, Name Styles)
Grid of cosmetic items in selected category
For each cosmetic, display:
Visual preview or icon
Name and description
Apple cost
Lock icon if not unlocked, or "Owned" badge if unlocked
"Equip" button if owned, "Purchase" button if locked
Flow: Player Purchases Cosmetic
Player clicks "Purchase" button on locked cosmetic
Confirmation modal appears: "Purchase [Cosmetic Name] for [Cost] apples?"
Modal shows current balance and balance after purchase
Player clicks "Confirm" or "Cancel"
If confirmed, client sends purchase request to server
Server validates:
User has sufficient apple balance
Cosmetic exists and user doesn't already own it
If valid:
Server deducts apple cost from user balance
Server adds cosmetic ID to user's unlockedCosmetics array
Server saves to database
Server responds with success + updated user data
Client updates UI:
Shows success notification: "Unlocked [Cosmetic Name]!"
Updates apple balance display
Changes cosmetic button from "Purchase" to "Equip"
Optional: Prompts "Equip now?" with auto-equip option
Flow: Player Equips Cosmetic
Player clicks "Equip" button on owned cosmetic
Client sends equip request to server with cosmetic ID and slot
Server validates cosmetic is in user's unlockedCosmetics
Server updates user's equippedCosmetics object for the appropriate slot
Server saves to database
Server responds with success
Client updates UI:
Shows equipped indicator on cosmetic item
Updates slot display to show newly equipped cosmetic
If in game, immediately renders new cosmetic on player's snake
Flow: Player Unequips Cosmetic
Player clicks "Unequip" button or clicks on equipped slot to remove
Client sends unequip request to server with slot identifier
Server removes cosmetic from specified slot in equippedCosmetics
Server saves to database
Server responds with success
Client updates UI:
Removes equipped indicator
Clears slot display (shows "Empty" or default state)
If in game, reverts to default appearance for that slot
7.3 In-Game Cosmetic Display Flow
Flow: Player Joins Game With Equipped Cosmetics
Player joins lobby with equipped cosmetics in profile
Server retrieves player's equippedCosmetics from database
Server includes equipped cosmetics in player data sent to game room
Game room broadcasts player join with cosmetic data to all clients
All clients receive player data including equippedCosmetics object
Each client loads rendering parameters for equipped cosmetics from cosmetics config
During game rendering loop, client applies cosmetic effects:
Trail: Renders trail particles/effects behind body segments
Head Item: Renders decoration at head position with proper rotation
Name Style: Applies styling to player name text
All players in game see the custom cosmetics on each other's snakes
Flow: Player Changes Cosmetics Mid-Game
Player equips new cosmetic while in lobby (before game starts)
Server updates player's equipped cosmetics
Server broadcasts cosmetic update to all clients in lobby
All clients update their local player data
When game starts, new cosmetics are rendered
Note: Cosmetic changes during active gameplay (after game starts) are not supported in initial version
8. API & SOCKET EVENTS SPECIFICATION
8.1 Apple-Related Socket Events
Event: appleSpawned
Direction: Server → All Clients
Timing: When game starts and apple spawn conditions are met
Payload:
  {    appleId: string,    x: number,    y: number,    spawnTime: number (timestamp)  }
Client Action: Render free apple at specified position with animation
Event: applePickedUp
Direction: Server → All Clients
Timing: When any player's head collides with free apple
Payload:
  {    appleId: string,    playerId: string,    playerName: string  }
Client Action: Update apple state to held, render apple in front of player's head, show notification "[PlayerName] picked up the apple!"
Event: appleDropped
Direction: Server → All Clients
Timing: When player holding apple is eliminated
Payload:
  {    appleId: string,    x: number,    y: number,    droppedBy: string (player ID),    reason: "death" | "disconnect"  }
Client Action: Update apple state to free, render apple at new position with animation
Event: appleRespawned
Direction: Server → All Clients
Timing: When apple is moved due to zone shrinking
Payload:
  {    appleId: string,    x: number,    y: number,    reason: "zone_shrink"  }
Client Action: Update apple position, optionally show respawn animation
Event: appleRemoved
Direction: Server → All Clients
Timing: When apple cannot be respawned (no valid positions)
Payload:
  {    appleId: string,    reason: "no_valid_position"  }
Client Action: Remove apple from rendering
Event: appleRewarded
Direction: Server → Specific Client
Timing: When game ends and player receives apple reward
Payload:
  {    playerId: string,    newBalance: number,    reason: "held_at_end" | "killed_holder"  }
Client Action: Show success notification " +1 Apple! Total: X", update local apple balance display
8.2 Cosmetics-Related Socket Events
Event: getCosmetics
Direction: Client → Server (request)
Timing: When cosmetics store is opened
Payload: None (or optional category filter)
Response Event: cosmeticsData
Response Payload:
  {    trails: [ array of trail cosmetic objects ],    headItems: [ array of head item cosmetic objects ],    nameStyles: [ array of name style cosmetic objects ]  }
Event: getUserCosmetics
Direction: Client → Server (request)
Timing: When profile or cosmetics UI is opened
Payload: None (uses authenticated user session)
Response Event: userCosmeticsData
Response Payload:
  {    appleBalance: number,    unlockedCosmetics: [ array of cosmetic IDs ],    equippedCosmetics: {      trail: string | null,      headItem: string | null,      nameStyle: string | null    }  }
Event: purchaseCosmetic
Direction: Client → Server (request)
Timing: When player confirms cosmetic purchase
Payload:
  {    cosmeticId: string  }
Response Event: purchaseResult
Response Payload (success):
  {    success: true,    cosmeticId: string,    newBalance: number,    unlockedCosmetics: [ updated array ]  }
Response Payload (failure):
  {    success: false,    error: string ("insufficient_balance" | "already_owned" | "invalid_cosmetic")  }
Event: equipCosmetic
Direction: Client → Server (request)
Timing: When player clicks equip on owned cosmetic
Payload:
  {    cosmeticId: string,    slot: "trail" | "headItem" | "nameStyle"  }
Response Event: equipResult
Response Payload (success):
  {    success: true,    slot: string,    cosmeticId: string,    equippedCosmetics: { updated object }  }
Response Payload (failure):
  {    success: false,    error: string ("not_owned" | "invalid_slot" | "invalid_cosmetic")  }
Event: unequipCosmetic
Direction: Client → Server (request)
Timing: When player removes cosmetic from slot
Payload:
  {    slot: "trail" | "headItem" | "nameStyle"  }
Response Event: unequipResult
Response Payload:
  {    success: true,    slot: string,    equippedCosmetics: { updated object }  }
Event: cosmeticsUpdated
Direction: Server → All Clients in Lobby/Game
Timing: When player equips/unequips cosmetic while in lobby
Payload:
  {    playerId: string,    equippedCosmetics: { updated object }  }
Client Action: Update rendering for specified player's cosmetics
9. UI/UX SPECIFICATIONS
9.1 Apple Balance Display
Location 1: Profile Modal
Apple balance displayed prominently in profile header
Format: " Apples: X" or apple icon + number
Font size: Large, easily readable
Position: Near username or stats section
Location 2: Cosmetics Store Header
Apple balance shown at top of store interface
Format: "Your Apples: X "
Updates in real-time after purchases
Visual emphasis when balance changes (brief highlight animation)
Location 3: Post-Game Results (if apple earned)
Show apple reward in game end screen
Format: "+1 Apple Earned! "
Display new total balance
Include reason text: "You held the apple!" or "You eliminated the apple holder!"
9.2 Cosmetics Store Interface
Overall Layout:
Modal overlay or dedicated section within ProfileModal
Three-tab interface: "Trails" | "Head Items" | "Name Styles"
Apple balance prominently displayed at top
Grid layout for cosmetic items (3-4 items per row on desktop, 2 on mobile)
Individual Cosmetic Card:
Visual preview: Icon, animation preview, or representative image
Cosmetic name (bold, prominent)
Short description (1-2 lines, smaller text)
Apple cost (large, highlighted if player can afford)
Status indicator:
If locked: Lock icon + "Purchase" button
If owned but not equipped: Checkmark icon + "Equip" button
If owned and equipped: Green highlight + "Equipped" label + "Unequip" button
Hover state: Slight scale or glow effect
Click state: Opens purchase confirmation or equips directly
Purchase Confirmation Modal:
Modal title: "Purchase [Cosmetic Name]?"
Cosmetic preview (larger image/animation)
Cost display: "[Cost] "
Balance display: "Your Balance: [Current]  → [After] "
Warning if balance becomes low: "This will leave you with [X] apples"
Buttons: "Confirm Purchase" (primary) | "Cancel" (secondary)
After successful purchase: Auto-close or show "Equip Now?" prompt
Empty Slot Display:
In equipped cosmetics section, show three slots
If slot is empty: Show placeholder with "Empty" text and slot icon
Click empty slot: Opens store filtered to that category
Click filled slot: Shows "Unequip" option or opens slot management
9.3 In-Game Visual Elements
Apple Rendering (Free State):
Highly visible: Larger than pellets, distinct color, animated
Animation: Gentle floating/bobbing motion
Glow/pulse effect to draw attention
Minimap indicator: If minimap exists, show apple as special icon
Apple Rendering (Held State):
Small apple in front of snake head (as specified in section 4.2.3)
All players see the apple held by the player
Optional: UI indicator showing "[PlayerName] has the apple" in sidebar
Crown Rendering (First Place):
Golden crown above first place player's head
Always upright (no rotation)
Visible at all camera zoom levels
Clear distinction from cosmetic head items
Cosmetic Rendering:
Trails: Smooth, performant particle effects that don't obscure gameplay
Head items: Clear, visible, but not overpowering
Name styles: Readable at all times, enhanced but not garish
All cosmetics scale appropriately with camera zoom
9.4 Notifications & Feedback
Apple Pickup Notification:
Toast/banner: "[PlayerName] picked up the apple!"
Duration: 3-4 seconds
Style: Informational (blue/cyan color)
Position: Top center or top-right of game screen
Apple Reward Notification:
Toast/banner: " +1 Apple! Total: X"
Duration: 5-6 seconds (longer to celebrate)
Style: Success (green color with glow)
Position: Center-top of screen
Optional: Confetti or celebration animation
Cosmetic Purchase Success:
Toast: "Unlocked [Cosmetic Name]!"
Duration: 3 seconds
Style: Success (green)
Position: Top-right
Optional: Prompt "Equip Now?" below notification
Insufficient Balance Error:
Toast: "Not enough apples! Need [X] more."
Duration: 4 seconds
Style: Error (red/orange)
Position: Top-right
Equip/Unequip Feedback:
Subtle toast: "[Cosmetic Name] equipped" or "Slot cleared"
Duration: 2 seconds
Style: Informational
Position: Top-right
10. SECURITY CONSIDERATIONS
10.1 Apple System Security
Server Authority:
All apple spawn decisions made server-side (client cannot force spawn)
All collision detection for apple pickup calculated server-side
Client sends input (movement), server calculates if pickup occurred
Client cannot send "pickup apple" command directly
Database Security:
Apple balance stored in MongoDB User document
All apple balance modifications use atomic operations
Validation ensures balance never goes negative
Apple rewards only granted by server after game end validation
Anti-Cheat Measures:
Verify player ID matches authenticated session before awarding apples
Log all apple transactions for auditing (who, when, amount, reason)
Rate limiting on apple-related events (prevent spam/flood attacks)
Validate apple position is within current map bounds before spawn/respawn
Edge Case Protection:
Handle race conditions (two players pickup simultaneously): First collision in server tick wins
Handle disconnections: Apple drops immediately, no "holding while disconnected" state
Handle server crashes: Apple state reconstructed from last valid game state or lost (no false rewards)
10.2 Cosmetics System Security
Purchase Validation:
Verify user authentication before processing purchase
Verify sufficient apple balance before deducting
Use atomic database operations to prevent double-spend
Validate cosmetic exists in config before allowing purchase
Prevent purchasing already-owned cosmetics (return error)
Equip Validation:
Verify cosmetic is in user's unlockedCosmetics array before equipping
Verify cosmetic category matches target slot
Reject equip requests for cosmetics user doesn't own
Data Integrity:
Sanitize cosmetic IDs (alphanumeric + underscore only)
Validate renderData doesn't contain executable code
Load cosmetics config at server startup, cache in memory (don't reload per request)
Validate user input for slot names (only accept "trail", "headItem", "nameStyle")
Transaction Logging:
Log all cosmetic purchases (user ID, cosmetic ID, cost, timestamp)
Log all apple transactions (user ID, amount, reason, timestamp)
Enable audit trail for investigating balance discrepancies
11. EDGE CASES & ERROR HANDLING
11.1 Apple System Edge Cases
Edge Case: Apple spawns on player spawn location
Prevention: Validate apple spawn position has 200 unit buffer from all player spawn points
Fallback: If collision detected, regenerate spawn position up to 10 times
Final fallback: If no valid position after 10 attempts, don't spawn apple this game
Edge Case: Player disconnects while holding apple
Handling: Treat as death, trigger apple drop immediately
Apple position: Drop at player's last known head position
Broadcast: Send appleDropped event with reason "disconnect"
Edge Case: Server crash during game with apple
Handling: Apple state lost, no rewards distributed
Recovery: Next game starts fresh with new spawn determination
User impact: No false apple rewards, maintains fairness
Edge Case: Game ends exactly as player picks up apple
Handling: Server processes game end before pickup if simultaneous
Result: Pickup doesn't register, no apple reward
Alternative: If pickup processed first, reward given to pickup player
Edge Case: Two players die simultaneously, both near dropped apple
Handling: Neither player can pick it up (both dead)
Result: Apple remains on ground, other living players can pick it up
If no living players: Game ends, no apple reward
Edge Case: All players eliminated by boundary at same instant
Handling: Determine winner by last alive timestamp
Apple handling: If winner was holding apple before death, they receive reward
If apple was free: No reward distributed
Edge Case: Apple spawns in Dream mode but player plays paid mode
Prevention: Each game room is independent, apple spawn determined per-game
No cross-contamination: Dream and paid lobbies have separate game rooms
11.2 Cosmetics System Edge Cases
Edge Case: User purchases cosmetic but server crashes before saving
Handling: Use database transactions if possible (MongoDB session)
Fallback: If transaction not possible, deduct apples first, then add cosmetic (fail-safe: user loses apples but we can refund manually)
Logging: Log purchase intent before processing, log completion after
Edge Case: User spends all apples on cosmetic, balance becomes 0
Handling: Normal behavior, balance can be 0
UI feedback: Show "0 Apples" clearly, disable purchase buttons for items user can't afford
Edge Case: User tries to equip cosmetic from wrong category to slot
Handling: Server rejects with error "invalid_slot"
Client prevention: UI should prevent this (only show trails for trail slot)
Edge Case: Cosmetic ID exists in user's unlocked array but not in config
Handling: Treat as invalid/missing cosmetic, don't crash
Rendering: Skip rendering for missing cosmetic, use default appearance
UI display: Show "Unknown Cosmetic" or hide from list
Edge Case: User equips cosmetic, then cosmetic is removed from config
Handling: Same as above, treat as missing
User experience: Next time they open cosmetics, equipped slot shows "Unknown" with option to clear
Edge Case: Two users equip same cosmetic
Handling: Normal behavior, cosmetics are not unique
Result: Both users render same cosmetic in game (perfectly acceptable)
11.3 Error Messages
Error: Insufficient Apples
Message: "You need [X] more apples to purchase [Cosmetic Name]."
Action: Close purchase modal, return to store
Error: Cosmetic Already Owned
Message: "You already own this cosmetic!"
Action: Change button to "Equip"
Error: Invalid Cosmetic
Message: "This cosmetic is no longer available."
Action: Hide cosmetic from store
Error: Authentication Required
Message: "Please connect your wallet to purchase cosmetics."
Action: Redirect to wallet connection
Error: Database Connection Lost
Message: "Connection lost. Please try again."
Action: Retry logic or prompt user to reload
Error: Server Error During Purchase
Message: "Purchase failed. Your apples have not been deducted. Please try again."
Action: Don't modify local state, allow retry
12. PERFORMANCE CONSIDERATIONS
12.1 Rendering Performance
Apple Rendering:
Free apple: 1 entity per game, minimal performance impact
Held apple: Calculated per-frame for 1 player, negligible cost
Animation: Use requestAnimationFrame, no heavy computations
Crown Rendering:
1 crown per game (only first place), minimal impact
Update position per-frame based on head position (simple calculation)
Cosmetics Rendering:
Trails: Most performance-intensive
Limit particle count per player (max 50 active particles)
Use object pooling for particles (reuse instead of create/destroy)
Cull particles outside camera view
Expected: 10-25 players × 50 particles = 500-1250 particles max
Head Items: Low impact (1 item per player, simple rendering)
Name Styles: Low impact (text rendering already exists, just apply styling)
Target Performance:
Maintain 60 FPS at 1080p with 25 players all using trail cosmetics
Maintain 30 FPS minimum on lower-end devices (integrated graphics)
12.2 Network Performance
Apple Events:
Spawn: 1 event per game start (~once every 5-10 minutes)
Pickup: Rare event (0-3 times per game)
Drop: Rare event (0-2 times per game)
Respawn: Rare event (0-1 times per game)
Total bandwidth: Negligible (<1 KB per game)
Cosmetics Events:
Load cosmetics: Once per session (~5-10 KB JSON)
Equip/unequip: Rare events (user-initiated)
Cosmetics broadcast: Sent with player join (adds ~50 bytes per player)
Total bandwidth: Minimal impact (<1% increase)

