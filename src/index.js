import dotenv from 'dotenv';
import * as helpers from './helpers.js';
import { io } from 'socket.io-client';
import fs from 'fs';

dotenv.config();
const auth = { token: process.env.TOKEN };
const socket = io(process.env.SOCKET_SERVER, {
  auth: auth,
});

let MAP=[]
let BOMBERS=[]
let BOMBS=[]
let CHESTS=[]
let ITEMS=[]
let GAME_START = false
let FROZEN_BOTS = []
let PRIORITY_CHESTS = []
const DANGER_ZONE = []
let GAME_START_AT = null;
let KILL_BOOM = new Set();
let ATTACK_MODE = false
let ATTACK_MODE_INTERVAL_ID = null;

socket.on('user', (data) => {
  MAP = data.map;
  BOMBERS = data.bombers;
  BOMBS = data.bombs;
  CHESTS = data.chests;
  ITEMS = data.items;
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
    helpers.upsertBomber(BOMBERS, bomber);
  }
});

socket.on('player_move', (payload) => {
  helpers.upsertBomber(BOMBERS, payload);
});

socket.on('new_bomb', (payload) => {
  helpers.upsertBomb(BOMBS, payload);
  addDangerZonesForBomb(payload);
});

socket.on('item_collected', (payload) => {
  ITEMS = ITEMS.filter(i => !(i && i.x === payload.item.x && i.y === payload.item.y));
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
  if (PRIORITY_CHESTS.length > 0) {
    PRIORITY_CHESTS = PRIORITY_CHESTS.filter(chest =>
      !(chest.x === (payload.x / helpers.WALL_SIZE) && chest.y === (payload.y / helpers.WALL_SIZE))
    );

    setTimeout(() => {
      if (PRIORITY_CHESTS.length <= 1) {
        PRIORITY_CHESTS = []
        FROZEN_BOTS.pop()
      }
    }, 10000)
  }

  if (FROZEN_BOTS.length > 0 && PRIORITY_CHESTS.length == 0) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);

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
  fs.writeFileSync('log.txt', '');
  console.log('Sent join event');

  while(!GAME_START) {
    await sleep(10)
  }

  GAME_START_AT = Date.now();

  while(true) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
    helpers.markOwnBombOnMap(myBomber, BOMBS, MAP, GAME_START_AT)

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
                writeLog('just wait')
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
      await sleep(15)
      continue;
    }

    writeLog(`myBomber`, myBomber.x, myBomber.y);

    if (helpers.isInDanger(myBomber, DANGER_ZONE, myBomber.speed > 1)) {
      writeLog('in danger')
      let safetyZone = null;
      const allSafetyZone = helpers.findAllSafeZones(helpers.toGridCoord(myBomber), MAP, DANGER_ZONE)
      if (allSafetyZone) {
        writeLog('allSafetyZone', allSafetyZone)
        safetyZone = allSafetyZone[0]
      } else
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

    if (!helpers.hasChestLeft(MAP) || ATTACK_MODE) {
      ATTACK_MODE = true;
      //move to nearest bot and place boom
      const nearestBot = BOMBERS.filter(b => b.name !== myBomber.name)
        .sort((a, b) => helpers.manhattanDistance(myBomber, a) - helpers.manhattanDistance(myBomber, b))[0]
      const bestPos = helpers.findBombPositionsForEnemyArea(myBomber, nearestBot, MAP)[0]
      if (!bestPos) {
        await sleep(10);
        continue;
      }

      const pathToBot = helpers.findPathToTarget(myBomber, {
        x: bestPos.x * helpers.WALL_SIZE,
        y: bestPos.y * helpers.WALL_SIZE
      }, MAP, false);

      if (pathToBot && pathToBot.length > 1) {
        if (helpers.isInDanger(pathToBot[1], DANGER_ZONE, true)) {
        } else {
          const step = nextStep(pathToBot);
          move(step);
        }
      } else if (pathToBot && pathToBot.length <= 1) {
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
        allPlaces = helpers.findAllPossiblePlaceBoom(myBomber, MAP, walkableNeighbors)

      if (allPlaces && allPlaces.length > 0) {
        for (const place of allPlaces) {
          const mapCoordPlace = helpers.toMapCoord(place)
          if (BOMBS.some(b => b.x === mapCoordPlace.x && b.y === mapCoordPlace.y)) {
            writeLog('oo nay co boom roi chay thoi')
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

function findReachableItem() {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
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
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);

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

setTimeout(() => {
  const zeroScoreBombers = BOMBERS.filter(b => b && b.score === 0);
  FROZEN_BOTS.push(...zeroScoreBombers);
}, 20000);

function checkBomAvailables(myBomber) {
  // Count active bombs owned by this bomber (tracked by uid)
  const ownedActiveBombs = BOMBS.filter(b => b && b.uid === myBomber.uid).length;
  const over20Sec = Date.now() - GAME_START_AT > 20000;
  const bomAvailable = ownedActiveBombs < myBomber.bombCount;
  return myBomber.speed == 1 ? (over20Sec ? bomAvailable : ownedActiveBombs == 0) : bomAvailable;
}

// ATTACK_MODE_INTERVAL_ID = setInterval(() => {
//   //check if we can touch any enemy then turn on careful mode
//   const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
//   let canTouchEnemy = false;
//   for (const bomber of BOMBERS) {
//     if (bomber.name === myBomber.name) continue;
//     const path = findPathToTarget(bomber, false);
//     if (path && path.length > 1) {
//       canTouchEnemy = true;
//       break;
//     }
//   }
//   if (canTouchEnemy) {
//     ATTACK_MODE = true;
//     if (ATTACK_MODE_INTERVAL_ID) {
//       // clearInterval(ATTACK_MODE_INTERVAL_ID);
//       ATTACK_MODE_INTERVAL_ID = null;
//     }
//   }

//   writeLog('check careful mode');
// }, 1000)

function writeLog(...args) {
  console.log(...args)

  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null) : String(a)
  ).join(' ');

  const log = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync('log.txt', log);
}
