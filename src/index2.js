import dotenv from 'dotenv';
import * as helpers from './helpers.js';
import { io } from 'socket.io-client';
import fs from 'fs';

dotenv.config();
const auth = { token: process.env.TOKEN2 };
const socket = io(process.env.SOCKET_SERVER, {
  auth: auth,
});

let MAP=[]
let BOMBERS=[]
let BOMBS=[]
let CHESTS=[]
let ITEMS=[]
let GAME_START = false
const FROZEN_BOTS = []
let PRIORITY_CHESTS = []
const DANGER_ZONE = []
let ATTACK_MODE = false
let GAME_START_AT = null;

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
  writeLog('bombs', BOMBS)
  // Add danger zone tiles for this bomb based on explosion range
  addDangerZonesForBomb(payload);
});

socket.on('item_collected', (payload) => {
  // remove collected item from ITEMS (match both x and y)
  ITEMS = ITEMS.filter(i => !(i && i.x === payload.item.x && i.y === payload.item.y));
});

socket.on('bomb_explode', (payload) => {
  writeLog('bomb explode', payload);
  for (const area of payload.explosionArea) {
    if (MAP[area.y / helpers.WALL_SIZE][area.x / helpers.WALL_SIZE] == null) continue;

    MAP[area.y / helpers.WALL_SIZE][area.x / helpers.WALL_SIZE] = null;
  }

  //remove bomb from BOMBS
  BOMBS = BOMBS.filter(b => b.id !== payload.id);
  // Remove danger zones associated with this bomb
  removeDangerZonesForBomb(payload.id);
});

socket.on('map_update', (payload) => {
  ITEMS = payload.items;
});

socket.on('user_die_update', (payload) => {
  writeLog("user die update")

  if (process.env.ENV != 'local') {
    BOMBERS = BOMBERS.filter(b => b.uid === payload.uid)
    //remove from frozen bot too
  }

  if (payload.killed.name === process.env.BOMBER_NAME2) {
    writeLog('user die update', payload)
  }

  if (FROZEN_BOTS.map(b => b.name).includes(payload.killed.name)) {
    PRIORITY_CHESTS = []
    FROZEN_BOTS.splice(FROZEN_BOTS.findIndex(b => b.name === payload.killed.name), 1)
    writeLog(`removed frozen bot ${payload.killed.name}`)
  }
})

socket.on('chest_destroyed', (payload) => {
  if (PRIORITY_CHESTS.length > 0) {
    PRIORITY_CHESTS = PRIORITY_CHESTS.filter(chest =>
      !(chest.x === (payload.x / helpers.WALL_SIZE) && chest.y === (payload.y / helpers.WALL_SIZE))
    );
    writeLog(`priority after remove`, PRIORITY_CHESTS);
    setTimeout(() => {
      if (PRIORITY_CHESTS.length > 0) {
        PRIORITY_CHESTS = []
      }
    }, 10000)
  }

  if (FROZEN_BOTS.length > 0 && PRIORITY_CHESTS.length == 0) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME2);

    // no bomb is placing
    if (BOMBS.filter(b => b.ownerName !== myBomber.name).length === 0) {
      writeLog('frozenbot', FROZEN_BOTS)
      const findChest = helpers.findChestBreakScoresToFrozen(myBomber, FROZEN_BOTS, MAP)
      const chestToFrozenBots = findChest.sort((a, b) => a.score - b.score)[0]
      PRIORITY_CHESTS.push(...chestToFrozenBots.chests)
      writeLog('added priority chests', PRIORITY_CHESTS)
    }
  }
})

