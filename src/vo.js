import dotenv from 'dotenv';
import * as helpers from './helpers.js';
import { io } from 'socket.io-client';
import fs from 'fs';

dotenv.config();
const auth = { token: process.env.TOKEN3 };
const socket = io(process.env.SOCKET_SERVER, {
  auth: auth,
});

let MAP=[]
let BOMBERS=[]
let BOMBS=[]
let CHESTS=[]
let ITEMS=[]
let GAME_START = false
let explosionRange = 2
let FROZEN_BOTS = []
let PRIORITY_CHESTS = []
const DANGER_ZONE = []
let GAME_START_AT = null;
let KILL_BOOM = new Set();
let ATTACK_MODE = false
let ATTACK_MODE_INTERVAL_ID = null;
const FILE_NAME='log2.txt'
const chestMap = new Map();

socket.on('user', (data) => {
  MAP = data.map;
  BOMBERS = data.bombers;
  BOMBS = data.bombs;
  CHESTS = data.chests;
  ITEMS = data.items;
  updateChestMap()
  if (process.env.ENV == 'local')
    GAME_START = true
});

socket.on('start', () => {
  GAME_START = true
})

socket.on('finish', () => {
  socket.disconnect();
  socket.connect();
  socket.emit('join', {});
})

socket.on('new_enemy', (data) => {
  for (const bomber of data.bombers) {
    helpers.upsertItem(BOMBERS, bomber, 'uid')
  }
});

socket.on('player_move', (payload) => {
  helpers.upsertItem(BOMBERS, payload, 'uid');
  //if a frozen bot move then remove it from frozen bots
  if (FROZEN_BOTS.map(b => b.name).includes(payload.name)) {
    FROZEN_BOTS = FROZEN_BOTS.filter(b => b.name !== payload.name)
  }
});

socket.on('new_bomb', (payload) => {
  helpers.upsertItem(BOMBS, payload, 'id');
  addDangerZonesForBomb(payload);
});

socket.on('item_collected', (payload) => {
  ITEMS = ITEMS.filter(i => !(i && i.x === payload.item.x && i.y === payload.item.y));
  if (payload.item.type === 'R') {
    explosionRange += 1
  }
  updateChestMap(explosionRange)
});

socket.on('bomb_explode', (payload) => {
  for (const area of payload.explosionArea) {
    if (MAP[area.y / helpers.WALL_SIZE][area.x / helpers.WALL_SIZE] == null) continue;

    MAP[area.y / helpers.WALL_SIZE][area.x / helpers.WALL_SIZE] = null;
  }

  BOMBS = BOMBS.filter(b => b.id !== payload.id);
  removeDangerZonesForBomb(payload.id);
  if (KILL_BOOM.has(`${payload.x / helpers.WALL_SIZE}-${payload.y / helpers.WALL_SIZE}`)) {
    KILL_BOOM.delete(`${payload.x / helpers.WALL_SIZE}-${payload.y / helpers.WALL_SIZE}`)
  }
});

socket.on('map_update', (payload) => {
  ITEMS = payload.items;
  updateChestMap(explosionRange)
});

socket.on('user_die_update', (payload) => {
  if (process.env.ENV != 'local') {
    BOMBERS = BOMBERS.filter(b => b.name !== payload.killed.name)
    if (FROZEN_BOTS.map(b => b.name).includes(payload.killed.name)) {
      PRIORITY_CHESTS = []
      FROZEN_BOTS = FROZEN_BOTS.filter(b => b.name !== payload.killed.name)
    }
  }
})

socket.on('chest_destroyed', (payload) => {
  for (let i = PRIORITY_CHESTS.length - 1; i >= 0; i--) {
    const chest = PRIORITY_CHESTS[i];
    if (chest.x === payload.x / helpers.WALL_SIZE &&
        chest.y === payload.y / helpers.WALL_SIZE) {
      PRIORITY_CHESTS.splice(i, 1);
    }
  }

  if (FROZEN_BOTS.length > 0 && PRIORITY_CHESTS.length == 0) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME3);

    // no bomb is placing
    if (BOMBS.filter(b => b.ownerName !== myBomber.name).length === 0) {
      const findChest = helpers.findChestBreakScoresToFrozen(myBomber, FROZEN_BOTS, MAP)
      const chestToFrozenBots = findChest.sort((a, b) => a.score - b.score)[0]
      PRIORITY_CHESTS.push(...chestToFrozenBots?.chests)
    }
  }
})

