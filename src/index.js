import dotenv from 'dotenv';
import * as helpers from './helpers.js';
import { io } from 'socket.io-client';
import sampleBomber from './sample/bomber.js';
import sampleMap from './sample/map.js';
import sampleItem from './sample/item.js';

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
let SPEED = 2

// socket.on('user', (data) => {
//   MAP = data.map;
//   BOMBERS = data.bombers;
//   BOMBS = data.bombs;
//   CHESTS = data.chests;
//   ITEMS = data.items;
//   if (process.env.ENV == 'local')
//     GAME_START = true
// });

// socket.on('start', () => {
//   GAME_START = true
// })

// socket.on('new_enemy', (data) => {
//   for (const bomber of data.bombers) {
//     helpers.upsertBomber(BOMBERS, bomber);
//   }
// });

// socket.on('player_move', (payload) => {
//   helpers.upsertBomber(BOMBERS, payload);
// });

// socket.on('new_bomb', (payload) => {
//   upsertBomb(payload);
//   // Add danger zone tiles for this bomb based on explosion range
//   addDangerZonesForBomb(payload);
// });

// socket.on('item_collected', (payload) => {
//   if (payload.bomber && payload.bomber.name === process.env.BOMBER_NAME) {
//     if (payload.item.type === 'SPEED') {
//       SPEED += 1
//     }
//   }
//   // remove collected item from ITEMS (match both x and y)
//   ITEMS = ITEMS.filter(i => !(i && i.x === payload.item.x && i.y === payload.item.y));
// });

// socket.on('bomb_explode', (payload) => {
//   console.log('bomb explode', payload.uid);
//   //remove bomb from BOMBS
//   BOMBS = BOMBS.filter(b => b.id !== payload.id);
//   // Remove danger zones associated with this bomb
//   removeDangerZonesForBomb(payload.id);
// });

// socket.on('map_update', (payload) => {
//   console.log('map update', );
//   const chestCoords = new Set(payload.chests.map(c => `${c.x},${c.y}`));
//   for (let i = CHESTS.length - 1; i >= 0; i--) {
//     if (!chestCoords.has(`${CHESTS[i].x},${CHESTS[i].y}`)) {
//       //update map (chest removed so set to null)
//       MAP[CHESTS[i].y / helpers.WALL_SIZE][CHESTS[i].x / helpers.WALL_SIZE] = null;
//       console.log('y', CHESTS[i].y / helpers.WALL_SIZE);
//       console.log('x', CHESTS[i].x / helpers.WALL_SIZE);
//       CHESTS.splice(i, 1);
//     }
//   }
//   ITEMS = payload.items;
// });