socket.on('connect', async () => {
  console.log('Connected to server');
  socket.emit('join', {});
  fs.writeFileSync('log2.txt', '');
  console.log('Sent join event');

  while(!GAME_START) {
    await sleep(10)
  }

  GAME_START_AT = Date.now();

  while(true) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME2);
    writeLog('myboy', myBomber.x, myBomber.y)
    helpers.markOwnBombOnMap(myBomber, BOMBS, MAP, GAME_START_AT)

    if (helpers.isInDanger(myBomber, DANGER_ZONE)) {
      const safetyZone = helpers.findNearestSafetyZone(myBomber, MAP, DANGER_ZONE);
      writeLog('In danger! Moving to safety zone...', safetyZone);
      if (safetyZone) {
        const path = helpers.findPathToTargetAStar(myBomber, helpers.toMapCoord(safetyZone), MAP, false);
        if (path && path.length >= 1) {
          if (path.length == 1) {
            path.push(helpers.toMapCoord(safetyZone))
            writeLog("path length 1 case")
          }
          const step = nextStep(path);
          if (step) {
            move(step);
            await sleep(10);
            continue;
          } else {
            writeLog('no step', step)
            writeLog('path to safety', path)
          }
        } else {
          writeLog('no path to safety', path);
          writeLog('myBomber', myBomber);
          writeLog('DANGER_ZONE', DANGER_ZONE);
          writeLog('MAP', MAP)
          writeLog('safetyZone', safetyZone);
        }
      } else {
        writeLog('no safety zone', )
      }
    }

    if (!helpers.hasChestLeft(MAP)) {
      ATTACK_MODE = true;
      //move to nearest bot and place boom
      const nearestBot = BOMBERS.filter(b => b.name !== myBomber.name)
        .sort((a, b) => {
          helpers.heuristic(myBomber, a) - helpers.heuristic(myBomber, b)
        })[0]
      const bestPos = helpers.findBombPositionsForEnemyArea(myBomber, nearestBot, MAP)[0]
      if (!bestPos) {
        writeLog('no best pos to attack bot', nearestBot)
        await sleep(10);
        continue;
      }

      const pathToBot = helpers.findPathToTargetAStar(myBomber, {
        x: bestPos.x * helpers.WALL_SIZE,
        y: bestPos.y * helpers.WALL_SIZE
      }, MAP, false);

      if (pathToBot && pathToBot.length > 1) {
        if (helpers.isInDanger(pathToBot, DANGER_ZONE)) {
          writeLog('path 1 in danger zone so dont move ATTACK_MODE');
        } else {
          const step = nextStep(pathToBot);
          move(step);
        }
      } else if (pathToBot && pathToBot.length <= 1) {
        writeLog('touch bot position', pathToBot)
        placeBoom(myBomber);
        updateMapWhenPlaceBoom(myBomber);
      } else {
        writeLog('no path to bot', pathToBot)
      }
    }

    if (ATTACK_MODE) {
      await sleep(10);
      continue;
    }

    const reachableItem = findReachableItem();

    if (reachableItem) {
      writeLog('moving to reachable item');
      if (helpers.isInDanger(reachableItem.path[1], DANGER_ZONE)) {
        writeLog('path 1 in danger zone so dont move');
      } else {
        move(nextStep(reachableItem.path));
      }
    } else {
      writeLog('no reachable item found');

      const walkableNeighbors = helpers.getWalkableNeighbors(MAP, myBomber);
      let allPlaces = null;

      if (PRIORITY_CHESTS.length > 0)
        allPlaces = helpers.bombPositionsForChest(myBomber, PRIORITY_CHESTS[0], MAP, walkableNeighbors)
      else
        allPlaces = helpers.findAllPossiblePlaceBoom(myBomber, MAP, walkableNeighbors)

      if (allPlaces && allPlaces.length > 0) {
        for (const place of allPlaces) {
          const safeZones = helpers.countSafeZonesAfterPlaceBoom(helpers.toMapCoord(place), myBomber.explosionRange, DANGER_ZONE, MAP, walkableNeighbors);
          if (safeZones) {
            const gridPath = findPathToTarget(helpers.toMapCoord(place))
            if (gridPath && gridPath.length > 1) {
              if (helpers.isInDanger(helpers.toMapCoord(gridPath[1]), DANGER_ZONE)) {
                writeLog('path 1 in danger zone so dont move');
                writeLog('place', place);
                const last = gridPath[gridPath.length - 1];
                // writeLog('MAP[last.y][last.x]',last.y, last.x, MAP[last.y][last.x]);
              } else {
                const middlePoint = helpers.getMidPoint(gridPath, myBomber.speed);
                const pathToMidPoint = findPathToTarget(middlePoint, false)

                if (pathToMidPoint) {
                  if (pathToMidPoint.length > 1) {
                    if (helpers.isInDanger(pathToMidPoint[1], DANGER_ZONE)) {
                      writeLog('path 1 pathToMidPoint in danger zone so dont move');
                    } else {
                      const step = nextStep(pathToMidPoint);
                      if (step) {
                        move(step);
                      } else {
                        writeLog('no step');
                      }
                    }
                  } else {
                    writeLog('touch pathToMidPoint', pathToMidPoint)
                    placeBoom(myBomber);
                    updateMapWhenPlaceBoom(myBomber);
                  }
                } else {
                  writeLog('no path to mid point', middlePoint)
                }
              }
            } else if (gridPath && gridPath.length < 2) {
              writeLog('touch nearest chest', gridPath)
              writeLog('places', allPlaces)
              placeBoom(myBomber);
              updateMapWhenPlaceBoom(myBomber);
            } else {
              writeLog('no grid path', gridPath)
            }
            break;
          } else {
            writeLog('no safe zone after place boom at', place);
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

  writeLog('moved ', orient)
}

const placeBoom = (myBomber = null) => {
  if (checkBomAvailables(myBomber)) {
    writeLog('PLACED BOOM at ', myBomber.x, myBomber.y)
    socket.emit('place_bomb', {})
  } else {
    writeLog('BOOM REACH MAX ', myBomber, BOMBS)
  }

}

// Add danger zones for a specific bomb using bomber.explosionRange
function addDangerZonesForBomb(bomb) {
  if (!bomb) return;

  const placingBomber = BOMBERS.find(b => b && b.uid === bomb.uid);
  const newZones = helpers.createDangerZonesForBomb(bomb, placingBomber.explosionRange, MAP);
  for (const z of newZones) DANGER_ZONE.push(z);
}

function removeDangerZonesForBomb(bombId) {
  // Remove all danger zones associated with this bomb
  const filtered = DANGER_ZONE.filter(z => z.bombId !== bombId);
  DANGER_ZONE.length = 0;
  DANGER_ZONE.push(...filtered);
}

function findReachableItem() {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME2);
  if (ITEMS.length === 0) return null;

  // Filter items within Manhattan distance <= 6 grid cells
  const nearbyItems = ITEMS.filter(item => {
    if (!item) return false;

    const distance = Math.abs(item.x - myBomber.x) + Math.abs(item.y - myBomber.y);
    return distance <= (6 * helpers.WALL_SIZE);
  });

  // Find all valid paths to nearby items
  const validPaths = [];
  for (const item of nearbyItems) {
    const path = findPathToTarget(item, false);
    if (path && path.length > 1) {
      validPaths.push({ item, path });
    } else {
      writeLog('item not reachable or path too short', { item, path });
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
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME2);

  return helpers.findPathToTarget(myBomber, target, MAP, isGrid);
}

function updateMapWhenPlaceBoom(bomber) {
  const { x: startCol, y: startRow } = helpers.toGridCoord(bomber);

  // Tính cả vị trí bom
  const inBounds = (r, c) => r >= 0 && c >= 0 && r < 16 && c < 16;

  for (const { dx, dy } of helpers.DIRS[0]) {
    for (let step = 1; step <= bomber.explosionRange; step++) {
      const r = startRow + dy * step;
      const c = startCol + dx * step;
      if (!inBounds(r, c)) break;

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
}, 15000);

function writeLog(...args) {
  console.log(...args)

  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null) : String(a)
  ).join(' ');

  const log = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync('log2.txt', log);
}

function checkBomAvailables(myBomber) {
  // Count active bombs owned by this bomber (tracked by uid)
  const ownedActiveBombs = BOMBS.filter(b => b && b.uid === myBomber.uid).length;
  const over20Sec = Date.now() - GAME_START_AT > 20000;

  return over20Sec ? (ownedActiveBombs < myBomber.bombCount) : (ownedActiveBombs == 0)
}
