import dotenv from 'dotenv';
import * as helpers from './helpers.js';
import { io } from 'socket.io-client';
import fs from 'fs';
import sampleBomber from './sample/bomber.js';
import sampleMap from './sample/mapTho.js';

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
let connectedMap = false;
let CONNECTED_AT = 0;
let globalExplosionRange = 2
const DANGER_ZONE = []
const FILE_NAME='log.txt'
const chestMap = new Map();
const safeZones = new Map();

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
  // Reset connection-related state on finish before reconnecting
  connectedMap = false;
  CONNECTED_AT = 0;
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
  const gridCoord = helpers.toGridCoordFloor(payload)
  markBombOnMap();
  for (const [key, value] of safeZones) {
    if (gridCoord.x == value.x && gridCoord.y == value.y) {
      safeZones.delete(key);
      break;
    }
  }
});

socket.on('new_bomb', (payload) => {
  payload = {...payload, createdAt: Date.now()}
  helpers.upsertItem(BOMBS, payload, 'id');
  addDangerZonesForBomb(payload);
  markBombOnMap();
});

socket.on('user_disconnect', (payload) => {
  BOMBERS = payload.bombers
})

socket.on('item_collected', (payload) => {
  ITEMS = ITEMS.filter(i => !(i && i.x === payload.item.x && i.y === payload.item.y));
  if (payload.item.type === 'R' && payload.bomber && payload.bomber.name === process.env.BOMBER_NAME) {
    globalExplosionRange += 1
    updateChestMap(globalExplosionRange)
  }
});

socket.on('bomb_explode', (payload) => {
  for (const area of payload.explosionArea) {
    if (MAP[area.y / helpers.WALL_SIZE][area.x / helpers.WALL_SIZE] == null) continue;

    MAP[area.y / helpers.WALL_SIZE][area.x / helpers.WALL_SIZE] = null;
  }

  BOMBS = BOMBS.filter(b => b.id !== payload.id);
  removeDangerZonesForBomb(payload.id);
  DANGER_ZONE.length = 0
  for (const bomb of BOMBS) {
    DANGER_ZONE.push(...helpers.createDangerZonesForBomb(
      bomb,
      BOMBERS.find(x => x.name === bomb.ownerName)?.explosionRange || 2,
      MAP,
    ))
  }
});

socket.on('map_update', (payload) => {
  ITEMS = payload.items;
  for (let i = 0; i < ITEMS.length; i++) {
    const gridCoord = helpers.toGridCoordFloor(ITEMS[i])
    if (!helpers.isWalkable(MAP, gridCoord.x + 1, gridCoord.y)
      || !helpers.isWalkable(MAP, gridCoord.x, gridCoord.y + 1)
    ) {
      ITEMS[i].blocked = true
    }
  }
  updateChestMap(globalExplosionRange)
  updateConnectedMap();
});

socket.on('user_die_update', (payload) => {
  if (payload.killed.name == process.env.BOMBER_NAME) {
  }
  if (process.env.ENV != 'local') {
    BOMBERS = BOMBERS.filter(b => b.name !== payload.killed.name)
  }
})

function blindCodeMode() {
  BOMBERS.push({ ...sampleBomber });
  MAP = sampleMap;
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
  updateChestMap()
}