socket.on('connect', async () => {
  console.log('Connected to server');
  socket.emit('join', {});
  fs.writeFileSync(FILE_NAME, '');
  console.log('Sent join event');

  while(!GAME_START) {
    await sleep(10)
  }

  GAME_START_AT = Date.now();

  while(true) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME3);
    helpers.markOwnBombOnMap(myBomber, BOMBS, MAP, Date.now () - GAME_START_AT > 60000)

    let didSomething = false
    if (checkBomAvailables(myBomber)) {
      for (const bomber of BOMBERS) {
        if (bomber.name === myBomber.name) continue;

        const boomPlace = helpers.isDeadCorner(bomber, MAP);
        if (boomPlace && !KILL_BOOM.has(`${boomPlace.x}-${boomPlace.y}`)) {
          const gridPath = findPathToTarget(helpers.toMapCoord(boomPlace))
          if (gridPath && gridPath.length > 1) {
            const middlePoint = helpers.getMidPoint(gridPath, myBomber.speed);
            const pathToMidPoint = findPathToTarget(middlePoint, false)
            if (pathToMidPoint && pathToMidPoint.length > 1) {
              if (helpers.isInDanger(pathToMidPoint[1], DANGER_ZONE, true)) {
                // writeLog('just wait')
                //just wait
              } else {
                const step = nextStep(pathToMidPoint);
                move(step);
              }
              didSomething = true
            } else {
              placeBoom(myBomber);
              KILL_BOOM.add(`${boomPlace.x}-${boomPlace.y}`)
            }
          } else if (gridPath && gridPath.length == 1) {
            placeBoom(myBomber);
            KILL_BOOM.add(`${boomPlace.x}-${boomPlace.y}`)
          }
        }
        break;
      }
    }

    if (didSomething) {
      await sleep(10)
      continue;
    }

    if (helpers.isInDanger(myBomber, DANGER_ZONE)) {
      let safetyZone = null;
      safetyZone = helpers.findNearestSafetyZone(myBomber, MAP, DANGER_ZONE);

      if (safetyZone) {
        const path = helpers.findPathToTarget(myBomber, helpers.toMapCoord(safetyZone), MAP, false);
        if (path && path.length >= 1) {
          if (path.length == 1) {
            path.push(helpers.toMapCoord(safetyZone))
          }
          const step = nextStep(path);
          if (step) {
            move(step);
            await sleep(10);
            continue;
          }
        }
      }
    }

    if (ATTACK_MODE) {
      let targetBot;
      //move to nearest bot and place boom
      if (FROZEN_BOTS.length > 0)
        targetBot = FROZEN_BOTS[0]
      else
        targetBot = BOMBERS.filter(b => b.name !== myBomber.name)
          .sort((a, b) => helpers.manhattanDistance(myBomber, a) - helpers.manhattanDistance(myBomber, b))[0]

      const allPos = helpers.getAllAttackPositions(myBomber, targetBot, MAP);
      const bestPos = allPos[0]
      if (!bestPos) {
        await sleep(10);
        continue;
      }

      const pathToBot = helpers.findPathToTarget(myBomber, helpers.toMapCoord(bestPos), MAP, false);

      if (pathToBot && pathToBot.length > 1) {
        if (helpers.isInDanger(pathToBot[1], DANGER_ZONE, true)) {
        } else {
          const step = nextStep(pathToBot);
          move(step);
        }
      } else if (pathToBot && pathToBot.length <= 1) {
        const ownedActiveBombs = BOMBS.filter(b => b && b.uid === myBomber.uid).length;
        if (myBomber.bombCount - ownedActiveBombs > 1)
          placeBoom(myBomber);
      }
    }

    if (ATTACK_MODE) {
      await sleep(10);
      continue;
    }

    const reachableItem = findReachableItem();

    if (reachableItem) {
      if (helpers.isInDanger(reachableItem.path[1], DANGER_ZONE, true)) {
      } else {
        move(nextStep(reachableItem.path));
      }
    } else {
      const walkableNeighbors = helpers.getWalkableNeighbors(MAP, myBomber);
      let allPlaces = null;

      if (PRIORITY_CHESTS.length > 0)
        allPlaces = helpers.bombPositionsForChest(myBomber, PRIORITY_CHESTS[0], MAP, walkableNeighbors)
      else
        allPlaces = helpers.findAllPossiblePlaceBoom(myBomber, MAP, chestMap, walkableNeighbors, DANGER_ZONE);

      if (allPlaces && allPlaces.length > 0) {
        for (const place of allPlaces) {
          const mapCoordPlace = helpers.toMapCoord(place)
          if (BOMBS.some(b => b.x === mapCoordPlace.x && b.y === mapCoordPlace.y)) {
            continue;
          }

          const safeZones = helpers.countSafeZonesAfterPlaceBoom(mapCoordPlace, myBomber.explosionRange, DANGER_ZONE, MAP, walkableNeighbors);
          if (safeZones) {
            const gridPath = findPathToTarget(mapCoordPlace)
            if (gridPath && gridPath.length > 1) {
              if (helpers.isInDanger(helpers.toMapCoord(gridPath[1]), DANGER_ZONE, true)) {
                //just wait
              } else {
                const middlePoint = helpers.getMidPoint(gridPath, myBomber.speed);
                const pathToMidPoint = findPathToTarget(middlePoint, false)

                if (pathToMidPoint) {
                  if (pathToMidPoint.length > 1) {
                    if (helpers.isInDanger(pathToMidPoint[1], DANGER_ZONE, true)) {
                    } else {
                      const step = nextStep(pathToMidPoint);
                      if (step) {
                        move(step);
                      } else {
                      }
                    }
                  } else {
                    placeBoom(myBomber);
                  }
                }
              }
            } else if (gridPath && gridPath.length < 2) {
              placeBoom(myBomber);
            }
            break;
          }
        }
      }
    }
    await (sleep(10));
  }
});

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const move = (orient) => {
  socket.emit('move', {
    orient: orient
  })
}

