import dotenv from 'dotenv';
import * as helpers from './helpers.js';
import { io } from 'socket.io-client';
import sampleBomber from './sample/bomber.js';
import sampleChest from './sample/chest.js';
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
let SPEED = 1

socket.on('user', (data) => {
  MAP = data.map;
  BOMBERS = data.bombers;
  BOMBS = data.bombs;
  CHESTS = data.chests;
  ITEMS = data.items;
});

socket.on('start', () => {
  GAME_START = true
})

socket.on('new_enemy', (data) => {
  for (const bomber of data.bombers) {
    upsertBomber(bomber);
  }
});

socket.on('player_move', (payload) => {
  console.log('p', payload);
  upsertBomber(payload);
});

socket.on('new_bomb', (payload) => {
  upsertBomb(payload);
  // Add danger zone tiles for this bomb based on explosion range
  addDangerZonesForBomb(payload);
});

socket.on('item_collected', (payload) => {
  if (payload.bomber && payload.bomber.name === process.env.BOMBER_NAME) {
    if (payload.item.type === 'SPEED') {
      SPEED += 1
    }
  }
  // remove collected item from ITEMS (match both x and y)
  ITEMS = ITEMS.filter(i => !(i && i.x === payload.item.x && i.y === payload.item.y));
});

socket.on('bomb_explode', (payload) => {
  //remove bomb from BOMBS
  BOMBS = BOMBS.filter(b => b.id !== payload.id);
  // Remove danger zones associated with this bomb
  removeDangerZonesForBomb(payload.id);
});

socket.on('map_update', (payload) => {
  const chestCoords = new Set(payload.chests.map(c => `${c.x},${c.y}`));
  for (let i = CHESTS.length - 1; i >= 0; i--) {
    if (!chestCoords.has(`${CHESTS[i].x},${CHESTS[i].y}`)) {
      //update map (chest removed so set to null)
      MAP[CHESTS[i].y / helpers.WALL_SIZE][CHESTS[i].x / helpers.WALL_SIZE] = null;
      CHESTS.splice(i, 1);
    }
  }
  ITEMS = payload.items;
});

function blindCodeMode() {
  BOMBERS.push({ ...sampleBomber });
  CHESTS.push({ ...sampleChest });
  MAP = sampleMap;
  ITEMS.push({ ...sampleItem });
}

socket.on('connect', async () => {
  console.log('Connected to server');
  socket.emit('join', {});
  console.log('Sent join event');
  if (process.env.ENV == 'local')
    GAME_START = true

  while(!GAME_START) {
    await sleep(100)
  }

  // blindCodeMode()

  while(BOMBERS.length === 0) {
    await sleep(100)
  }

  while(true) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
    console.log('myboy', myBomber.x, myBomber.y)

    if (helpers.isInDanger(myBomber, DANGER_ZONE)) {
      console.log('DANGER_ZONE', DANGER_ZONE)
      const safetyZone = helpers.findNearestSafetyZone(myBomber, MAP, DANGER_ZONE);
      console.log('In danger! Moving to safety zone...', safetyZone);
      if (safetyZone) {
        const path = findPathToTarget(helpers.toMapCoord(safetyZone), false);
        console.log('path_to_safe', safetyZone)
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
      console.log('moving to reachable item', myBomber.x, myBomber.y, reachableItem.path);
      move(nextStep(reachableItem.path));
    } else {
      const chest = findNearestChest();
      if (chest) {
        const path_to_chest = findPathToTarget(chest);

        if (path_to_chest && path_to_chest.length > 1) {
          if (helpers.isInDanger(helpers.toMapCoord(path_to_chest[1]), DANGER_ZONE)) {
            console.log('path 1 in danger zone so dont move', path_to_chest[1], DANGER_ZONE);
          } else {
            const path_to_perfect_point = findPathToTarget(helpers.getMidPoint(path_to_chest), false);

            if (path_to_perfect_point) {
              if (path_to_perfect_point.length === 1) {
                console.log('touch path_to_perfect_point', )
                const safeZones = helpers.countSafeZonesAfterPlaceBoom(myBomber, DANGER_ZONE, MAP);
                if (safeZones)
                  placeBoom(myBomber);
              } else {
                const step = nextStep(path_to_perfect_point);
                if (step) {
                  move(step);
                } else {
                  console.log('no step', );
                }
              }
            } else {
              console.log('no path to perfect point', );
            }
          }
        } else if (path_to_chest && path_to_chest.length === 1) {
          console.log('touch nearest chest', )
          const safeZones = helpers.countSafeZonesAfterPlaceBoom(myBomber, DANGER_ZONE, MAP);
          if (safeZones) {
            placeBoom(myBomber);
          }
        } else {
          console.log('chest', chest)
          console.log('clgt', path_to_chest);
        }
      } else {
        console.log('no chest', );
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

  //blind code mode
  // const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  // if (!myBomber) return;
  // if (orient === 'UP') myBomber.y -= 2
  // if (orient === 'DOWN') myBomber.y += 2
  // if (orient === 'LEFT') myBomber.x -= 2
  // if (orient === 'RIGHT') myBomber.x += 2
}

const placeBoom = (myBomber = null) => {
  console.log('placed boom at ', myBomber.x, myBomber.y)
  socket.emit('place_bomb', {})
}

// Add danger zones for a specific bomb using bomber.explosionRange
function addDangerZonesForBomb(bomb) {
  if (!bomb) return;

  const placingBomber = BOMBERS.find(b => b && b.uid === bomb.uid);
  const newZones = helpers.createDangerZonesForBomb(bomb, placingBomber, MAP);
  for (const z of newZones) DANGER_ZONE.push(z);
}

function removeDangerZonesForBomb(bombId) {
  // Remove all danger zones associated with this bomb
  const filtered = DANGER_ZONE.filter(z => z.bombId !== bombId);
  DANGER_ZONE.length = 0;
  DANGER_ZONE.push(...filtered);
  // console.log('DANGER ZONE AFTER REMOVE', DANGER_ZONE);
}

function upsertBomber(payload) {
  const uid = payload.uid;
  if (!uid) return;

  // Tìm vị trí bomber có cùng uid
  const idx = BOMBERS.findIndex(b => b && (b.uid === uid));

  if (idx !== -1) {
    // Cập nhật bomber hiện có
    BOMBERS[idx] = { ...BOMBERS[idx], ...payload };
  } else {
    // Thêm bomber mới
    BOMBERS.push(payload);
  }
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

function findNearestChest() {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  if (!myBomber || !Array.isArray(CHESTS) || CHESTS.length === 0) return null;

  let nearest = null;
  let bestDist2 = Infinity;

  for (const chest of CHESTS) {
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

setTimeout(() => {
  const zeroScoreBombers = BOMBERS.filter(b => b && b.score === 0);
  FROZEN_BOTS.push(...zeroScoreBombers);
}, 30000); // 30 giây