socket.on('connect', async () => {
  // Reset connection-related state on (re)connect so timing restarts
  connectedMap = false;
  CONNECTED_AT = 0;
  socket.emit('join', {});
  // blindCodeMode()
  fs.writeFileSync(FILE_NAME, '');

  while(!GAME_START) {
    await sleep(1)
  }

  while(true) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
    const timeStartLoop = Date.now()
    const bombAvailable = checkBomAvailables(myBomber);

    // Xác định hành vi muốn thực hiện
    let action = null; // { type: 'attack' | 'break_chest' | 'idle', path: [...], target: {...} }
    // Chiến thuật luân phiên mỗi 30 giây kể từ khi map connected
    const baseTs = CONNECTED_AT || 0;
    const elapsedMs = baseTs ? (Date.now() - baseTs) : 0;
    const slotIndex = (elapsedMs / 30000) | 0; // 30s mỗi slot
    const strategy = slotIndex % 2 === 0 ? 'attack' : 'trap';

    // ƯU TIÊN TUYỆT ĐỐI: Dead-corner nếu có cơ hội (override mọi chiến thuật)
    if (bombAvailable && connectedMap && !action) {
      const enemiesDC = BOMBERS.filter(b => b.name !== myBomber.name);
      for (const enemy of enemiesDC) {
        const deadCornerBoomPlace = helpers.isDeadCorner(enemy, MAP);
        if (deadCornerBoomPlace) {
          const gridPath = helpers.findPathToTarget(myBomber, helpers.toMapCoord(deadCornerBoomPlace), MAP, true);
          if (gridPath && gridPath.length > 0) {
            action = {
              type: 'attack',
              path: gridPath,
              target: deadCornerBoomPlace,
              enemy: enemy,
              attackType: 'dead_corner'
            };
            break;
          }
        }
      }
    }

    // Trap strategy: di chuyển tới waitPosition và đứng chờ; nếu enemy vào trapPositions thì đặt bom
    if (!action && strategy === 'trap' && connectedMap) {
      const trapObjs = helpers.findTrapPositions(MAP) || [];
      if (trapObjs.length > 0) {
        const dangerSet = new Set(DANGER_ZONE.map(z => `${z.x},${z.y}`));
        const bombSet = new Set(BOMBS.map(b => {
          const g = helpers.toGridCoordSafe(b);
          return `${g.x},${g.y}`;
        }));

        const candidates = [];
        for (const t of trapObjs) {
          const wait = t.waitPosition;
          const key = `${wait.x},${wait.y}`;
          if (dangerSet.has(key) || bombSet.has(key)) continue;
          const path = helpers.findPathToTarget(myBomber, helpers.toMapCoord(wait), MAP, true);
          if (path && path.length > 0) {
            candidates.push({ trapObj: t, path });
          }
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => a.path.length - b.path.length);
          const best = candidates[0];
          action = {
            type: 'trap_wait',
            path: best.path,
            target: best.trapObj.waitPosition,
            attackType: 'trap',
            trapObj: best.trapObj,
          };
        } else {
        }
      } else {
      }
    }

    // ƯU TIÊN 1: Tấn công kẻ địch
    if (!action && bombAvailable && connectedMap) {
      // Tìm bot gần nhất có thể tấn công
      const enemies = BOMBERS.filter(b => b.name !== myBomber.name);
      let bestEnemyAction = null;

      // Ưu tiên 1: Kiểm tra dead corner và tunnel trap
      for (const enemy of enemies) {
        // Kiểm tra dead corner trước
        const deadCornerBoomPlace = helpers.isDeadCorner(enemy, MAP);
        if (deadCornerBoomPlace) {
          const gridPath = helpers.findPathToTarget(myBomber, helpers.toMapCoord(deadCornerBoomPlace), MAP, true);
          if (gridPath && gridPath.length > 0) {
            bestEnemyAction = {
              type: 'attack',
              path: gridPath,
              target: deadCornerBoomPlace,
              enemy: enemy,
              attackType: 'dead_corner'
            };
            break; // Ưu tiên dead corner cao nhất
          } else {
          }
        }
      }

      // Ưu tiên 2: Tấn công bình thường nếu không có dead corner
      if (!bestEnemyAction) {
        for (const enemy of enemies) {
          const allPos = helpers.getAllAttackPositions(myBomber, enemy, MAP, BOMBS, DANGER_ZONE);
          if (allPos && allPos.length > 0) {
            const gridCoord = helpers.toGridCoord(myBomber)
            // Tối ưu: tạo Set để lookup O(1) thay vì some() O(n)
            const posSet = new Set(allPos.map(pos => `${pos.x},${pos.y}`));
            const currentPosKey = `${gridCoord.x},${gridCoord.y}`;
            const isAtCurrentPos = posSet.has(currentPosKey);

            if (isAtCurrentPos) {
              bestEnemyAction = {
                type: 'attack',
                path: [gridCoord],
                target: gridCoord,
                enemy: enemy,
                attackType: 'normal'
              }
              break;
            } else {
              const bestPos = allPos[0];
              const pathToEnemy = helpers.findPathToTarget(myBomber, helpers.toMapCoord(bestPos), MAP, false);

              if (pathToEnemy && pathToEnemy.length > 0) {
                bestEnemyAction = {
                  type: 'attack',
                  path: pathToEnemy,
                  target: bestPos,
                  enemy: enemy,
                  attackType: 'normal'
                };
                break;
              }
            }
          }
        }
        if (!bestEnemyAction) {
          const itemAction = findReachableItem();
          if (itemAction) {
            action = {
              type: 'collect_item',
              path: itemAction.path,
              target: itemAction.item
            };
          } else {
          }
        }
      }

      // Kiểm tra item reachable và so sánh với khoảng cách tấn công
      if (bestEnemyAction) {
        const itemAction = findReachableItem();
        if (itemAction) {
          // Chuyển đổi path length sang grid cells nếu cần
          let attackDistance = bestEnemyAction.path.length;
          // Nếu path là map coord, cần ước tính khoảng cách grid
          if (bestEnemyAction.attackType === 'normal') {
            // Path là map coord, ước tính khoảng cách grid
            const startGrid = helpers.toGridCoord(myBomber);
            const targetGrid = helpers.toGridCoord(helpers.toMapCoord(bestEnemyAction.target));
            attackDistance = helpers.manhattanDistance(startGrid, targetGrid);
          }

          const itemDistance = (itemAction.path.length / helpers.WALL_SIZE) | 0;
          const distanceDiff = attackDistance - (itemDistance - 2);


          if (distanceDiff > 0) {
            // Khoảng cách tấn công > khoảng cách nhặt item - 2, ưu tiên nhặt item
            action = {
              type: 'collect_item',
              path: itemAction.path,
              target: itemAction.item
            };
          } else {
            // Ưu tiên tấn công
            action = bestEnemyAction;
          }
        } else {
          // Không có item reachable, ưu tiên tấn công
          action = bestEnemyAction;
        }
      } else {
      }
    } else {
    }

    // ƯU TIÊN 2: Phá rương hoặc nhặt item (nếu không có hành động tấn công)
    if (!action) {
      const walkableNeighbors = helpers.getWalkableNeighbors(MAP, myBomber);
      let bestChestAction = null;
      let maxChests = 0;

      if (bombAvailable) {
        // Tìm vị trí phá nhiều chest nhất
        const allPlaces = helpers.findAllPossiblePlaceBoom(myBomber, MAP, chestMap, walkableNeighbors, DANGER_ZONE);
        if (allPlaces && allPlaces.length > 0) {
          for (const place of allPlaces) {
            const mapCoordPlace = helpers.toMapCoord(place);
            if (BOMBS.some(b => b.x === mapCoordPlace.x && b.y === mapCoordPlace.y)) {
              continue;
            }

            if (place.score > maxChests) {
              const gridPath = helpers.findPathToTarget(myBomber, mapCoordPlace, MAP, true);

              if (gridPath && gridPath.length > 0) {
                maxChests = place.score;
                bestChestAction = {
                  type: 'break_chest',
                  path: gridPath,
                  target: place,
                  chestCount: place.score
                };
              }
            }
          }
        }
      }

      // Tìm item có thể nhặt được
      const itemAction = findReachableItem();
      let bestItemAction = null;
      if (itemAction) {
        bestItemAction = {
          type: 'collect_item',
          path: itemAction.path,
          target: itemAction.item
        };
      }

      // Quyết định ưu tiên giữa đặt bom và nhặt item
      if (bestChestAction && bestItemAction) {
        // Nếu vị trí đặt bom rất gần (đã ở đó hoặc chỉ cần 1-2 bước)
        // và không ảnh hưởng đến việc nhặt item, ưu tiên đặt bom trước
        const bombPathLength = bestChestAction.path.length;
        const itemPathLength = bestItemAction.path.length / helpers.WALL_SIZE * myBomber.speed | 0;
        const wouldBlock = wouldBombBlockItem(
          bestChestAction.target,
          bestItemAction.target,
          myBomber
        );


        if (wouldBlock) {
          action = bestItemAction
        } else if (bombPathLength <= 2) {
          action = bestChestAction;
        } else if (itemPathLength < bombPathLength) {
          action = bestItemAction;
        } else {
          action = bestChestAction;
        }
      } else if (bestChestAction) {
        action = bestChestAction;
      } else if (bestItemAction) {
        action = bestItemAction;
      } else {
      }
    }

    // ƯU TIÊN 3: Kiểm tra an toàn và thực hiện hành động
    const hasPath = action && action.path && action.path.length >= 1;

    if (hasPath && action.path.length <= 1) {
      // Đã ở tại vị trí mục tiêu
      const requiresBomb = action.type === 'attack' || action.type === 'break_chest';
      const gridCoordPlace = helpers.toGridCoord(action.path[0]);
      const isBombHere = BOMBS.some(b => {
        const gridCoordBomber = helpers.toGridCoordSafe(b);
        return gridCoordBomber.x === gridCoordPlace.x && gridCoordBomber.y === gridCoordPlace.y
      });

      if (requiresBomb && (!bombAvailable || isBombHere)) {
        if (!moveToSafetyZone(myBomber)) {
        }
        await sleep(15 - (Date.now() - timeStartLoop));
        continue;
      }

      if (action.type === 'attack' && action.target) {
        placeBoom(myBomber, action.attackType === '');
        // Sau khi đặt bom, ưu tiên di chuyển tới vùng an toàn
        if (!moveToSafetyZone(myBomber)) {
        }
      } else if (action.type === 'trap_wait') {
        // Đứng chờ: nếu enemy bước vào một trong các trapPositions thì đặt bom
        const gridHere = helpers.toGridCoord(myBomber);
        const enemies = BOMBERS.filter(b => b.name !== myBomber.name);
        const trapEntries = new Set((action.trapObj?.trapPositions || []).map(p => `${p.x},${p.y}`));
        let enemyInTrap = null;
        for (const enemy of enemies) {
          const eg = helpers.toGridCoord(enemy);
          const key = `${eg.x},${eg.y}`;
          if (trapEntries.has(key)) {
            enemyInTrap = { enemy: enemy.name, pos: eg };
            break;
          }
        }
        const isBombHere = BOMBS.some(b => {
          const g = helpers.toGridCoordSafe(b);
          return g.x === gridHere.x && g.y === gridHere.y;
        });
        if (enemyInTrap && bombAvailable && !isBombHere) {
          placeBoom(myBomber);
          if (!moveToSafetyZone(myBomber)) {
          }
        } else {
        }
      } else if (action.type === 'break_chest') {
        placeBoom(myBomber);
      } else if (action.type === 'collect_item') {
      }

      const currentlyInDanger = helpers.isInDanger(myBomber, DANGER_ZONE);
      if (currentlyInDanger) {
        if (!moveToSafetyZone(myBomber)) {
        }
        await sleep(15 - (Date.now() - timeStartLoop));
        continue;
      }
    } else if (hasPath && action.path.length > 1) {
      // Tính toán đường đi với middle point nếu cần
      let finalPath = action.path;
      let isGridPath = false;

      // Xác định loại path (grid hay map coord)
      if (finalPath[0] && finalPath[0].x < helpers.WALL_SIZE * 2) {
        isGridPath = true;
      } else {
      }

      if (action.path.length >= 2 && isGridPath) {
        const middlePoint = helpers.getMidPoint(action.path, 0, action.type);
        const pathToMidPoint = helpers.findPathToTarget(myBomber, middlePoint, MAP, false);
        if (pathToMidPoint && pathToMidPoint.length > 1) {
          finalPath = pathToMidPoint;
          isGridPath = false; // pathToMidPoint luôn là map coord
        }
      }

      // Đánh giá mức độ nguy hiểm của bước đi tiếp theo
      const nextStepPos = finalPath[1];
      // Chuyển đổi sang map coord nếu là grid coord
      const mapCoordPos = isGridPath ? helpers.toMapCoord(nextStepPos) : nextStepPos;
      const dangerLevel = evaluateDangerLevel(mapCoordPos, myBomber, DANGER_ZONE);

      if (dangerLevel.timeUntilExplosion < 0) {
      }
      if (dangerLevel.canMove) {
        const step = nextStep(finalPath);
        if (step) {
          move(step);
        } else {
        }
      } else {
        // Thay vì đứng im, tìm và chạy đến safety zone
        if (!moveToSafetyZone(myBomber)) {
        }
      }
    } else {
      // Không có hành động nào, kiểm tra nếu đang trong nguy hiểm
      if (helpers.isInDanger(myBomber, DANGER_ZONE)) {
        if (!moveToSafetyZone(myBomber, 'no_action_available')) {
        }
      } else {
      }
    }

    await sleep(15 - (Date.now() - timeStartLoop));
  }
});

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms > 0 ? ms : 3));
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
    updateChestMap(globalExplosionRange)
  } else {
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
  if (!ITEMS || ITEMS.length === 0) return null;

  const myGrid = helpers.toGridCoordFloor(myBomber);
  const validPaths = [];

  for (const item of ITEMS) {
    // Only consider items with Manhattan distance (grid) < 6
    const itemGrid = helpers.toGridCoordSafe(item);
    if (helpers.manhattanDistance(itemGrid, myGrid) >= 6) {
      continue;
    }

    // Use grid cell center as target (don't mutate original item)
    const targetMapCoord = helpers.toMapCoord({ x: itemGrid.x, y: itemGrid.y });
    const path = helpers.findPathToTarget(myBomber, targetMapCoord, MAP, false);

    if (path && path.length > 1) {
      validPaths.push({ item, path });
    }
  }

  if (validPaths.length > 0) {
    validPaths.sort((a, b) => a.path.length - b.path.length);
    return validPaths[0];
  }

  return null;
}

