import { Vector2, Snake, SnakeSegment } from './types.js';
import { config } from './config.js';

export class Physics {
  /**
   * Configuration constants for snake mechanics
   * STARTING_LENGTH is derived from config.game.startingMass (for backwards compatibility)
   * Each ~8 mass = 1 segment, so 250 mass = ~30 segments
   */
  static readonly STARTING_LENGTH = Math.max(10, Math.floor(config.game.startingMass / 8)); // Convert mass to segments
  static readonly SEGMENT_DISTANCE = 17; // pixels between segments
  static readonly ROTATION_SPEED = 2.5; // radians per second
  static readonly NORMAL_SPEED = 130; // units per second
  static readonly BOOST_SPEED = 200; // units per second
  static readonly BOOST_COST_INTERVAL = 0.5; // seconds between losing segments
  static readonly MIN_BOOST_LENGTH = 10; // minimum segments to allow boost
  static readonly HEAD_RADIUS = 12; // pixels
  static readonly SEGMENT_RADIUS = 10; // pixels
  static readonly SELF_COLLISION_DELAY = 1.0; // Seconds before can hit own body
  static readonly PELLETS_PER_SEGMENT = 0.5; // 1 pellet per 2 segments
  static readonly DEATH_PELLET_SPREAD = 10; // Random offset range for pellet spawn

  /**
   * Calculate the angle from point A to point B
   * Returns angle in radians
   */
  static calculateAngle(x1: number, y1: number, x2: number, y2: number): number {
    return Math.atan2(y2 - y1, x2 - x1);
  }

  /**
   * Normalize an angle to be between -PI and PI
   */
  static normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * Calculate the shortest angular distance between two angles
   * Returns value between -PI and PI
   */
  static angleDifference(from: number, to: number): number {
    let diff = to - from;
    diff = this.normalizeAngle(diff);
    return diff;
  }

  /**
   * Rotate current angle toward target angle (smooth rotation)
   * @param currentAngle Current angle in radians
   * @param targetAngle Target angle in radians
   * @param rotationSpeed Rotation speed in radians per second
   * @param deltaTime Time delta in seconds
   * @returns New angle in radians
   */
  static rotateToward(
    currentAngle: number,
    targetAngle: number,
    rotationSpeed: number,
    deltaTime: number
  ): number {
    const diff = this.angleDifference(currentAngle, targetAngle);
    const maxRotation = rotationSpeed * deltaTime;

    if (Math.abs(diff) <= maxRotation) {
      return targetAngle;
    } else if (diff > 0) {
      return currentAngle + maxRotation;
    } else {
      return currentAngle - maxRotation;
    }
  }

  /**
   * Get current speed based on whether snake is boosting (with stat multiplier)
   * Speed increase is 10% of mass increase (so 5x mass = 1.4x speed)
   */
  static getCurrentSpeed(snake: Snake): number {
    const baseSpeed = snake.isBoosting ? this.BOOST_SPEED : this.NORMAL_SPEED;
    const statMultiplier = snake.statMultiplier || 1;
    
    // Speed gets 10% of the mass multiplier bonus
    const speedMultiplier = 1 + ((statMultiplier - 1) * 0.1);
    
    return baseSpeed * speedMultiplier;
  }

  /**
   * Move snake head based on angle and speed
   * Updates head position and velocity
   */
  static moveSnakeHead(snake: Snake, deltaTime: number): void {
    // Calculate target angle toward mouse position
    const head = snake.segments[0];
    const targetAngle = this.calculateAngle(head.x, head.y, snake.targetX, snake.targetY);

    // Smoothly rotate toward target
    snake.angle = this.rotateToward(snake.angle, targetAngle, this.ROTATION_SPEED, deltaTime);

    // Calculate velocity based on current angle and speed
    const speed = this.getCurrentSpeed(snake);
    snake.velocity.x = Math.cos(snake.angle) * speed;
    snake.velocity.y = Math.sin(snake.angle) * speed;

    // Create new head position
    const newHeadX = head.x + snake.velocity.x * deltaTime;
    const newHeadY = head.y + snake.velocity.y * deltaTime;

    // Add current head position to path history
    snake.headPath.unshift({ x: head.x, y: head.y });

    // Limit head path size to prevent memory issues
    // Keep enough history for all segments to follow
    const maxPathLength = snake.length * 3;
    if (snake.headPath.length > maxPathLength) {
      snake.headPath = snake.headPath.slice(0, maxPathLength);
    }

    // Update head position
    snake.segments[0] = { x: newHeadX, y: newHeadY };
  }

  /**
   * Update body segments to follow head path
   * Each segment follows the position in the head path that is the preferred distance away
   */
  static updateSnakeBody(snake: Snake): void {
    if (snake.segments.length <= 1) return;

    const preferredDistance = this.SEGMENT_DISTANCE;
    let currentIndex = 0;

    for (let i = 1; i < snake.segments.length; i++) {
      // Find the point in head path that is preferredDistance away from previous segment
      currentIndex = this.findNextSegmentPosition(snake.headPath, currentIndex, preferredDistance);

      if (currentIndex < snake.headPath.length) {
        snake.segments[i] = { ...snake.headPath[currentIndex] };
      }
    }
  }