const placeBoom = (myBomber = null) => {
  if (checkBomAvailables(myBomber)) {
    socket.emit('place_bomb', {})
    updateMapWhenPlaceBoom(myBomber)
  }
}

// Add danger zones for a specific bomb using bomber.explosionRange
function addDangerZonesForBomb(bomb) {
  if (!bomb) return;

  const placingBomber = BOMBERS.find(b => b && b.uid === bomb.uid);
  const newZones = helpers.createDangerZonesForBomb(bomb, placingBomber.explosionRange, MAP, DANGER_ZONE);

  DANGER_ZONE.push(...newZones);
}

function removeDangerZonesForBomb(bombId) {
  // Remove all danger zones associated with this bomb
  const filtered = DANGER_ZONE.filter(z => z.bombId !== bombId);
  DANGER_ZONE.length = 0;
  DANGER_ZONE.push(...filtered);
}

function updateDangerZonesForBomb() {
  // Clear all existing danger zones
  DANGER_ZONE.length = 0;

  // Rebuild danger zones from all active bombs
  for (const bomb of BOMBS) {
    if (!bomb || bomb.isExploded) continue;

    // Find the bomber who placed this bomb to get explosionRange
    const placingBomber = BOMBERS.find(b => b && b.uid === bomb.uid);
    if (!placingBomber) continue;

    // Calculate explodeAt time if not already set
    const explodeAt = bomb.createdAt + bomb.lifeTime;

    // Create danger zones for this bomb
    const newZones = helpers.createDangerZonesForBomb(
      { ...bomb, explodeAt },
      placingBomber.explosionRange,
      MAP,
      []
    );

    DANGER_ZONE.push(...newZones);
  }
}

function findReachableItem() {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME3);
  if (ITEMS.length === 0) return null;

  // Filter items within Manhattan distance <= 6 grid cells
  const nearbyItems = ITEMS.filter(item => {
    if (!item) return false;

    const distance = helpers.chebyshevDistance(item, myBomber);
    return distance <= (6 * helpers.WALL_SIZE);
  });

  // Find all valid paths to nearby items
  const validPaths = [];
  for (const item of nearbyItems) {
    const path = findPathToTarget(item, false);
    if (path && path.length > 1) {
      validPaths.push({ item, path });
    }
  }

  // Sort by path length (shortest first) and return the closest one
  if (validPaths.length > 0) {
    validPaths.sort((a, b) => a.path.length - b.path.length);
    return validPaths[0];
  }

  return null;
}