/**
 * Kiểm tra xem việc đặt bom tại vị trí bombPlace có ảnh hưởng đến việc nhặt item không
 * @param {Object} bombPlace - Vị trí đặt bom (grid coord: {x, y})
 * @param {Object} item - Item cần nhặt (map coord: {x, y})
 * @param {Object} myBomber - Bot của chúng ta
 * @returns {boolean} - true nếu đặt bom sẽ ảnh hưởng đến việc nhặt item
 */
function wouldBombBlockItem(bombPlace, item, myBomber) {
  if (!bombPlace || !item || !myBomber) return false;


  const bombGridCoord = bombPlace;
  const itemGridCoord = helpers.toGridCoord(item);
  const explosionRange = myBomber.explosionRange;

  // Kiểm tra xem item có nằm trong vùng nổ của bom không
  // Bom nổ theo hình chữ thập (4 hướng)
  const bombX = bombGridCoord.x;
  const bombY = bombGridCoord.y;
  const itemX = itemGridCoord.x;
  const itemY = itemGridCoord.y;

  // Kiểm tra xem item có nằm trên cùng hàng hoặc cột với bom không
  const sameRow = itemY === bombY;
  const sameCol = itemX === bombX;

  if (!sameRow && !sameCol) {
    // Item không nằm trên đường nổ, không ảnh hưởng
    return false;
  }

  // Kiểm tra khoảng cách
  let distance = 0;
  if (sameRow) {
    distance = Math.abs(itemX - bombX);
  } else {
    distance = Math.abs(itemY - bombY);
  }

  // Nếu item nằm trong phạm vi nổ
  if (distance <= explosionRange) {
    // Kiểm tra xem có tường chặn không (nếu có tường thì item không bị ảnh hưởng)
    const dir = sameRow
      ? (itemX > bombX ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 })
      : (itemY > bombY ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 });

    for (let step = 1; step <= distance; step++) {
      const checkX = bombX + dir.dx * step;
      const checkY = bombY + dir.dy * step;

      if (checkX < 0 || checkY < 0 || checkY >= MAP.length || checkX >= MAP[0].length) {
        break;
      }

      const tile = MAP[checkY][checkX];
      if (tile === 'W' || tile === 'C') {
        // Có tường hoặc chest chặn, item không bị ảnh hưởng
        return false;
      }
    }

    // Item nằm trong vùng nổ và không có gì chặn
    return true;
  }

  return false;
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

