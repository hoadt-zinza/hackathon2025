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
const MAP_SIZE = 640;
const BOMBER_SIZE = 35;
const WALL_SIZE = 40;

function isWalkable(map, x, y, isGrid = true) {
  if (!map || y < 0 || x < 0) {
    console.log('map', map);
    console.log('x y', x, y);
    throw new Error('something wrong')
  }

  if (isGrid) {
    // Grid coordinate check - simple tile lookup
    const v = map[y][x];
    // Only walls ('W') are non-walkable
    return v === null || v === 'B' || v === 'R' || v === 'S';
  } else {
    // Real coordinate check - check if bomber's bounding box overlaps with walls
    // Position {x, y} is top-left corner of bomber (35x35 square)
    const bomberRight = x + BOMBER_SIZE;
    const bomberBottom = y + BOMBER_SIZE;

    // Calculate which grid tiles the bomber overlaps
    const gridRight = Math.floor((bomberRight - 0.5) / WALL_SIZE);
    const gridBottom = Math.floor((bomberBottom - 0.5) / WALL_SIZE);

    // Check all tiles that the bomber overlaps
    for (let gridY = Math.floor(y / WALL_SIZE); gridY <= gridBottom; gridY++) {
      for (let gridX = Math.floor(x / WALL_SIZE); gridX <= gridRight; gridX++) {
        const v = map[gridY][gridX];
        // If any overlapping tile is a wall ('W'), position is not walkable
        if (v !== null && v !== 'B' && v !== 'R' && v !== 'S') {
          return false;
        }
      }
    }

    return true;
  }
}

function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function toGridCoord(pos) {
  return { x: Math.round(pos.x / WALL_SIZE), y: Math.round(pos.y / WALL_SIZE) };
}

function toMapCoord(gridPos) {
  return { x: gridPos.x * WALL_SIZE, y: gridPos.y * WALL_SIZE };
}

// Greedy Best-First Search (kept simple and as in original)
function findPathToTarget(myBomber, target, map, isGrid = true) {
  if (!myBomber || !target || !map) return null;

  const start = isGrid ? toGridCoord(myBomber, WALL_SIZE) : { x: myBomber.x, y: myBomber.y };
  const goal = isGrid ? toGridCoord(target, WALL_SIZE) : { x: target.x, y: target.y };

  const visited = new Set();
  const cameFrom = new Map();

  // Dùng heap thay vì mảng
  const open = new MinHeap((a, b) => a.h - b.h);
  open.push({ ...start, h: heuristic(start, goal) });

  // Để tránh .find() (O(n)), ta có thể thêm một map theo key "x,y"
  const openSet = new Set([`${start.x},${start.y}`]);
  const dirs = isGrid ? DIRS[0] : DIRS[myBomber.speed - 1]

  while (!open.isEmpty()) {
    const current = open.pop();
    openSet.delete(`${current.x},${current.y}`);

    const dist = Math.max(Math.abs(current.x - goal.x), Math.abs(current.y - goal.y));
    if (isGrid ? current.x === goal.x && current.y === goal.y : dist <= (myBomber.speed - 1)) {
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
      if (!isWalkable(map, nx, ny, isGrid) && !(nx === goal.x && ny === goal.y)) continue;
      if (visited.has(`${nx},${ny}`)) continue;

      const key = `${nx},${ny}`;
      if (!openSet.has(key)) {
        cameFrom.set(key, current);
        open.push({ x: nx, y: ny, h: heuristic({ x: nx, y: ny }, goal) });
        openSet.add(key);
      }
    }
  }

  return null;
}

