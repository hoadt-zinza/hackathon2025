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
const DANGER_ZONE = []
let SPEED = 2

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
  upsertBomber(payload);
});

socket.on('new_bomb', (payload) => {
  upsertBomb(payload);
  // Add danger zone tiles for this bomb based on explosion range
  addDangerZonesForBomb(payload);
});

socket.on('item_collected', (payload) => {
  console.log('item_collected', payload)

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
  // console.log('Map updated', payload)
  // CHESTS = payload.chests;
  // ITEMS = payload.items;
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
    if (BOMBS.length > 0) {
      console.log('BOMBS', BOMBS)
      console.log('DANGER', DANGER_ZONE)
    }

    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);

    // Check if we're in danger and need to move to safety
    while (isInDanger()) {
      console.log('In danger! Moving to safety zone...');
      const safetyZone = helpers.findNearestSafetyZone(myBomber, MAP, DANGER_ZONE);
      if (safetyZone) {
        const path = findPathToTarget(helpers.toMapCoord(safetyZone), false);
        console.log('path_to_safe', path);
        if (path && path.length > 1) {
          const step = nextStep(path);
          if (step) {
            move(step);
            console.log('moving out danger zone', step);
            console.log('bomber', myBomber.x, myBomber.y);
            // Skip the rest of the loop to give time to move out of danger
            await sleep(1000 / 60 / SPEED);
            continue;
          }
        }
      }
    }

    const chest = findNearestChest();
    const item = findNearestItem();
    const path_to_item = item ? findPathToTarget(item) : null;

    if (item && path_to_item && path_to_item.length > 1) {
      console.log('moving to nearest item', myBomber.x, myBomber.y);
      move(nextStep(path_to_item));
    } else {
    if (chest) {
      const path = findPathToTarget(chest);
      console.log('path to chest', path)
      if (path && path.length > 1) {
        console.log('moving to nearest chest');
        const step = nextStep(path);
        if (step) move(step);
      } else if (path && path.length === 1) {
        console.log('touch nearest chest', )
        placeBoom();
        console.log('placed boom', myBomber.x, myBomber.y)
      }
    }}
    await (sleep(1000/60/SPEED));
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

const placeBoom = () => {
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
  // delegate to helper which returns a filtered array
  const filtered = helpers.removeDangerZonesForBomb(DANGER_ZONE, bombId);
  DANGER_ZONE.length = 0;
  for (const z of filtered) DANGER_ZONE.push(z);
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

function findNearestItem() {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  if (!myBomber || !Array.isArray(ITEMS) || ITEMS.length === 0) return null;

  let nearest = null;
  let bestDist2 = Infinity;

  for (const item of ITEMS) {
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

function nextStep(path) {
  // Expect path as an array of grid nodes from current -> ... -> target.
  // If there's no next step (path shorter than 2), return null.
  if (!path || path.length < 2) return null;
  const current = path[0];
  const next = path[1];

  if (next.x > current.x) return 'RIGHT';
  if (next.x < current.x) return 'LEFT';
  if (next.y > current.y) return 'DOWN';
  if (next.y < current.y) return 'UP';

  return null;
}

// Check if current position is in danger zone
function isInDanger() {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  if (!myBomber) return false;

  // Use bombs/bombers to determine if current bomber is inside any bomb cross area
  return helpers.isInDanger(myBomber, DANGER_ZONE);
}

// Wrapper to compute path using helpers with correct inputs
function findPathToTarget(target, isGrid = true) {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);

  return helpers.findPathToTarget(myBomber, target, MAP, isGrid);
}
