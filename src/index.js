import dotenv from 'dotenv';
import * as helpers from './helpers.js';
import { io } from 'socket.io-client';
import sampleBomber from './sample/bomber.js';
import sampleMap from './sample/map.js';
import blankMap from './sample/blankMap.js'
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
const FROZEN_BOTS = []
const DANGER_ZONE = []

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
  if (process.env.ENV != 'local') {
    BOMBERS = BOMBERS.filter(b => b.uid === payload.uid)
    //remove from frozen bot too
  }

  if (payload.killed.name === process.env.BOMBER_NAME) {
    writeLog('user die update', payload)
  }
})

function blindCodeMode() {
  BOMBERS.push({ ...sampleBomber });
  MAP = sampleMap;
  // ITEMS.push({ ...sampleItem });
  for (let y = 0; y < MAP.length; y++) {
    for (let x = 0; x < MAP[y].length; x++) {
      if (MAP[y][x] === 'C') {
        CHESTS.push({
          x: x * helpers.WALL_SIZE,
          y: y * helpers.WALL_SIZE,
          size: helpers.WALL_SIZE,
          type: 'C',
          isDestroyed: false
        });
      }
    }
  }
  GAME_START = true
}

socket.on('connect', async () => {
  console.log('Connected to server');
  // socket.emit('join', {});
  blindCodeMode()
  fs.writeFileSync('log.txt', '');
  console.log('Sent join event');

  while(!GAME_START) {
    await sleep(100)
  }

  while(BOMBERS.length === 0) {
    await sleep(100)
  }

  while(true) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
    writeLog('myboy', myBomber.x, myBomber.y)
    helpers.markOwnBombOnMap(myBomber, BOMBS, MAP)

    if (FROZEN_BOTS.length > 0) {
      // no bomb is placing
      if (BOMBS.filter(b => b.ownerName !== myBomber.name).length === 0) {
        // writeLog(helpers.findChestBreakScoresToFrozen(myBomber, FROZEN_BOTS, MAP))
      }
    }

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
            await sleep(100);
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

    const reachableItem = findReachableItem();

    if (reachableItem) {
      writeLog('moving to reachable item', reachableItem.path.length);
      if (helpers.isInDanger(reachableItem.path[1], DANGER_ZONE)) {
        writeLog('path 1 in danger zone so dont move');
      } else {
        move(nextStep(reachableItem.path));
      }
    } else {
      //skip in case no bom available
      // if (!checkBomAvailables(myBomber)) continue;

      const walkableNeighbors = helpers.getWalkableNeighbors(MAP, myBomber);
      const allPlaces = helpers.findAllPossiblePlaceBoom(myBomber, MAP, walkableNeighbors)

      if (allPlaces && allPlaces.length > 0) {
        for (const place of allPlaces) {
          // writeLog('place', place)
          const safeZones = helpers.countSafeZonesAfterPlaceBoom(helpers.toMapCoord(place), myBomber.explosionRange, DANGER_ZONE, MAP, walkableNeighbors);
          if (safeZones) {
            const gridPath = findPathToTarget(helpers.toMapCoord(place))
            // writeLog('gridPath', gridPath)
            if (gridPath && gridPath.length > 1) {
              if (helpers.isInDanger(helpers.toMapCoord(gridPath[1]), DANGER_ZONE)) {
                writeLog('path 1 in danger zone so dont move');
                writeLog('place', place);
                const last = gridPath[gridPath.length - 1];
                writeLog('MAP[last.y][last.x]',last.y, last.x, MAP[last.y][last.x]);
              } else {
                const middlePoint = helpers.getMidPoint(gridPath, myBomber.speed);
                const pathToMidPoint = findPathToTarget(middlePoint, false)

                if (pathToMidPoint) {
                  if (pathToMidPoint.length > 1) {
                    const step = nextStep(pathToMidPoint);
                    if (step) {
                      move(step);
                    } else {
                      writeLog('no step');
                    }
                  } else {
                    writeLog('touch pathToMidPoint', pathToMidPoint)
                    placeBoom(myBomber);
                    updateMapWhenPlaceBoom(myBomber);
                  }
                }
              }
            } else if (gridPath && gridPath.length < 2) {
              writeLog('touch nearest chest', gridPath)
              writeLog('places', allPlaces)
              placeBoom(myBomber);
              updateMapWhenPlaceBoom(myBomber);
            }
            break;
          }
        }
      }
    }
    await (sleep(100));
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

  //blindcodemode
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  if (!myBomber) return;

  if (orient === 'UP') myBomber.y -= (myBomber.speed)
  if (orient === 'DOWN') myBomber.y += (myBomber.speed)
  if (orient === 'LEFT') myBomber.x -= (myBomber.speed)
  if (orient === 'RIGHT') myBomber.x += (myBomber.speed)
}

const placeBoom = (myBomber = null) => {
  if (checkBomAvailables(myBomber)) {
    writeLog('PLACED BOOM at ', myBomber.x, myBomber.y)
    socket.emit('place_bomb', {})
  } else {
    writeLog('BOOM REACH MAX ', myBomber, BOMBS)
  }

  //blindcodemode
  const bomID = `random-${Date.now()}`
  addDangerZonesForBomb({
    id: bomID,
    x: myBomber.x,
    y: myBomber.y,
    uid: myBomber.uid,
  })
  setTimeout(() => {
    writeLog('BOMB EXPLODE', );
    removeDangerZonesForBomb(bomID);
    writeLog('update map to null', myBomber.x, myBomber.y)
    writeLog('MAP', MAP[1])
    MAP[Math.floor(myBomber.y / helpers.WALL_SIZE)][Math.floor(myBomber.x / helpers.WALL_SIZE)] = null;
    CHESTS.filter(x => x.isDestroyed).map(c => {
      MAP[c.y / helpers.WALL_SIZE][c.x / helpers.WALL_SIZE] = null
      writeLog('x y', c.x / helpers.WALL_SIZE, c.y / helpers.WALL_SIZE);
    })
  }, 5000)
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
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
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
  const fakeBomber1 = { ...sampleBomber, score: 0, x: 565, y: 565 };
  const fakeBomber2 = { ...sampleBomber, score: 0, x: 40, y: 565 };
  const fakeBomber3 = { ...sampleBomber, score: 0, x: 565, y: 40 };
  BOMBERS.push(fakeBomber3)
  BOMBERS.push(fakeBomber1)
  BOMBERS.push(fakeBomber2)

  const zeroScoreBombers = BOMBERS.filter(b => b && b.score === 0);
  FROZEN_BOTS.push(...zeroScoreBombers);
}, 15000);

function writeLog(...args) {
  console.log(...args)

  //blindcodemode
  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null) : String(a)
  ).join(' ');

  const log = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync('log.txt', log);
}

function checkBomAvailables(myBomber) {
  // Count active bombs owned by this bomber (tracked by uid)
  const ownedActiveBombs = BOMBS.filter(b => b && b.uid === myBomber.uid).length;

  return ownedActiveBombs < myBomber.bombCount
}