// A* Search (improved version of findPathToTarget)
function findPathToTargetAStar(myBomber, target, map, isGrid = true) {
  if (!myBomber || !target || !map) return null;

  const start = isGrid ? toGridCoord(myBomber, WALL_SIZE) : { x: myBomber.x, y: myBomber.y };
  const goal = isGrid ? toGridCoord(target, WALL_SIZE) : { x: target.x, y: target.y };

  const visited = new Set();
  const cameFrom = new Map();

  // Priority queue sorted by f = g + h
  const open = new MinHeap((a, b) => a.f - b.f);
  const openSet = new Set([`${start.x},${start.y}`]);

  const startNode = {
    x: start.x,
    y: start.y,
    g: 0,
    h: heuristic(start, goal),
    f: heuristic(start, goal)
  };
  open.push(startNode);
  const dirs = isGrid ? DIRS[0] : DIRS[myBomber.speed - 1]

  while (!open.isEmpty()) {
    const current = open.pop();
    openSet.delete(`${current.x},${current.y}`);

    const dist = Math.max(Math.abs(current.x - goal.x), Math.abs(current.y - goal.y));
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
      const h = heuristic({ x: nx, y: ny }, goal);
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


function createDangerZonesForBomb(bomb, explosionRange, map) {
  if (!bomb) return [];

  const { x, y } = toGridCoord(bomb);

  const zones = [];
  zones.push({ bombId: bomb.id, x: x, y: y });

  for (const dir of DIRS[0]) {
    for (let i = 1; i <= explosionRange; i++) {
      const nx = x + dir.dx * i;
      const ny = y + dir.dy * i;
      if (!isWalkable(map, nx, ny)) break;
      zones.push({ bombId: bomb.id, x: nx, y: ny });
    }
  }

  return zones;
}

function removeDangerZonesForBomb(dangerArr, bombId) {
  if (!Array.isArray(dangerArr)) return [];
  return dangerArr.filter(z => z.bombId !== bombId);
}

function upsertBomber(bombersArr, payload) {
  const uid = payload && payload.uid;
  if (!uid) return;

  const idx = bombersArr.findIndex(b => b && b.uid === uid);
  if (idx !== -1) {
    bombersArr[idx] = { ...bombersArr[idx], ...payload };
  } else {
    bombersArr.push(payload);
  }
}

function upsertBomb(bombsArr, payload) {
  const id = payload && payload.id;
  if (!id) return;
  const idx = bombsArr.findIndex(b => b && b.id === id);
  if (idx !== -1) {
    bombsArr[idx] = { ...bombsArr[idx], ...payload };
  } else {
    bombsArr.push(payload);
  }
}

function isInDanger(myBomber, DANGER_ZONE) {
  if (!myBomber || DANGER_ZONE.length == 0) return false;

  // Bomber position {x, y} is top-left corner of 35x35 square
  const bomberRight = myBomber.x + BOMBER_SIZE;
  const bomberBottom = myBomber.y + BOMBER_SIZE;

  // Check if bomber overlaps with any danger zone tile
  for (const zone of DANGER_ZONE) {
    // Danger zone tile occupies pixels [zone.x * WALL_SIZE, (zone.x + 1) * WALL_SIZE)
    const tileLeft = zone.x * WALL_SIZE;
    const tileRight = (zone.x + 1) * WALL_SIZE;
    const tileTop = zone.y * WALL_SIZE;
    const tileBottom = (zone.y + 1) * WALL_SIZE;

    // Check if rectangles overlap
    const overlapX = myBomber.x < tileRight && bomberRight > tileLeft;
    const overlapY = myBomber.y < tileBottom && bomberBottom > tileTop;

    if (overlapX && overlapY) {
      return true;
    }
  }

  return false;
}

function findNearestSafetyZone(myBomber, map, dangerArr) {
  const currentGridPos = toGridCoord(myBomber);

  if (dangerArr.length === 0) return { x: myBomber.x, y: myBomber.y };

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
        const h = heuristic({ x: nx, y: ny }, currentGridPos);
        const f = g + h;
        openSet.push({ x: nx, y: ny, g, h, f });
      }
    }
  }

  return { x: myBomber.x, y: myBomber.y }; // không tìm được safe zone reachable
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

