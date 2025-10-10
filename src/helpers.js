// Helper utilities extracted from index.js to keep main logic clean.
const DIRS = [
  {dx: 0, dy: -1},
  {dx: 1, dy: 0},
  {dx: 0, dy: 1},
  {dx: -1, dy: 0}
];

// Constants
const MAP_SIZE = 640;
const BOMBER_SIZE = 35;
const WALL_SIZE = 40;

function isWalkable(map, x, y) {
  if (!map || y < 0 || x < 0) return false;
  if (!map[y] || typeof map[y][x] === 'undefined') return false;
  const v = map[y][x];
  // Walls and chest are NOT walkable before destroyed
  return v === null || v === 'B' || v === 'R' || v === 'S';
}

function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function toGridCoord(pos) {
  return { x: Math.floor(pos.x / WALL_SIZE), y: Math.floor(pos.y / WALL_SIZE) };
}

// Greedy Best-First Search (kept simple and as in original)
function findPathToTarget(myBomber, target, map) {
  if (!myBomber || !target || !map) return null;

  const start = toGridCoord(myBomber, WALL_SIZE);
  const goal = toGridCoord(target, WALL_SIZE);

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

    for (const dir of DIRS) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      if (!isWalkable(map, nx, ny) && !(nx === goal.x && ny === goal.y)) continue;
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

  const explosionRange = placingBomber && typeof placingBomber.explosionRange === 'number'
    ? placingBomber.explosionRange
    : 2;

  const bombX = bomb.x; // already grid coords
  const bombY = bomb.y;

  const zones = [];
  zones.push({ bombId: bomb.id, x: bombX, y: bombY });

  for (const dir of DIRS) {
    for (let i = 1; i <= explosionRange; i++) {
      const nx = bombX + dir.dx * i;
      const ny = bombY + dir.dy * i;
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

function isInDanger(myBomber, bombsArr, bombersArr) {
  if (!myBomber) return false;
  if (!Array.isArray(bombsArr) || bombsArr.length === 0) return false;

  for (const bomb of bombsArr) {
    if (!bomb) continue;
    // determine explosion range from the placing bomber if available
    const placingBomber = Array.isArray(bombersArr) ? bombersArr.find(b => b && b.uid === bomb.uid) : null;
    const range = placingBomber && typeof placingBomber.explosionRange === 'number' ? placingBomber.explosionRange : 2;
    if (isBomberInBombCross(myBomber, bomb, range)) return true;
  }

  return false;
}

function findNearestSafetyZone(myBomber, map, dangerArr) {
  const currentGridPos = toGridCoord(myBomber, WALL_SIZE);
  if (!Array.isArray(dangerArr) || dangerArr.length === 0) return currentGridPos;
  const safePositions = [];
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (!isWalkable(map, x, y)) continue;
      const isSafe = !dangerArr.some(zone => zone.x === x && zone.y === y);
      if (isSafe) safePositions.push({ x, y });
    }
  }
  let nearestSafe = null;
  let bestDist2 = Infinity;
  for (const safePos of safePositions) {
    const dx = safePos.x - currentGridPos.x;
    const dy = safePos.y - currentGridPos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      nearestSafe = safePos;
    }
  }
  return nearestSafe;
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

module.exports = {
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
  isBomberInBombCross
};
