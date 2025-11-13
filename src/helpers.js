// Helper utilities extracted from index.js to keep main logic clean.
import { MinHeap } from './MinHeap.js';

const DIRS = [
  [
    {dx: 0, dy: -1},
    {dx: 1, dy: 0},
    {dx: 0, dy: 1},
    {dx: -1, dy: 0}
  ],
  [
    {dx: 0, dy: -2},
    {dx: 2, dy: 0},
    {dx: 0, dy: 2},
    {dx: -2, dy: 0}
  ],
  [
    {dx: 0, dy: -3},
    {dx: 3, dy: 0},
    {dx: 0, dy: 3},
    {dx: -3, dy: 0}
  ]
];

// Constants
const MAP_SIZE = 16;
const BOMBER_SIZE = 35;
const WALL_SIZE = 40;

// Cache for positions that will never destroy any chests (count = 0)
// Key: `${x},${y},${range}` - positions that have been checked and found to destroy 0 chests
// Using Set for O(1) lookup performance
const zeroChestCache = new Set();

function isWalkable(map, x, y, isGrid = true) {
  if (!map || y < 0 || x < 0) return false;

  if (isGrid) {
    // Grid coordinate check
    const v = map[y][x];
    return v === null || v === 'B' || v === 'R' || v === 'S';
  } else {
    // Real coordinate check - unchanged
    const { bomberRight, bomberBottom } = getBomberBound({x, y});
    const gridRight = (bomberRight - 0.5) / WALL_SIZE | 0;
    const gridBottom = (bomberBottom - 0.5) / WALL_SIZE | 0;

    for (let gridY = Math.floor(y / WALL_SIZE); gridY <= gridBottom; gridY++) {
      for (let gridX = Math.floor(x / WALL_SIZE); gridX <= gridRight; gridX++) {
        const v = map[gridY][gridX];
        if (v !== null && v !== 'B' && v !== 'R' && v !== 'S') {
          return false;
        }
      }
    }

    return true;
  }
}

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function toGridCoord(pos) {
  return { x: Math.round(pos.x / WALL_SIZE), y: Math.round(pos.y / WALL_SIZE) };
}

function toMapCoord(gridPos) {
  return { x: gridPos.x * WALL_SIZE, y: gridPos.y * WALL_SIZE };
}

function toMapCoordAdvance(myBomber, gridPos) {
  const isBomberRight = myBomber.x > gridPos.x * WALL_SIZE
  const isBomberDown = myBomber.y > gridPos.y * WALL_SIZE

  return {
    x: (gridPos.x * WALL_SIZE) + (isBomberRight ? 5 : 0),
    y: (gridPos.y * WALL_SIZE) + (isBomberDown ? 5 : 0)
  };
}

function getBomberBound(bomber) {
  const bomberRight = bomber.x + BOMBER_SIZE;
  const bomberBottom = bomber.y + BOMBER_SIZE;
  return {
    bomberRight,
    bomberBottom
  }
}

// A* Search (improved version of findPathToTarget)
function findPathToTarget(myBomber, target, map, isGrid = true) {
  if (!myBomber || !target || !map) return null;

  const start = isGrid ? toGridCoord(myBomber) : { x: myBomber.x, y: myBomber.y };
  const goal = isGrid ? toGridCoord(target) : { x: target.x, y: target.y };

  const visited = new Set();
  const cameFrom = new Map();

  // Priority queue sorted by f = g + h
  const open = new MinHeap((a, b) => a.f - b.f);
  const openSet = new Set([`${start.x},${start.y}`]);
  const distance = manhattanDistance(start, goal)

  const startNode = {
    x: start.x,
    y: start.y,
    g: 0,
    h: distance,
    f: distance
  };
  open.push(startNode);
  const dirs = isGrid ? DIRS[0] : DIRS[myBomber.speed - 1]

  while (!open.isEmpty()) {
    const current = open.pop();
    openSet.delete(`${current.x},${current.y}`);

    const dist = chebyshevDistance(current, goal);
    if (isGrid ? current.x === goal.x && current.y === goal.y : dist <= (myBomber.speed - 1)) {
      // reconstruct path
      const path = [];
      let step = current;
      while (step) {
        path.push({ x: step.x, y: step.y });
        step = cameFrom.get(`${step.x},${step.y}`);
      }
      return path.reverse();
    }

    visited.add(`${current.x},${current.y}`);

    for (const dir of dirs) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const key = `${nx},${ny}`;

      if (!isWalkable(map, nx, ny, isGrid) && !(nx === goal.x && ny === goal.y)) continue;
      if (visited.has(key)) continue;

      const g = current.g + 1;
      const h = manhattanDistance({ x: nx, y: ny }, goal);
      const f = g + h;

      if (!openSet.has(key)) {
        cameFrom.set(key, current);
        open.push({ x: nx, y: ny, g, h, f });
        openSet.add(key);
      } else {
        // nếu node đã nằm trong openSet mà có đường tốt hơn => cập nhật
        const existing = open.data.find(n => n.x === nx && n.y === ny);
        if (existing && g < existing.g) {
          existing.g = g;
          existing.f = g + existing.h;
          cameFrom.set(key, current);
          open._bubbleUp(); // đảm bảo heap sắp lại đúng
        }
      }
    }
  }

  return null;
}