// Check whether a grid point lies inside the bomb's cross area
function isPointInBombCross(point, bomb, range = 2) {
  if (!point || !bomb) return false;
  const dx = Math.abs(point.x - bomb.x);
  const dy = Math.abs(point.y - bomb.y);
  // same column within range or same row within range
  return (dx === 0 && dy <= range) || (dy === 0 && dx <= range);
}

// Convenience: check whether a bomber object (world coords) is inside the bomb cross
function isBomberInBombCross(myBomber, bomb, range = 2) {
  if (!myBomber || !bomb) return false;
  const grid = toGridCoord(myBomber);
  return isPointInBombCross(grid, bomb, range);
}

// path: array of REAL coordinates [{x, y}, ...]
function getMidPoint(path, bias = 1) {
  const a = path[path.length - 2];
  const b = path[path.length - 1];

  if (a.x === b.x) {
    // di chuyển theo trục Y
    const directionY = Math.sign(b.y - a.y);
    return {
      x: a.x * WALL_SIZE,
      y: ((a.y + b.y) / 2) * WALL_SIZE + directionY * bias,
    };
  } else {
    // di chuyển theo trục X
    const directionX = Math.sign(b.x - a.x);
    return {
      x: ((a.x + b.x) / 2) * WALL_SIZE + directionX * bias,
      y: a.y * WALL_SIZE,
    };
  }
}

// Count how many chests would be destroyed by a bomb placed at grid (x,y)
// Explosion travels in 4 directions up to `range`, stops at walls ('W') and also
// stops after destroying a chest ('C'). Walkable tiles are null | 'B' | 'R' | 'S'.
function countChestsDestroyedAt(map, x, y, range = 2) {
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

  return destroyed;
}

function findAllPossiblePlaceBoom(myBomber, map, walkableNeighbors = []) {
  if (!myBomber || !map) return null;
  const start = toGridCoord(myBomber);
  const range = myBomber.explosionRange;

  // Only consider reachable tiles from current position
  if (!walkableNeighbors) walkableNeighbors = getWalkableNeighbors(map, { x: myBomber.x, y: myBomber.y });
  if (walkableNeighbors.length === 0) return null;

  return walkableNeighbors.map(p => {
    return { x: p.x, y: p.y, score: countChestsDestroyedAt(map, p.x, p.y, range), dist: Math.abs(p.x - start.x) + Math.abs(p.y - start.y) };
  }).sort((a, b) => {
    return b.score - a.score; // higher score first
  }).filter(w => {
    return w.score != 0;
  })
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
    const key = `${Math.trunc(p.x)},${Math.trunc(p.y)}`;
    dangerSet.add(key);
  };
  for (let i = 0; i < updatedDangerZone.length; i++) {
    pushToSet(updatedDangerZone[i]);
  }

  let safeCount = 0;
  for (const w of walkableNeighbors) {
    if (!w || typeof w.x !== 'number' || typeof w.y !== 'number') continue;
    const key = `${Math.trunc(w.x)},${Math.trunc(w.y)}`;
    if (!dangerSet.has(key)) safeCount++;
  }

  return safeCount;
}

