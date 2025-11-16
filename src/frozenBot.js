import dotenv from 'dotenv';
import { io } from 'socket.io-client';
import * as helpers from './helpers.js';
import sampleMap from './sample/mapKim.js';

dotenv.config();
const auth = { token: process.env.TOKEN2 };
const socket = io(process.env.SOCKET_SERVER, {
  auth: auth,
});

socket.on('connect', async () => {
  console.log('Connected to server frozen BOT');
  socket.emit('join', {});
})

socket.on('finish', (data) => {
  socket.disconnect();
  socket.connect();
  socket.emit('join', {});
})

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

socket.on('user', (data) => {
  // console.log(data.map);
});

function countExits(br, bc) {
  if (!helpers.isWalkable(sampleMap, br, bc)) return 0;

  const visited = new Set();
  const q = [];
  q.push((br << 16) | bc);
  visited.add((br << 16) | bc);

  console.log(`q`, q);
  console.log(`visited`, visited);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  // BFS
  for (let qi = 0; qi < q.length; qi++) {
    const code = q[qi];
    const r = code >> 16;
    const c = code & 0xffff;

    for (let k = 0; k < 4; k++) {
      const nr = r + dirs[k][0];
      const nc = c + dirs[k][1];

      // Không cần check out-of-bound vì map bao bởi W
      if (!helpers.isWalkable(sampleMap, nr, nc)) continue;

      const ncode = (nr << 16) | nc;
      if (!visited.has(ncode)) {
        visited.add(ncode);
        q.push(ncode);
      }
    }
  }

  // Đếm số cửa thoát
  let exitCount = 0;

  for (let qi = 0; qi < q.length; qi++) {
    const code = q[qi];
    const r = code >> 16;
    const c = code & 0xffff;

    for (let k = 0; k < 4; k++) {
      const nr = r + dirs[k][0];
      const nc = c + dirs[k][1];

      // Nếu ô neighbor đi được nhưng không thuộc visited → đây là cửa thoát
      if (helpers.isWalkable(sampleMap, nr, nc)) {
        const ncode = (nr << 16) | nc;
        if (!visited.has(ncode)) {
          exitCount++;
        }
      }
    }
  }

  return exitCount;
}

const exitss = countExits(1, 1);
// console.log(`exits`, exitss);

function evaluateDangerLevel(position, myBomber, dangerZones) {
  if (!position || !myBomber || !dangerZones || dangerZones.length === 0) {
    return { canMove: true, dangerLevel: 0, timeUntilExplosion: Infinity };
  }

  // Tạo một bomber giả tại vị trí này để kiểm tra
  const testBomber = { ...myBomber, x: position.x, y: position.y };
  const { bomberRight, bomberBottom } = helpers.getBomberBound(testBomber);

  let minTimeUntilExplosion = Infinity;
  let isInDanger = false;

  // Kiểm tra tất cả các danger zones
  for (const zone of dangerZones) {
    const tileLeft = zone.x * helpers.WALL_SIZE;
    const tileRight = (zone.x + 1) * helpers.WALL_SIZE;
    const tileTop = zone.y * helpers.WALL_SIZE;
    const tileBottom = (zone.y + 1) * helpers.WALL_SIZE;

    const overlapX = testBomber.x <= tileRight && bomberRight >= tileLeft;
    const overlapY = testBomber.y <= tileBottom && bomberBottom >= tileTop;

    if (overlapX && overlapY) {
      isInDanger = true;
      const timeUntilExplosion = zone.explodeAt - Date.now();
      if (timeUntilExplosion < minTimeUntilExplosion) {
        minTimeUntilExplosion = timeUntilExplosion;
      }
    }
  }

  if (!isInDanger) {
    return { canMove: true, dangerLevel: 0, timeUntilExplosion: Infinity };
  }

  let canMove = false;

  // Tính danger level (0-10, 10 là nguy hiểm nhất)
  let dangerLevel = 0;
  if (minTimeUntilExplosion < 1400) {
    dangerLevel = 10; // Rất nguy hiểm, sẽ nổ trong 1 giây
    canMove = false
  } else if (minTimeUntilExplosion < 1900) {
    dangerLevel = 7; // Nguy hiểm
    canMove = myBomber.speed > 1
  } else if (minTimeUntilExplosion < 2900) {
    dangerLevel = 4; // Hơi nguy hiểm
    canMove = true
  } else {
    dangerLevel = 1; // Ít nguy hiểm
    canMove = true
  }

  return {
    canMove,
    dangerLevel,
    timeUntilExplosion: minTimeUntilExplosion
  };
}

// const myBomber = { x: 118, y: 83, speed: 2}
// const position = { x: 118, y: 85 }
// const dangerZone = { x: 3, y: 3, explodeAt: Date.now() + 1000 }
// console.log("check", evaluateDangerLevel(position, myBomber, [dangerZone]))