function blindCodeMode() {
  BOMBERS.push({ ...sampleBomber });
  MAP = sampleMap;
  ITEMS.push({ ...sampleItem });
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
  console.log('Sent join event');

  while(!GAME_START) {
    await sleep(100)
  }

  while(BOMBERS.length === 0) {
    await sleep(100)
  }

  while(true) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
    console.log('myboy', myBomber.x, myBomber.y)

    if (helpers.isInDanger(myBomber, DANGER_ZONE)) {
      const safetyZone = helpers.findNearestSafetyZone(myBomber, MAP, DANGER_ZONE);
      console.log('In danger! Moving to safety zone...', safetyZone);
      if (safetyZone) {
        const path = findPathToTarget(helpers.toMapCoord(safetyZone), false);
        if (path && path.length > 1) {
          const step = nextStep(path);
          if (step) {
            move(step);
            await sleep(1000 / 60 / SPEED);
            continue;
          }
        }
      } else {
        console.log('no safety zone', )
      }
    }

    const reachableItem = findReachableItem();

    if (reachableItem) {
      console.log('moving to reachable item', reachableItem.path.length);
      move(nextStep(reachableItem.path));
    } else {
      console.log('dont have reachable item', );
      const walkableNeighbors = helpers.getWalkableNeighbors(MAP, myBomber);
      const allPlaces = helpers.findAllPossiblePlaceBoom(myBomber, MAP, walkableNeighbors)

      if (allPlaces && allPlaces.length > 0) {

        for (const place of allPlaces) {
          // console.log('place', place)
          const safeZones = helpers.countSafeZonesAfterPlaceBoom(helpers.toMapCoord(place), myBomber.explosionRange, DANGER_ZONE, MAP, walkableNeighbors);
          if (safeZones) {
            const gridPath = findPathToTarget(helpers.toMapCoord(place))
            // console.log('gridPath', gridPath)
            if (gridPath && gridPath.length > 1) {
              if (helpers.isInDanger(helpers.toMapCoord(gridPath[1]), DANGER_ZONE)) {
                console.log('path 1 in danger zone so dont move');
                console.log('place', place);
                const last = gridPath[gridPath.length - 1];
                console.log('MAP[last.y][last.x]',last.y, last.x, MAP[last.y][last.x]);
              } else {
                const middlePoint = helpers.getMidPoint(gridPath);
                const pathToMidPoint = findPathToTarget(middlePoint, false)

                if (pathToMidPoint) {
                  if (pathToMidPoint.length > 1) {
                    const step = nextStep(pathToMidPoint);
                    if (step) {
                      move(step);
                    } else {
                      console.log('no step');
                    }
                  } else {
                    console.log('touch pathToMidPoint', )
                    placeBoom(myBomber);
                    getDestroyedChests(myBomber);
                    //Calculate which chest is going to be destroyed and mark it as wall
                    // console.log('hehe', getDestroyedChests(myBomber))
                  }
                }
              }
            } else if (gridPath && gridPath.length < 2) {
              console.log('touch nearest chest', gridPath)
              placeBoom(myBomber);
              getDestroyedChests(myBomber);
              //remove chest and update map
              // console.log('hehe', getDestroyedChests(myBomber))
            }
            break;
          } else {
            console.log('no safe zone', place)
          }
        }
      } else {
        console.log('allPlaces', allPlaces)
        console.log('MAP', MAP);
        console.log('walkableNeighbors', walkableNeighbors);
        console.log('myBomber', myBomber);
        throw new Error(`no all places`)
      }
    }
    await (sleep(1000 / 60 / SPEED));
  }
});

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const move = (orient) => {
  socket.emit('move', {
    orient: orient
  })

  //blindcodemode
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  if (!myBomber) return;

  if (orient === 'UP') myBomber.y -= (myBomber.speed + myBomber.speedCount)
  if (orient === 'DOWN') myBomber.y += (myBomber.speed + myBomber.speedCount)
  if (orient === 'LEFT') myBomber.x -= (myBomber.speed + myBomber.speedCount)
  if (orient === 'RIGHT') myBomber.x += (myBomber.speed + myBomber.speedCount)
}

const placeBoom = (myBomber = null) => {
  console.log('placed boom at ', myBomber.x, myBomber.y)
  socket.emit('place_bomb', {})

  //blindcodemode
  const bomID = `random-${Date.now()}`
  addDangerZonesForBomb({
    id: bomID,
    x: myBomber.x,
    y: myBomber.y,
    uid: myBomber.uid,
  })
  setTimeout(() => {
    console.log('bomb explode', );
    console.log('bomb explode', );
    console.log('bomb explode', );
    console.log('bomb explode', );
    console.log('bomb explode', );
    removeDangerZonesForBomb(bomID);
    console.log('destroyed Chest', );
    console.log('chest before', CHESTS.length);
    CHESTS.filter(x => x.isDestroyed).map(c => {
      MAP[c.y / helpers.WALL_SIZE][c.x / helpers.WALL_SIZE] = null
      console.log('y', c.y / helpers.WALL_SIZE);
      console.log('x', c.x / helpers.WALL_SIZE);
    })
    CHESTS = CHESTS.filter(x => !x.isDestroyed)
    console.log('chest after', CHESTS.length);
    if (CHESTS.length == 82)
      console.log('-------------------------------------------------------------------------------------------------------------', );
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
  console.log('DANGER ZONE AFTER REMOVE', DANGER_ZONE);
}

function upsertBomb(payload) {
  const id = payload.id;
  if (!id) return;

  const idx = BOMBS.findIndex(b => b && (b.id === id));
  if (idx !== -1) {
    // merge update to preserve other bomb metadata
    BOMBS[idx] = { ...BOMBS[idx], ...payload };
  } else {
    BOMBS.push(payload);
  }
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
  if (next.x < current.x) return 'LEFT';
  if (next.y > current.y) return 'DOWN';
  if (next.y < current.y) return 'UP';

  return null;
}

// Wrapper to compute path using helpers with correct inputs
function findPathToTarget(target, isGrid = true) {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);

  return helpers.findPathToTarget(myBomber, target, MAP, isGrid);
}


function getDestroyedChests(bomber) {
  const { x: startCol, y: startRow } = helpers.toGridCoord(bomber);

  // Tính cả vị trí bom
  const inBounds = (r, c) => r >= 0 && c >= 0 && r < MAP.length && c < MAP[0].length;

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
          MAP[r][c] = 'W'; // ✅ cập nhật MAP
          console.log('update map to w when place boom', r, c);
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
}, 30000); // 30 giây