function checkBomAvailables(myBomber, forAttack = false) {
  // Count active bombs owned by this bomber (tracked by uid)
  const ownedActiveBombs = BOMBS.filter(b => b && b.uid === myBomber.uid).length;
  const availableBombSlots = myBomber.bombCount - ownedActiveBombs;

  if (forAttack) {
    // For attack: keep 1 bomb reserved, need at least 2 available (1 to use, 1 backup)
    return availableBombSlots > 1;
  } else {
    // For normal chest breaking: use all available bombs
    return availableBombSlots > 0;
  }
}

/**
 * Đánh giá mức độ nguy hiểm của một vị trí dựa trên DANGER_ZONE và tốc độ của bot
 * @param {Object} position - Vị trí cần đánh giá (map coord: {x, y} tính bằng pixel)
 * @param {Object} myBomber - Bot của chúng ta
 * @param {Array} dangerZones - Mảng các vùng nguy hiểm
 * @returns {Object} - { canMove: boolean, dangerLevel: number, timeUntilExplosion: number }
 */
function evaluateDangerLevel(position, myBomber, dangerZones) {
  if (!position || !myBomber || !dangerZones || dangerZones.length === 0) {
    return { canMove: true, dangerLevel: 0, timeUntilExplosion: Infinity };
  }

  // Tạo một bomber giả tại vị trí này để kiểm tra
  const testBomber = { ...myBomber, x: position.x, y: position.y };
  const { bomberRight, bomberBottom } = helpers.getBomberBound(testBomber);

  let minTimeUntilExplosion = Infinity;
  let minExplosionAt = Infinity;
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
        minExplosionAt = zone.explodeAt;
      }
    }
  }

  if (!isInDanger) {
    return { canMove: true, dangerLevel: 0, timeUntilExplosion: Infinity };
  }


  // Tính toán thời gian cần thiết để di chuyển ra khỏi vùng nguy hiểm
  // Dựa vào tốc độ của bot
  let estimatedEscapeTime = Infinity;
  let canMove = false;

  // Tìm safety zone gần nhất từ vị trí hiện tại
  const nearestSafetyZone = helpers.findNearestSafetyZone(testBomber, MAP, DANGER_ZONE);
  if (nearestSafetyZone) {
    // Đổi safety zone sang map coord mục tiêu giống moveToSafetyZone
    const safetyTargetMapCoord = helpers.toMapCoordAdvance(testBomber, nearestSafetyZone);

    // Khoảng cách Manhattan theo pixel giữa vị trí hiện tại và vị trí an toàn
    const distancePixels = helpers.manhattanDistance(position, safetyTargetMapCoord);


    // Số bước di chuyển cần thiết dựa trên tốc độ (pixel mỗi bước)
    const moveSpeed = myBomber.speed || 1;
    const stepsToEscape = distancePixels / moveSpeed;

    // Mỗi bước ~20ms như yêu cầu + 500ms buffer
    estimatedEscapeTime = stepsToEscape * 20 + 500;

    // Nếu thời gian cần thiết cộng với thời gian hiện tại lớn hơn thời điểm nổ => không kịp chạy
    if (minExplosionAt !== Infinity) {
      const arriveTime = Date.now() + estimatedEscapeTime;
      canMove = arriveTime <= minExplosionAt;
    } else {
      // Phòng trường hợp dữ liệu nổ không hợp lệ, cho phép di chuyển
      canMove = true;
    }
  } else {
    // Không tìm được safety zone thì coi như không thể chạy kịp
    canMove = false;
  }

  // Tính danger level (0-10, 10 là nguy hiểm nhất)
  let dangerLevel = 0;
  if (minTimeUntilExplosion < 1400) {
    dangerLevel = 10; // Rất nguy hiểm, sắp nổ
  } else if (minTimeUntilExplosion < 1900) {
    dangerLevel = 7; // Nguy hiểm
  } else if (minTimeUntilExplosion < 2900) {
    dangerLevel = 4; // Hơi nguy hiểm
  } else {
    dangerLevel = 1; // Ít nguy hiểm
  }


  return {
    canMove,
    dangerLevel,
    timeUntilExplosion: minTimeUntilExplosion,
    estimatedEscapeTime
  };
}