function createDangerZonesForBomb(bomb, explosionRange, map, dangerZones) {
  if (!bomb) return [];

  const { x, y } = toGridCoord(bomb);
  const now = Date.now();

  const existingZone = dangerZones && dangerZones.find(z => z.x === x && z.y === y && z.explodeAt > now);
  const explodeAt = existingZone ? existingZone.explodeAt : now + 5000;

  const zones = [];
  zones.push({ bombId: bomb.id, x, y, explodeAt });

  for (const dir of DIRS[0]) {
    for (let i = 1; i <= explosionRange; i++) {
      const nx = x + dir.dx * i;
      const ny = y + dir.dy * i;
      if (!isWalkable(map, nx, ny)) break;
      zones.push({ bombId: bomb.id, x: nx, y: ny, explodeAt });
    }
  }

  return zones;
}

function removeDangerZonesForBomb(dangerArr, bombId) {
  if (!Array.isArray(dangerArr)) return [];
  return dangerArr.filter(z => z.bombId !== bombId);
}

function upsertItem(itemsArr, payload, key = 'uid') {
  const id = payload && payload[key];
  if (!id) return;
  const idx = itemsArr.findIndex(i => i && i[key] === id);
  if (idx !== -1) {
    itemsArr[idx] = { ...itemsArr[idx], ...payload };
  } else {
    itemsArr.push(payload);
  }
}

function isInDanger(myBomber, DANGER_ZONE, checkTime = false) {
  if (!myBomber || DANGER_ZONE.length === 0) return false;

  const { bomberRight, bomberBottom } = getBomberBound(myBomber)

  return DANGER_ZONE.some(zone => {
    const tileLeft = zone.x * WALL_SIZE;
    const tileRight = (zone.x + 1) * WALL_SIZE;
    const tileTop = zone.y * WALL_SIZE;
    const tileBottom = (zone.y + 1) * WALL_SIZE;

    const overlapX = myBomber.x < tileRight && bomberRight > tileLeft;
    const overlapY = myBomber.y < tileBottom && bomberBottom > tileTop;

    if (!overlapX || !overlapY) return false;

    return checkTime ? (zone.explodeAt - Date.now() <= 1000) : true;
  });
}