function nextStep(path) {
  if (!path || path.length < 2) return null;
  const current = path[0];
  const next = path[1];

  if (next.x > current.x) return 'RIGHT';
  if (next.y > current.y) return 'DOWN';
  if (next.x < current.x) return 'LEFT';
  if (next.y < current.y) return 'UP';

  return null;
}

// Wrapper to compute path using helpers with correct inputs
function findPathToTarget(target, isGrid = true) {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME3);

  return helpers.findPathToTarget(myBomber, target, MAP, isGrid);
}

function updateMapWhenPlaceBoom(bomber) {
  const { x: startCol, y: startRow } = helpers.toGridCoord(bomber);

  for (const { dx, dy } of helpers.DIRS[0]) {
    for (let step = 1; step <= bomber.explosionRange; step++) {
      const r = startRow + dy * step;
      const c = startCol + dx * step;

      const cell = MAP[r][c];
      if (cell === 'W') break; // tường chặn nổ

      if (cell === 'C') {
        // tìm chest tương ứng
        const chestX = c * helpers.WALL_SIZE;
        const chestY = r * helpers.WALL_SIZE;
        const chest = CHESTS.find(ch => ch.x === chestX && ch.y === chestY && !ch.isDestroyed);
        if (chest) {
          MAP[r][c] = 'W';
          chest.isDestroyed = true
        }
        break; // nổ dừng tại chest
      }
    }
  }

  return MAP;
}

function checkBomAvailables(myBomber) {
  // Count active bombs owned by this bomber (tracked by uid)
  const ownedActiveBombs = BOMBS.filter(b => b && b.uid === myBomber.uid).length;
  const over20Sec = Date.now() - GAME_START_AT > 20000;
  const bomAvailable = ownedActiveBombs < myBomber.bombCount;
  return myBomber.speed == 1 ? (over20Sec ? bomAvailable : ownedActiveBombs == 0) : bomAvailable;
}

// Check frozen bots every 5s
setInterval(() => {
  const prevPositions = new Map();

  // lưu vị trí hiện tại
  for (const b of BOMBERS.filter(b => b.name !== process.env.BOMBER_NAME3)) {
    if (!b) continue;
    prevPositions.set(b.name, { x: b.x, y: b.y });
  }

  setTimeout(() => {
    for (const b of BOMBERS.filter(b => b.name !== process.env.BOMBER_NAME3)) {
      if (!b) continue;
      const prev = prevPositions.get(b.name);
      if (!prev) continue;

      const notMoved = prev.x === b.x && prev.y === b.y;
      const alreadyFrozen = FROZEN_BOTS.some(f => f.name === b.name);

      if (notMoved && !alreadyFrozen) {
        FROZEN_BOTS.push(b);
      }
    }
  }, 5000);
}, 5000);

ATTACK_MODE_INTERVAL_ID = setInterval(() => {
  //check if we can touch any enemy then turn on attack mode
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME3);
  let canTouchEnemy = false;
  for (const bomber of BOMBERS) {
    if (bomber.name === myBomber.name) continue;
    const path = findPathToTarget(bomber, false);
    if (path && path.length > 1) {
      canTouchEnemy = true;
      break;
    }
  }
  if (canTouchEnemy) {
    ATTACK_MODE = true;
    if (ATTACK_MODE_INTERVAL_ID) {
      clearInterval(ATTACK_MODE_INTERVAL_ID);
      ATTACK_MODE_INTERVAL_ID = null;
    }
  } else {
    ATTACK_MODE = false;
  }
}, 1000)

function updateChestMap(explosionRange = 2) {
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      const key = `${c},${r}`;
      if (MAP[r][c] === 'W' || MAP[r][c] === 'C') {
        continue;
      } else {
        chestMap.set(key, helpers.countChestsDestroyedAt(MAP, c, r, explosionRange));
      }
    }
  }
}