function markOwnBombOnMap(myBomber, bombs, map) {
  if (!myBomber || !bombs || !map) return;

  for (const bomb of bombs) {
    // chỉ xét bomb của mình
    if (bomb.ownerName !== myBomber.name) continue;
    if (map[bomb.y / WALL_SIZE][bomb.x / WALL_SIZE] == 'W') continue;

    // Tính bounding box
    const bomberRight = myBomber.x + BOMBER_SIZE;
    const bomberBottom = myBomber.y + BOMBER_SIZE;
    const bombRight = bomb.x + WALL_SIZE;
    const bombBottom = bomb.y + WALL_SIZE;

    // Kiểm tra overlap
    const overlapX = myBomber.x < bombRight && bomberRight > bomb.x;
    const overlapY = myBomber.y < bombBottom && bomberBottom > bomb.y;

    if (!(overlapX && overlapY)) {
      map[bomb.y / WALL_SIZE][bomb.x / WALL_SIZE] = 'W'
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
    const g = Array.from({ length: 16 }, () => Array(16).fill(INF));
    const parent = Array.from({ length: 16 }, () => Array(16).fill(null));
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

    const lastChest = chests[chests.length - 1];
    if (!lastChest) {
      console.log(`lastChest`, chests);
      throw new Exception('something wrong');
    } else {
      chests.push({
        x: Math.round((target.x + lastChest.x)/ 2),
        y: Math.round((target.y + lastChest.y) / 2)
      });
    }
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

  const { x, y } = bomber;

  // Tọa độ pixel của khung bao quanh bomber
  const bomberRight  = x + BOMBER_SIZE;
  const bomberBottom = y + BOMBER_SIZE;

  // Tính các chỉ số ô (tile) mà bomber đang chiếm
  const tx0 = Math.floor(bomber.x / WALL_SIZE);
  const ty0 = Math.floor(bomber.y  / WALL_SIZE);
  const tx1 = Math.floor((bomberRight  - 0.5) / WALL_SIZE);
  const ty1 = Math.floor((bomberBottom - 0.5) / WALL_SIZE);

  const tiles = [];
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      if (MAP[y][x] === 'W') continue; // bỏ qua tường
      tiles.push({ x, y });
    }
  }

  return tiles;
}

function findBombPositionsForEnemyArea(myBomber, enemy, map) {
  // tìm tất cả tile mà enemy phủ
  const tiles = coveredTiles(enemy, map)
  if (tiles.length === 0) return [];

  const dirs = DIRS[0]

  const resultsSet = new Set();

  // từ mỗi tile địch quét 4 hướng
  for (const tile of tiles) {
    for (const {dx, dy} of dirs) {
      for (let step = 1; step <= myBomber.explosionRange; step++) {
        const tx = tile.x + dx * step;
        const ty = tile.y + dy * step;
        if (map[ty][tx] === 'W') break; // wall chặn vụ nổ -> dừng quét hướng này
        resultsSet.add(`${tx},${ty}`);
      }
    }
  }

  // chuyển set -> array
  const results = Array.from(resultsSet, k => {
    const [x, y] = k.split(',').map(Number);
    const pos = { x: x, y: y }
    const h = heuristic({
      x: Math.floor(myBomber.x / WALL_SIZE),
      y: Math.floor(myBomber.y / WALL_SIZE)
    }, pos);
    const enemyH = heuristic({
      x: Math.floor(enemy.x / WALL_SIZE),
      y: Math.floor(enemy.y / WALL_SIZE)
    }, pos);

    return {
      x: x,
      y: y,
      h: h,
      enemyH: enemyH
    };
  });

  return results.sort((a, b) => (a.h + a.enemyH) - (b.h + b.enemyH));
}

function hasChestLeft(map) {
  return map.some(row => row.includes('C'));
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

export {
  DIRS,
  isWalkable,
  heuristic,
  toGridCoord,
  findPathToTarget,
  findPathToTargetAStar,
  createDangerZonesForBomb,
  removeDangerZonesForBomb,
  upsertBomber,
  upsertBomb,
  isInDanger,
  findNearestSafetyZone,
  MAP_SIZE,
  BOMBER_SIZE,
  WALL_SIZE,
  getBombCrossZones,
  isPointInBombCross,
  isBomberInBombCross,
  toMapCoord,
  getMidPoint,
  getWalkableNeighbors,
  countSafeZonesAfterPlaceBoom,
  countChestsDestroyedAt,
  findAllPossiblePlaceBoom,
  markOwnBombOnMap,
  findChestBreakScoresToFrozen,
  coveredTiles,
  findBombPositionsForEnemyArea,
  hasChestLeft,
  bombPositionsForChest,
};