  /**
   * Find the index in head path where next segment should be placed
   * Based on accumulated distance from current index
   */
  static findNextSegmentPosition(
    headPath: SnakeSegment[],
    startIndex: number,
    targetDistance: number
  ): number {
    let accumulatedDistance = 0;
    let currentIndex = startIndex;

    while (currentIndex + 1 < headPath.length) {
      const p1 = headPath[currentIndex];
      const p2 = headPath[currentIndex + 1];
      const segmentDistance = this.distance(p1.x, p1.y, p2.x, p2.y);

      if (accumulatedDistance + segmentDistance >= targetDistance) {
        // Found the right segment, check if current or next index is closer
        const remainingDistance = targetDistance - accumulatedDistance;
        if (remainingDistance < segmentDistance / 2) {
          return currentIndex;
        } else {
          return currentIndex + 1;
        }
      }

      accumulatedDistance += segmentDistance;
      currentIndex++;
    }

    // Reached end of path, return last index
    return Math.min(currentIndex, headPath.length - 1);
  }

  /**
   * Calculate distance between two points
   */
  static distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Check collision between point (head) and circle (pellet or head)
   */
  static checkPointCircleCollision(
    x1: number,
    y1: number,
    r1: number,
    x2: number,
    y2: number,
    r2: number
  ): boolean {
    return this.distance(x1, y1, x2, y2) <= r1 + r2;
  }

  /**
   * Check if a point (head) collides with a line segment (body section)
   * Uses distance from point to line segment
   */
  static checkHeadBodyCollision(
    headX: number,
    headY: number,
    headRadius: number,
    seg1X: number,
    seg1Y: number,
    seg2X: number,
    seg2Y: number,
    bodyRadius: number
  ): boolean {
    const dist = this.distanceToLineSegment(headX, headY, seg1X, seg1Y, seg2X, seg2Y);
    return dist <= headRadius + bodyRadius;
  }

  /**
   * Calculate distance from point to line segment
   */
  static distanceToLineSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const lineLengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;

    if (lineLengthSquared === 0) {
      // Line segment is actually a point
      return this.distance(px, py, x1, y1);
    }

    // Calculate projection of point onto line
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / lineLengthSquared;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment

    // Find closest point on segment
    const closestX = x1 + t * (x2 - x1);
    const closestY = y1 + t * (y2 - y1);

    // Return distance to closest point
    return this.distance(px, py, closestX, closestY);
  }

  /**
   * Check if snake head can collide with its own body yet
   * (prevent instant death on spawn)
   */
  static canSelfCollide(snake: Snake, currentTime: number): boolean {
    return (currentTime - snake.spawnTime) >= this.SELF_COLLISION_DELAY * 1000;
  }

  /**
   * Add segments to snake tail
   * @param snake Snake to add segments to
   * @param count Number of segments to add
   */
  static addSegments(snake: Snake, count: number): void {
    const tail = snake.segments[snake.segments.length - 1];
    
    for (let i = 0; i < count; i++) {
      // Add new segment at tail position
      snake.segments.push({ x: tail.x, y: tail.y });
      snake.length++;
    }
  }

  /**
   * Remove segments from snake tail (for boost cost)
   * @param snake Snake to remove segments from
   * @param count Number of segments to remove
   * @returns Array of removed segment positions
   */
  static removeSegments(snake: Snake, count: number): SnakeSegment[] {
    const minLength = this.MIN_BOOST_LENGTH;
    const canRemove = Math.min(count, snake.length - minLength);
    
    if (canRemove > 0) {
      // Get the segments that will be removed (from the tail)
      const removedSegments = snake.segments.slice(snake.segments.length - canRemove);
      
      // Remove them from the snake
      snake.segments = snake.segments.slice(0, snake.segments.length - canRemove);
      snake.length -= canRemove;
      
      return removedSegments;
    }
    
    return [];
  }

  /**
   * Clamp position within map boundaries
   */
  static clampToMap(
    x: number,
    y: number,
    radius: number,
    mapWidth: number,
    mapHeight: number
  ): Vector2 {
    return {
      x: Math.max(radius, Math.min(mapWidth - radius, x)),
      y: Math.max(radius, Math.min(mapHeight - radius, y)),
    };
  }

  /**
   * Normalize a vector
   */
  static normalize(v: Vector2): Vector2 {
    const length = Math.sqrt(v.x * v.x + v.y * v.y);
    if (length === 0) return { x: 0, y: 0 };
    return {
      x: v.x / length,
      y: v.y / length,
    };
  }

  /**
   * Create initial snake segments
   * @param startX Starting X position
   * @param startY Starting Y position
   * @param angle Initial angle in radians
   * @param length Number of segments
   * @returns Array of segment positions
   */
  static createInitialSegments(
    startX: number,
    startY: number,
    angle: number,
    length: number
  ): SnakeSegment[] {
    const segments: SnakeSegment[] = [];
    const preferredDistance = this.SEGMENT_DISTANCE;

    // Create segments going backwards from head
    for (let i = 0; i < length; i++) {
      const offsetX = Math.cos(angle + Math.PI) * preferredDistance * i;
      const offsetY = Math.sin(angle + Math.PI) * preferredDistance * i;
      
      segments.push({
        x: startX + offsetX,
        y: startY + offsetY,
      });
    }

    return segments;
  }
}
