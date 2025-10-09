require('dotenv').config();
const io = require('socket.io-client');
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
const MAP_SIZE = 640
const BOMBER_SIZE = 35
const WALL_SIZE = 40
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
  upsertBomber(payload);
});

socket.on('new_bomb', (payload) => {
  upsertBomb(payload);
});

socket.on('item_collected', (payload) => {
  console.log('item_collected', payload)

  if (payload.bomber && payload.bomber.name === process.env.BOMBER_NAME) {
    if (payload.item.type === 'SPEED') {
      SPEED += 1
    }
  }
  //remove item from ITEMS
  ITEMS = ITEMS.filter(i => i.x !== payload.item.x && i.y !== payload.item.y);
});

socket.on('bomb_explode', (payload) => {
  //remove bomb from BOMBS
  BOMBS = BOMBS.filter(b => b.id !== payload.id);
});

socket.on('map_update', (payload) => {
  // console.log('Map updated', payload)
  // CHESTS = payload.chests;
  // ITEMS = payload.items;
});

function blindCodeMode() {
  const sampleBomber = require('./sample/bomber');
  const sampleChest = require('./sample/chest');
  const sampleMap = require('./sample/map');
  const sampleItem = require('./sample/item');

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

  blindCodeMode()

  while(BOMBERS.length === 0) {
    await sleep(100)
  }

  while(true) {
    const chest = findNearestChest();
    const item = findNearestItem();

    if (item) {
      const path = findPathToTarget(item);
      if (path && path.length > 1) {
        move(nextStep(path));
      }
    }

    if (chest) {
      const path = findPathToTarget(chest);
      if (path && path.length > 1) {
        console.log('moving to nearest chest');
        const step = nextStep(path);
        if (step) move(step);
      } else if (path && path.length === 1) {
        console.log('touch nearest chest', )
        // already on the chest tile
        placeBoom();
        console.log('placed boom', )
        // moveToSafeArea();
      }
    }
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
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  if (!myBomber) return;
  if (orient === 'UP') myBomber.y -= 2
  if (orient === 'DOWN') myBomber.y += 2
  if (orient === 'LEFT') myBomber.x -= 2
  if (orient === 'RIGHT') myBomber.x += 2
}

const placeBoom = () => {
  socket.emit('place_bomb', {})
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

const DIRS = [
  {dx: 0, dy: -1},
  {dx: 1, dy: 0},
  {dx: 0, dy: 1},
  {dx: -1, dy: 0}
];

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

function isWalkable(x, y) {
  const v = MAP[y][x];
  // Walls and chest are NOT walkable before destroyed
  return v === null || v === 'B' || v === 'R' || v === 'S';
}

function heuristic(a, b) {
  // Manhattan distance
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function toGridCoord(pos) {
  return { x: Math.floor(pos.x / WALL_SIZE), y: Math.floor(pos.y / WALL_SIZE) };
}

// Greedy Best-First Search
function findPathToTarget(target) {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  if (!myBomber || !target) return null;

  const start = toGridCoord(myBomber);
  const goal = toGridCoord(target);

  const visited = new Set();
  const cameFrom = new Map();

  // Priority queue theo heuristic
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
      if (target.type === 'C') return path.reverse().slice(0, -1)
      return path.reverse();
    }

    visited.add(`${current.x},${current.y}`);

    for (const dir of DIRS) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      if (!isWalkable(nx, ny) && !(nx === goal.x && ny === goal.y)) continue;
      if (visited.has(`${nx},${ny}`)) continue;
      if (!open.find(n => n.x === nx && n.y === ny)) {
        cameFrom.set(`${nx},${ny}`, current);
        open.push({ x: nx, y: ny, h: heuristic({ x: nx, y: ny }, goal) });
      }
    }
  }

  return null;
}