function moveToSafetyZone(myBomber, action = null) {
  if (!myBomber) return false;

  let safetyZone = null;
  // Khi chưa connectedMap: luôn dùng findNearestSafetyZone (nhanh hơn)
  // Khi đã connectedMap: thử findAllSafeZones trước, rồi mới dùng findNearestSafetyZone
  if (!connectedMap) {
    if (action) {
      safetyZone = safeZones.get(action)
      if (safetyZone) {
      } else {
        safetyZone = helpers.findNearestSafetyZone(myBomber, MAP, DANGER_ZONE);
        if (safetyZone) {
          safeZones.set(action, safetyZone)
        }
      }
    }
    else {
      safetyZone = helpers.findNearestSafetyZone(myBomber, MAP, DANGER_ZONE);
      if (safetyZone) {
      }
    }
  } else {
    const allSafetyZone = helpers.findAllSafeZones(helpers.toGridCoord(myBomber), MAP, DANGER_ZONE);
    if (allSafetyZone && allSafetyZone.length > 0) {
      safetyZone = allSafetyZone[0];
    } else {
      safetyZone = helpers.findNearestSafetyZone(myBomber, MAP, DANGER_ZONE);
      if (safetyZone) {
      }
    }
  }

  if (!safetyZone) {
    return false;
  }

  const safetyTargetMapCoord = helpers.toMapCoordAdvance(myBomber, safetyZone)
  const path = helpers.findPathToTarget(myBomber, safetyTargetMapCoord, MAP, false);
  if (path && path.length >= 1) {
    if (path.length === 1 && helpers.isInDanger(myBomber, DANGER_ZONE, true)) {
      path.push(helpers.toMapCoordAdvance(myBomber, safetyZone));
    }
    const step = nextStep(path);
    if (step) {
      move(step);
      return true;
    }
    return false;
  } else {
    safeZones.clear();
  }

  return false;
}

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

function markBombOnMap() {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  helpers.markOwnBombOnMap(myBomber, BOMBS, MAP, connectedMap)
}

function updateConnectedMap() {
  if (connectedMap) return;

  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  for (const bomber of BOMBERS) {
    if (bomber.name == myBomber.name) {
      continue;
    } else {
      const pathToOtherBot = helpers.findPathToTarget(myBomber, bomber, MAP)
      if (pathToOtherBot) {
        connectedMap = true
        if (!CONNECTED_AT) {
          CONNECTED_AT = Date.now();
        }
        break;
      }
    }
  }
}

function writeLog() {
  console.log(...args)

  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null) : String(a)
  ).join(' ');

  const log = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(FILE_NAME, log);
}
