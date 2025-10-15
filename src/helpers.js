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
  if (!map || y < 0 || x < 0) return false;

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
    const gridLeft = Math.floor(x / WALL_SIZE);
    const gridTop = Math.floor(y / WALL_SIZE);
    const gridRight = Math.floor((bomberRight - 0.5) / WALL_SIZE);
    const gridBottom = Math.floor((bomberBottom - 0.5) / WALL_SIZE);

    // Check all tiles that the bomber overlaps
    for (let gridY = gridTop; gridY <= gridBottom; gridY++) {
      for (let gridX = gridLeft; gridX <= gridRight; gridX++) {
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

  const open = [{ ...start, h: heuristic(start, goal) }];

  while (open.length > 0) {
    open.sort((a, b) => a.h - b.h);
    const current = open.shift();

    if (current.x === goal.x && current.y === goal.y) {
      const path = [];
      let step = current;
      while (step) {
        path.push({ x: step.x, y: step.y });
        step = cameFrom.get(`${step.x},${step.y}`);
      }
      if (target.type === 'C') return path.reverse().slice(0, -1);
      return path.reverse();
    }

    visited.add(`${current.x},${current.y}`);

    for (const dir of DIRS[myBomber.speed - 1]) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      if (!isWalkable(map, nx, ny, isGrid) && !(nx === goal.x && ny === goal.y)) continue;
      if (visited.has(`${nx},${ny}`)) continue;
      if (!open.find(n => n.x === nx && n.y === ny)) {
        cameFrom.set(`${nx},${ny}`, current);
        open.push({ x: nx, y: ny, h: heuristic({ x: nx, y: ny }, goal) });
      }
    }
  }

  return null;
}

function createDangerZonesForBomb(bomb, placingBomber, map) {
  if (!bomb) return [];

  const explosionRange = placingBomber.explosionRange;
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

function findNearestChest(myBomber, chests) {
  if (!myBomber || !Array.isArray(chests) || chests.length === 0) return null;
  let nearest = null;
  let bestDist2 = Infinity;
  for (const chest of chests) {
    if (!chest || chest.isDestroyed) continue;
    const dx = (chest.x) - (myBomber.x);
    const dy = (chest.y) - (myBomber.y);
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      nearest = chest;
    }
  }
  return nearest;
}

function findNearestItem(myBomber, items) {
  if (!myBomber || !Array.isArray(items) || items.length === 0) return null;
  let nearest = null;
  let bestDist2 = Infinity;
  for (const item of items) {
    if (!item) continue;
    const dx = (item.x) - (myBomber.x);
    const dy = (item.y) - (myBomber.y);
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      nearest = item;
    }
  }
  return nearest;
}

function isInDanger(myBomber, DANGER_ZONE) {
  if (!myBomber) return false;

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
  const currentGridPos = toGridCoord(myBomber, WALL_SIZE);

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

    for (const dir of DIRS[myBomber.speed - 1]) {
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

function getMidPoint(path) {
  const a = path[path.length - 2];
  const b = path[path.length - 1];
  const bias = 1; // lệch 1px về phía b

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

//flood fill BFS to find walkable neighbors in real coordinates
function getWalkableNeighbors(map, position) {
  const { x: startCol, y: startRow } = toGridCoord(position);

  const visited = new Set();
  const queue = [{ row: startRow, col: startCol }];
  const result = [];

  const key = (r, c) => `${r},${c}`;

  while (queue.length > 0) {
    const { row, col } = queue.shift();
    if (visited.has(key(row, col))) continue;
    if (map[row][col] !== null) continue;

    visited.add(key(row, col));
    result.push({ x: col, y: row });

    for (const { dx, dy } of DIRS[0]) {
      queue.push({ row: row + dy, col: col + dx });
    }
  }

  return result;
}

function countSafeZonesAfterPlaceBoom(myBomber, dangerArr, map) {
  const walkableNeighbors = getWalkableNeighbors(map, {x: myBomber.x, y: myBomber.y});
  console.log('walkableNeighbors', walkableNeighbors);
  if (walkableNeighbors.length === 0) return null;

  let updatedDangerZone = [...dangerArr];
  const bombPos = { x: myBomber.x, y: myBomber.y };
  updatedDangerZone = createDangerZonesForBomb(bombPos, myBomber, map).concat(updatedDangerZone)

  const dangerSet = new Set();
  const pushToSet = (p) => {
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;
    const key = `${Math.trunc(p.x)},${Math.trunc(p.y)}`;
    dangerSet.add(key);
  };
  for (let i = 0; i < dangerArr.length; i++) {
    pushToSet(dangerArr[i]);
  }
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

export {
  DIRS,
  isWalkable,
  heuristic,
  toGridCoord,
  findPathToTarget,
  createDangerZonesForBomb,
  removeDangerZonesForBomb,
  upsertBomber,
  upsertBomb,
  findNearestChest,
  findNearestItem,
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
};