function findNearestSafetyZone(myBomber, map, dangerArr) {
  const currentGridPos = toGridCoord(myBomber);

  if (dangerArr.length === 0) return currentGridPos;

  const dangerSet = new Set(dangerArr.map(z => `${z.x},${z.y}`));
  const openSet = new MinHeap((a, b) => a.f - b.f); // hàng đợi ưu tiên theo f = g + h
  const visited = new Set();

  const start = {
    x: currentGridPos.x,
    y: currentGridPos.y,
    g: 0,
    h: 0,
    f: 0,
  };
  openSet.push(start);

  while (!openSet.isEmpty()) {
    const node = openSet.pop();
    const key = `${node.x},${node.y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    // Nếu node hiện tại là safe => return
    if (!dangerSet.has(key)) {
      return { x: node.x, y: node.y };
    }

    for (const dir of DIRS[0]) {
      const nx = node.x + dir.dx;
      const ny = node.y + dir.dy;
      const nextKey = `${nx},${ny}`;

      if (
        ny >= 0 &&
        ny < map.length &&
        nx >= 0 &&
        nx < map[0].length &&
        isWalkable(map, nx, ny) &&
        !visited.has(nextKey)
      ) {
        const g = node.g + 1;
        const h = manhattanDistance({ x: nx, y: ny }, currentGridPos);
        const f = g + h;
        openSet.push({ x: nx, y: ny, g, h, f });
      }
    }
  }

  return null;
}

// Return array of grid coords that form the cross-shaped danger area for a bomb.
// bomb: { x, y }
// range: integer >= 0
function getBombCrossZones(bomb, range = 2) {
  if (!bomb || typeof bomb.x !== 'number' || typeof bomb.y !== 'number') return [];
  const zones = [];
  // center
  zones.push({ x: bomb.x, y: bomb.y });
  for (let i = 1; i <= range; i++) {
    zones.push({ x: bomb.x - i, y: bomb.y }); // left
    zones.push({ x: bomb.x + i, y: bomb.y }); // right
    zones.push({ x: bomb.x, y: bomb.y - i }); // up
    zones.push({ x: bomb.x, y: bomb.y + i }); // down
  }
  return zones;
}

// path: array of grid coordinates [{x, y}, ...]
function getMidPoint(path, bias = 1) {
  const a = path[path.length - 2];
  const b = path[path.length - 1];
  const first = path[0]

  if (a.x === b.x) {
    // di chuyển theo trục Y
    const directionY = Math.sign(b.y - a.y);
    return {
      x: a.x * WALL_SIZE + (first.x > a.x ? 5 : 0),
      y: ((a.y + b.y) / 2) * WALL_SIZE + directionY * bias + (first.y > a.y ? 5 : 0),
    };
  } else {
    // di chuyển theo trục X
    const directionX = Math.sign(b.x - a.x);
    return {
      x: ((a.x + b.x) / 2) * WALL_SIZE + directionX * bias + (first.x > a.x ? 5 : 0),
      y: a.y * WALL_SIZE + (first.y >= a.y ? 5 : 0),
    };
  }
}

// Count how many chests would be destroyed by a bomb placed at grid (x,y)
// Explosion travels in 4 directions up to `range`, stops at walls ('W') and also
// stops after destroying a chest ('C'). Walkable tiles are null | 'B' | 'R' | 'S'.
// Uses Set cache to optimize repeated calls. If position is in cache, it will never destroy any chests.
function countChestsDestroyedAt(map, x, y, range = 2) {
  const cacheKey = `${x},${y},${range}`;

  // Check cache first - if key exists, this position will never destroy any chests
  // (chests can only be destroyed, never created)
  if (zeroChestCache.has(cacheKey)) {
    return 0;
  }

  let destroyed = 0;
  for (const dir of DIRS[0]) {
    for (let step = 1; step <= range; step++) {
      const nx = x + dir.dx * step;
      const ny = y + dir.dy * step;
      const tile = map[ny][nx];
      if (tile === 'W') break; // blocked by wall
      if (tile === 'C') { destroyed += 1; break; } // destroy chest and stop
      // else walkable/null or item; continue propagation
    }
  }

  // Cache the result if count is 0
  // If result is 0, it will never increase (chests can only be destroyed)
  if (destroyed === 0) {
    zeroChestCache.add(cacheKey);
  }

  return destroyed;
}

// Clear the chest count cache
// Only needed when the entire map is reset (e.g., new game, blindCodeMode)
// Note: We don't need to invalidate cache when individual chests are destroyed because:
// - If a position had count = 0 (can't destroy any chests), it will still be 0 after chest destruction
// - Chests can only be destroyed, never created, so count can only decrease or stay the same
function clearChestCountCache() {
  zeroChestCache.clear();
}

// Find all possible bomb placement positions that destroy chests and have safe escape routes
// Returns array of { x, y, score } sorted by score (chests destroyed)
// Optimized with cache to skip positions that will never destroy chests
function findAllPossiblePlaceBoom(myBomber, map, walkableNeighbors = [], dangerZones = []) {
  if (!myBomber || !map) return [];

  const myGridPos = toGridCoord(myBomber);
  const results = [];
  const explosionRange = myBomber.explosionRange || 2;

  // Get all walkable neighbors if not provided
  const neighbors = walkableNeighbors.length > 0 ? walkableNeighbors : getWalkableNeighbors(map, myGridPos);

  for (const position of neighbors) {
    const cacheKey = `${position.x},${position.y},${explosionRange}`;

    // Check cache first - if key exists in Set, skip immediately (count = 0)
    if (zeroChestCache.has(cacheKey)) {
      continue; // This position will never destroy any chests
    }

    // Count chests that would be destroyed at this position
    const chestsDestroyed = countChestsDestroyedAt(map, position.x, position.y, explosionRange);

    if (chestsDestroyed === 0) continue; // Skip positions that don't destroy any chests

    // Check if there's a safe zone reachable from this position
    const safeZoneFound = countSafeZonesAfterPlaceBoom(
      toMapCoord(position),
      explosionRange,
      dangerZones,
      map,
      walkableNeighbors
    )

    if (safeZoneFound) {
      results.push({
        x: position.x,
        y: position.y,
        score: chestsDestroyed
      });
    }
  }

  // Sort by score (chests destroyed) in descending order
  return results.sort((a, b) => b.score - a.score);
}

// Find all walkable neighbors from a position using flood fill BFS.
// Returns array of { x, y } grid coordinates that are reachable from the starting position.
function getWalkableNeighbors(map, position) {
  const { x: startCol, y: startRow } = toGridCoord(position);

  const visited = new Set();
  const queue = [{ row: startRow, col: startCol }];
  const result = [];

  const key = (r, c) => `${r},${c}`;

  while (queue.length > 0) {
    const { row, col } = queue.shift();
    if (visited.has(key(row, col))) continue;
    if (map[row][col] === 'W' || map[row][col] === 'C') continue;

    visited.add(key(row, col));
    result.push({ x: col, y: row });

    for (const { dx, dy } of DIRS[0]) {
      queue.push({ row: row + dy, col: col + dx });
    }
  }

  return result;
}

// position are grid coords
function countSafeZonesAfterPlaceBoom(position, explosionRange, dangerArr, map, walkableNeighbors = []) {
  if (!walkableNeighbors) walkableNeighbors = getWalkableNeighbors(map, {x: position.x, y: position.y});
  if (walkableNeighbors.length === 0) return null;

  let updatedDangerZone = [...dangerArr];
  updatedDangerZone = createDangerZonesForBomb(position, explosionRange, map).concat(updatedDangerZone)

  const dangerSet = new Set();
  const pushToSet = (p) => {
    const key = `${p.x},${p.y}`;
    dangerSet.add(key);
  };
  for (let i = 0; i < updatedDangerZone.length; i++) {
    pushToSet(updatedDangerZone[i]);
  }

  let safeCount = 0;
  for (const w of walkableNeighbors) {
    if (!w || typeof w.x !== 'number' || typeof w.y !== 'number') continue;
    const key = `${w.x},${w.y}`;
    if (!dangerSet.has(key)) safeCount++;
  }

  return safeCount;
}

function markOwnBombOnMap(myBomber, bombs, map, gameStartAt) {
  if (!myBomber || !bombs || !map) return;

  for (const bomb of bombs) {
    if (bomb.ownerName !== myBomber.name && Date.now() - gameStartAt < 60) continue;

    const gridCoord = toGridCoord(bomb)
    if (map[gridCoord.y][gridCoord.x] == 'W') continue;

    const { bomberRight, bomberBottom } = getBomberBound(myBomber)
    const bombRight = bomb.x + WALL_SIZE;
    const bombBottom = bomb.y + WALL_SIZE;

    const overlapX = myBomber.x < bombRight && bomberRight > bomb.x;
    const overlapY = myBomber.y < bombBottom && bomberBottom > bomb.y;

    if (!(overlapX && overlapY)) {
      map[gridCoord.y][gridCoord.x] = 'W'
      return true;
    }
  }
}

function findChestBreakScoresToFrozen(myBomber, frozenBots, map) {
  if (!myBomber || !Array.isArray(frozenBots) || !map || map.length === 0) return [];

  const results = [];
  const INF = 1e9;

  const start = toGridCoord(myBomber);

  for (const bot of frozenBots) {
    if (!bot) continue;

    const target = toGridCoord(bot);

    // 0-1 BFS
    const g = Array.from({ length: MAP_SIZE }, () => Array(MAP_SIZE).fill(INF));
    const parent = Array.from({ length: MAP_SIZE }, () => Array(MAP_SIZE).fill(null));
    const deque = [];

    g[start.y][start.x] = 0;
    deque.push({ x: start.x, y: start.y });

    while (deque.length > 0) {
      const cur = deque.shift();
      const { x, y } = cur;

      if (x === target.x && y === target.y) break;

      for (const { dx, dy } of DIRS[0]) {
        const nx = x + dx;
        const ny = y + dy;

        const tile = map[ny][nx];
        if (tile === 'W') continue;

        const cost = tile === 'C' ? 1 : 0;
        const tentative = g[y][x] + cost;

        if (tentative < g[ny][nx]) {
          g[ny][nx] = tentative;
          parent[ny][nx] = { x, y };

          if (cost === 0) deque.unshift({ x: nx, y: ny }); // ưu tiên ô trống
          else deque.push({ x: nx, y: ny }); // chest -> đẩy ra sau
        }
      }
    }

    const dist = g[target.y][target.x];
    if (dist === INF) continue; // không đến được

    // Truy ngược đường đi
    const path = [];
    let cur = { x: target.x, y: target.y };
    while (cur) {
      path.push(cur);
      cur = parent[cur.y]?.[cur.x] || null;
    }

    // Lọc các ô chest trên đường
    const chests = path.filter(({ x, y }) => map[y][x] === 'C').reverse();

    results.push({
      id: bot.uid || bot.id,
      score: dist,
      chests,
    });
  }

  return results;
}

function coveredTiles(bomber, MAP) {
  if (!bomber || !MAP) return []

  // Tọa độ pixel của khung bao quanh bomber
  const { bomberRight, bomberBottom } = getBomberBound(bomber)

  // Tính các chỉ số ô (tile) mà bomber đang chiếm
  const tx0 = (bomber.x / WALL_SIZE) | 0;
  const ty0 = (bomber.y / WALL_SIZE) | 0;
  const tx1 = ((bomberRight - 0.5) / WALL_SIZE) | 0;
  const ty1 = ((bomberBottom - 0.5) / WALL_SIZE) | 0;

  const tiles = [];
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      if (MAP[y]?.[x] === 'W') continue; // bỏ qua tường
      tiles.push({ x, y });
    }
  }

  return tiles;
}

function findBombPositionsForEnemyArea(myBomber, enemy, map) {
  const tiles = coveredTiles(enemy, map);
  if (tiles.length === 0) return [];

  const resultsMap = new Map(); // key = x*1000 + y

  const myPos = {
    x: (myBomber.x / WALL_SIZE) | 0,
    y: (myBomber.y / WALL_SIZE) | 0
  };
  const enemyPos = {
    x: (enemy.x / WALL_SIZE) | 0,
    y: (enemy.y / WALL_SIZE) | 0
  };

  for (const tile of tiles) {
    for (const { dx, dy } of DIRS[0]) {
      for (let step = 1; step <= myBomber.explosionRange; step++) {
        const tx = tile.x + dx * step;
        const ty = tile.y + dy * step;
        if (map[ty][tx] === 'W') break;

        const key = tx * 1000 + ty;
        resultsMap.set(key, { x: tx, y: ty });
      }
    }
  }

  return Array.from(resultsMap.values())
    .map((position) => ({
      x: position.x,
      y: position.y,
      h: manhattanDistance(position, myPos),
      enemyH: manhattanDistance(position, enemyPos),
    }))
    .filter(p => p.enemyH < 2)
    .sort((a, b) => a.h - b.h);
}

function hasChestLeft(map) {
  return map.flat().filter(tile => tile === 'C').length >= 20;
}

function bombPositionsForChest(myBomber, chestTile, map, walkableNeighbors) {
  const { x, y } = chestTile;
  const resultsSet = new Set();

  for (const { dx, dy } of DIRS[0]) {
    for (let step = 1; step <= myBomber.explosionRange; step++) {
      const tx = x + dx * step;
      const ty = y + dy * step;
      // nếu ra ngoài hoặc chạm tường thì dừng quét hướng này (tường chặn vụ nổ)
      if (!isWalkable(map,tx, ty)) break;
      resultsSet.add(`${tx},${ty}`);
    }
  }

  // chuyển set -> array, có thể trả pixel center nếu cần
  let positions = Array.from(resultsSet, k => {
    const [tx, ty] = k.split(',').map(Number);
    return {
      x: tx,
      y: ty,
    };
  });

  positions = positions.filter(p => walkableNeighbors.some(w => w.x === p.x && w.y === p.y));

  return positions;
}

function isDeadCorner(position, map, isGrid = false) {
  const { x, y } = isGrid ? position : toGridCoord(position);
  let boomPlace = null;

  let free = 0;
  for (const d of DIRS[0]) {
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (
      isWalkable(map, nx, ny)
    ) {
      free++;
      boomPlace = { x: nx, y: ny }
    }
  }
  if (free < 2) {
    return boomPlace
  } else {
    return false
  }
}

/**
 * Find the nearest safe zone reachable from a given position using BFS.
 * If multiple zones have the same distance, choose the one with most walkable neighbors.
 * Excludes dead corners from consideration.
 * @param {Object} startPos - Starting position {x, y} in grid coordinates
 * @param {Array<Array>} map - The game map
 * @param {Array<Object>} dangerZones - Array of dangerous positions to avoid
 * @returns {Object|null} - Nearest safe zone {x, y, distance, walkableNeighbors} or null if none found
 */
function findAllSafeZones(startPos, map, dangerZones = []) {
  if (!startPos || !map) return null;

  // Create a Set for O(1) danger zone lookups
  const dangerSet = new Set(dangerZones.map(zone => `${zone.x},${zone.y}`));

  // Queue for BFS: stores {x, y, distance}
  const queue = [{ x: startPos.x, y: startPos.y, distance: 0 }];

  // Visited set to avoid processing the same cell multiple times
  const visited = new Set([`${startPos.x},${startPos.y}`]);

  // Store candidates at the nearest distance
  let nearestDistance = Infinity;
  const candidates = [];

  // Helper function to count walkable neighbors
  const countWalkableNeighbors = (x, y) => {
    let count = 0;
    for (const dir of DIRS[0]) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (
        nx >= 0 && nx < map[0].length &&
        ny >= 0 && ny < map.length &&
        isWalkable(map, nx, ny)
      ) {
        count++;
      }
    }
    return count;
  };

  while (queue.length > 0) {
    const current = queue.shift();

    // If we've found candidates and current distance is greater, stop searching
    if (current.distance > nearestDistance) {
      break;
    }

    // Check if current position is safe (including the start position)
    if (!dangerSet.has(`${current.x},${current.y}`)) {
      // Check if it's a dead corner
      const deadCornerResult = isDeadCorner(current, map, true);

      // isDeadCorner returns false if NOT a dead corner, or a position if it IS a dead corner
      if (deadCornerResult === false) {
        // Not a dead corner, this is a valid safe zone
        const walkableNeighbors = countWalkableNeighbors(current.x, current.y);

        if (current.distance < nearestDistance) {
          // Found a closer safe zone, reset candidates
          nearestDistance = current.distance;
          candidates.length = 0;
          candidates.push({
            x: current.x,
            y: current.y,
            distance: current.distance,
            walkableNeighbors
          });
        } else if (current.distance === nearestDistance) {
          // Same distance, add to candidates
          candidates.push({
            x: current.x,
            y: current.y,
            distance: current.distance,
            walkableNeighbors
          });
        }
      }
    }

    // Check all 4 directions
    for (const dir of DIRS[0]) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const key = `${nx},${ny}`;

      // Check if the next position is valid and not visited
      if (
        nx >= 0 && nx < map[0].length &&  // within x bounds
        ny >= 0 && ny < map.length &&     // within y bounds
        isWalkable(map, nx, ny) &&        // walkable tile
        !visited.has(key)                 // not visited yet
      ) {
        visited.add(key);
        queue.push({ x: nx, y: ny, distance: current.distance + 1 });
      }
    }
  }

  // If no safe zones found, return null
  if (candidates.length === 0) {
    return null;
  }

  // Sort candidates by walkableNeighbors (most walkable first)
  candidates.sort((a, b) => b.walkableNeighbors - a.walkableNeighbors);

  // Return the best candidate
  return candidates;
}

export {
  DIRS,
  isWalkable,
  manhattanDistance,
  chebyshevDistance,
  findAllSafeZones,
  toGridCoord,
  findPathToTarget,
  createDangerZonesForBomb,
  removeDangerZonesForBomb,
  upsertItem,
  isInDanger,
  findNearestSafetyZone,
  MAP_SIZE,
  BOMBER_SIZE,
  WALL_SIZE,
  getBombCrossZones,
  toMapCoord,
  toMapCoordAdvance,
  getMidPoint,
  getWalkableNeighbors,
  countSafeZonesAfterPlaceBoom,
  countChestsDestroyedAt,
  findAllPossiblePlaceBoom,
  clearChestCountCache,
  markOwnBombOnMap,
  findChestBreakScoresToFrozen,
  coveredTiles,
  findBombPositionsForEnemyArea,
  hasChestLeft,
  bombPositionsForChest,
  isDeadCorner,
  getBomberBound,
};
