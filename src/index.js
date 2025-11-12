import dotenv from 'dotenv';
import * as helpers from './helpers.js';
import { io } from 'socket.io-client';
import fs from 'fs';
import sampleBomber from './sample/bomber.js';
import sampleMap from './sample/map.js';

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
let GAME_START_AT = null;
let KILL_BOOM = new Set();
const FILE_NAME='log.txt'

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
    helpers.upsertItem(BOMBERS, bomber, 'uid')
  }
});

socket.on('player_move', (payload) => {
  helpers.upsertItem(BOMBERS, payload, 'uid');
});

socket.on('new_bomb', (payload) => {
  helpers.upsertItem(BOMBS, payload, 'id');
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
  }
})

socket.on('chest_destroyed', (payload) => {
  // Chest destroyed event handler
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
}


socket.on('connect', async () => {
  writeLog('Connected to server');
  // socket.emit('join', {});
  blindCodeMode()
  fs.writeFileSync(FILE_NAME, '');
  writeLog('Sent join event');

  while(!GAME_START) {
    await sleep(10)
  }

  GAME_START_AT = Date.now();

  while(true) {
    const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
    writeLog('-----------------------------')
    writeLog('MY BOMBER', myBomber.x, myBomber.y)
    helpers.markOwnBombOnMap(myBomber, BOMBS, MAP, GAME_START_AT)

    // Xác định hành vi muốn thực hiện
    let action = null; // { type: 'attack' | 'break_chest' | 'idle', path: [...], target: {...} }

    // ƯU TIÊN 1: Tấn công kẻ địch
    // if (checkBomAvailables(myBomber)) {
    if (false) {
      // Tìm bot gần nhất có thể tấn công
      const enemies = BOMBERS.filter(b => b.name !== myBomber.name);
      let bestEnemyAction = null;

      // Ưu tiên 1: Kiểm tra dead corner và tunnel trap
      for (const enemy of enemies) {
        // Kiểm tra dead corner trước
        const deadCornerBoomPlace = helpers.isDeadCorner(enemy, MAP);
        if (deadCornerBoomPlace && !KILL_BOOM.has(`${deadCornerBoomPlace.x}-${deadCornerBoomPlace.y}`)) {
          const gridPath = helpers.findPathToTarget(myBomber, helpers.toMapCoord(deadCornerBoomPlace), MAP, true);
          if (gridPath && gridPath.length > 0) {
            writeLog('Found dead corner target:', enemy.name, 'at', deadCornerBoomPlace, 'path length:', gridPath.length);
            bestEnemyAction = {
              type: 'attack',
              path: gridPath,
              target: deadCornerBoomPlace,
              enemy: enemy,
              attackType: 'dead_corner'
            };
            break; // Ưu tiên dead corner cao nhất
          } else {
            writeLog('Dead corner found but no path to target:', deadCornerBoomPlace);
          }
        }

        // Kiểm tra tunnel trap
        const tunnelTrapPositions = findTunnelTrapPositions(enemy, myBomber);
        if (tunnelTrapPositions && tunnelTrapPositions.length > 0) {
          writeLog('Found tunnel trap for enemy:', enemy.name, 'positions:', tunnelTrapPositions.length);
          // Tìm vị trí gần nhất để đặt bom
          let closestTrapAction = null;
          let minDistance = Infinity;

          for (const trapPos of tunnelTrapPositions) {
            if (KILL_BOOM.has(`${trapPos.x}-${trapPos.y}`)) {
              writeLog('Tunnel trap position already in KILL_BOOM:', trapPos);
              continue;
            }
            const gridPath = helpers.findPathToTarget(myBomber, helpers.toMapCoord(trapPos), MAP, true);
            if (gridPath && gridPath.length > 0) {
              if (gridPath.length < minDistance) {
                minDistance = gridPath.length;
                closestTrapAction = {
                  type: 'attack',
                  path: gridPath,
                  target: trapPos,
                  enemy: enemy,
                  attackType: 'tunnel_trap'
                };
              }
            }
          }

          if (closestTrapAction) {
            writeLog('Selected tunnel trap action, path length:', minDistance);
            bestEnemyAction = closestTrapAction;
            break;
          } else {
            writeLog('Tunnel trap found but no valid path');
          }
        }
      }

      // Ưu tiên 2: Tấn công bình thường nếu không có dead corner hoặc tunnel trap
      if (!bestEnemyAction) {
        writeLog('No dead corner or tunnel trap, trying normal attack');
        for (const enemy of enemies) {
          const allPos = helpers.findBombPositionsForEnemyArea(myBomber, enemy, MAP);
          if (allPos && allPos.length > 0) {
            const bestPos = allPos[0];
            const pathToEnemy = helpers.findPathToTarget(myBomber, helpers.toMapCoord(bestPos), MAP, false);
            if (pathToEnemy && pathToEnemy.length > 0) {
              writeLog('Found normal attack target:', enemy.name, 'path length:', pathToEnemy.length);
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
        if (!bestEnemyAction) {
          writeLog('No normal attack found');
        }
      }

      if (bestEnemyAction) {
        action = bestEnemyAction;
        writeLog('Selected attack action:', bestEnemyAction.attackType);
      } else {
        writeLog('No attack action available');
      }
    } else {
      // writeLog('Bomb not available, skipping attack');
    }

    // ƯU TIÊN 2: Phá rương hoặc nhặt item (nếu không có hành động tấn công)
    if (!action) {
      const walkableNeighbors = helpers.getWalkableNeighbors(MAP, myBomber);
      let bestChestAction = null;
      let maxChests = 0;

      // Tìm vị trí phá nhiều chest nhất
      const allPlaces = helpers.findAllPossiblePlaceBoom(myBomber, MAP, walkableNeighbors);
      if (allPlaces && allPlaces.length > 0) {
        for (const place of allPlaces) {
          const mapCoordPlace = helpers.toMapCoord(place);
          console.log('xx', mapCoordPlace);

          if (BOMBS.some(b => b.x === mapCoordPlace.x && b.y === mapCoordPlace.y)) {
            writeLog('come here')
            continue;
          }
          if (place.score > maxChests) {
            const gridPath = helpers.findPathToTarget(myBomber, mapCoordPlace, MAP, true);
            console.log('gridPath', gridPath);

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
        const itemPathLength = bestItemAction.path.length;
        const wouldBlock = wouldBombBlockItem(bestChestAction.target, bestItemAction.target, myBomber);

        writeLog('Both chest and item available. Bomb path:', bombPathLength, 'Item path:', itemPathLength, 'Would block:', wouldBlock);

        if (bombPathLength <= 2 && !wouldBlock) {
          writeLog('Choosing chest action (bomb is very close and won\'t block item)');
          action = bestChestAction;
        } else if (itemPathLength < bombPathLength) {
          writeLog('Choosing item action (item is closer)');
          action = bestItemAction;
        } else {
          writeLog('Choosing chest action (bomb is closer and wont block)');
          action = bestChestAction;
        }
      } else if (bestChestAction) {
        writeLog('Only chest action available, chests:', bestChestAction.chestCount);
        action = bestChestAction;
      } else if (bestItemAction) {
        writeLog('Only item action available');
        action = bestItemAction;
      } else {
        writeLog('No chest or item action available');
      }
    }

    // ƯU TIÊN 3: Kiểm tra an toàn và thực hiện hành động
    if (action && action.path && action.path.length > 1) {
      // Tính toán đường đi với middle point nếu cần
      let finalPath = action.path;
      let isGridPath = false;

      // Xác định loại path (grid hay map coord)
      if (finalPath[0] && finalPath[0].x < helpers.WALL_SIZE * 2) {
        isGridPath = true;
      }

      if (action.path.length >= 2 && isGridPath) {
        const middlePoint = helpers.getMidPoint(action.path, myBomber.speed);
        const pathToMidPoint = helpers.findPathToTarget(myBomber, middlePoint, MAP, false);
        console.log('pathToMidPoint', pathToMidPoint);

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

      writeLog('Action:', action.type, 'Danger level:', dangerLevel.dangerLevel, 'Can move:', dangerLevel.canMove, 'Time until explosion:', dangerLevel.timeUntilExplosion);

      if (dangerLevel.canMove) {
        const step = nextStep(finalPath);
        if (step) {
          writeLog('Moving:', step, 'Action type:', action.type);
          move(step);
        } else {
          writeLog('No step calculated from path');
        }
      } else {
        writeLog('Cannot move safely, staying in place. Danger level:', dangerLevel.dangerLevel);
      }
      // Nếu không thể di chuyển an toàn, bot sẽ dừng lại (không làm gì)
    } else if (action && action.path && action.path.length === 1) {
      // Đã đến vị trí đích
      writeLog('Reached target position, action type:', action.type);
      if (action.type === 'attack' && action.target) {
        writeLog('Placing bomb for attack, target:', action.target, 'attack type:', action.attackType);
        placeBoom(myBomber);
        if (action.target.x !== undefined && action.target.y !== undefined) {
          KILL_BOOM.add(`${action.target.x}-${action.target.y}`);
          writeLog('Added to KILL_BOOM:', `${action.target.x}-${action.target.y}`);
        }
      } else if (action.type === 'break_chest') {
        writeLog('Placing bomb to break chest, chest count:', action.chestCount);
        placeBoom(myBomber);
      } else if (action.type === 'collect_item') {
        writeLog('At item position, will collect automatically');
      }
      // collect_item không cần làm gì thêm, item sẽ tự động được nhặt khi bot đi qua
    } else {
      // Không có hành động nào, kiểm tra nếu đang trong nguy hiểm
      writeLog('No action available');
      if (helpers.isInDanger(myBomber, DANGER_ZONE)) {
        writeLog('In danger, looking for safety zone');
        let safetyZone = null;
        const allSafetyZone = helpers.findAllSafeZones(helpers.toGridCoord(myBomber), MAP, DANGER_ZONE);
        if (allSafetyZone) {
          safetyZone = allSafetyZone[0];
          writeLog('Found safety zone from findAllSafeZones:', safetyZone);
        } else {
          safetyZone = helpers.findNearestSafetyZone(myBomber, MAP, DANGER_ZONE);
          writeLog('Found safety zone from findNearestSafetyZone:', safetyZone);
        }

        if (safetyZone) {
          const path = helpers.findPathToTarget(myBomber, helpers.toMapCoord(safetyZone), MAP, false);
          if (path && path.length >= 1) {
            if (path.length == 1) {
              path.push(helpers.toMapCoord(safetyZone));
            }
            const step = nextStep(path);
            if (step) {
              writeLog('Moving to safety zone:', step);
              move(step);
            } else {
              writeLog('No step to safety zone');
            }
          } else {
            writeLog('No path to safety zone');
          }
        } else {
          writeLog('No safety zone found');
        }
      } else {
        writeLog('Not in danger, no action');
      }
    }

    await sleep(100);
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
    socket.emit('place_bomb', {})
    writeLog('PLACED BOOM at ', myBomber.x, myBomber.y)
    updateMapWhenPlaceBoom(myBomber)

    //blindcodemode
    const bomID = `random-${Date.now()}`
    const blindBomb = {
      id: bomID,
      x: myBomber.x,
      y: myBomber.y,
      uid: myBomber.uid,
    }
    helpers.upsertItem(BOMBS, blindBomb, 'id')
    addDangerZonesForBomb(blindBomb)
    setTimeout(() => {
      writeLog('BOMB EXPLODE', );
      removeDangerZonesForBomb(bomID);
      MAP[Math.floor(myBomber.y / helpers.WALL_SIZE)][Math.floor(myBomber.x / helpers.WALL_SIZE)] = null;
      CHESTS.filter(x => x.isDestroyed).map(c => {
        MAP[c.y / helpers.WALL_SIZE][c.x / helpers.WALL_SIZE] = null
        writeLog('x y', c.x / helpers.WALL_SIZE, c.y / helpers.WALL_SIZE);
      })
    }, 5000)
  } else {
    writeLog('Bomb not available, skipping place bomb');
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

/**
 * Tìm vị trí đặt bom để giết bot đối thủ khi bot bị kẹt trong đường hầm (tunnel trap)
 * Trường hợp: bot chỉ có thể đi trái/phải (hoặc lên/xuống) và bị kẹt giữa 2 tường
 * @param {Object} enemy - Bot đối thủ
 * @param {Object} myBomber - Bot của chúng ta
 * @returns {Array} - Mảng các vị trí đặt bom (grid coord) hoặc null nếu không phải tunnel trap
 */
function findTunnelTrapPositions(enemy, myBomber) {
  if (!enemy || !myBomber) return null;

  const enemyGrid = helpers.toGridCoord(enemy);
  const { x, y } = enemyGrid;

  // Kiểm tra xem có phải tunnel trap không
  // Tunnel trap: chỉ có thể đi theo 1 hướng (trái/phải hoặc lên/xuống)
  const canGoUp = helpers.isWalkable(MAP, x, y - 1, true);
  const canGoDown = helpers.isWalkable(MAP, x, y + 1, true);
  const canGoLeft = helpers.isWalkable(MAP, x - 1, y, true);
  const canGoRight = helpers.isWalkable(MAP, x + 1, y, true);

  const horizontalMovable = canGoLeft || canGoRight;
  const verticalMovable = canGoUp || canGoDown;

  // Phải có thể đi theo 1 hướng nhưng không thể đi theo hướng kia
  if (!horizontalMovable || !verticalMovable) {
    // Không phải tunnel trap (có thể là dead corner hoặc không bị kẹt)
    return null;
  }

  // Kiểm tra xem có bị kẹt giữa 2 tường không
  const isHorizontalTunnel = !canGoUp && !canGoDown && canGoLeft && canGoRight;
  const isVerticalTunnel = !canGoLeft && !canGoRight && canGoUp && canGoDown;

  if (!isHorizontalTunnel && !isVerticalTunnel) {
    return null;
  }

  const explosionRange = myBomber.explosionRange;
  const trapPositions = [];

  if (isHorizontalTunnel) {
    // Bot bị kẹt trong đường hầm ngang, chỉ có thể đi trái/phải
    // Tìm vị trí đặt bom trong phạm vi explosion range ở cả 2 phía
    // Đi về phía trái
    for (let i = 1; i <= explosionRange; i++) {
      const checkX = x - i;
      if (checkX < 0) break;
      if (!helpers.isWalkable(MAP, checkX, y, true)) break; // Gặp tường

      // Kiểm tra xem có thể đặt bom ở đây không (phải walkable và không có bom)
      const mapCoord = helpers.toMapCoord({ x: checkX, y });
      if (!BOMBS.some(b => b.x === mapCoord.x && b.y === mapCoord.y)) {
        trapPositions.push({ x: checkX, y, distance: i });
      }
    }

    // Đi về phía phải
    for (let i = 1; i <= explosionRange; i++) {
      const checkX = x + i;
      if (checkX >= MAP[0].length) break;
      if (!helpers.isWalkable(MAP, checkX, y, true)) break; // Gặp tường

      const mapCoord = helpers.toMapCoord({ x: checkX, y });
      if (!BOMBS.some(b => b.x === mapCoord.x && b.y === mapCoord.y)) {
        trapPositions.push({ x: checkX, y, distance: i });
      }
    }
  } else if (isVerticalTunnel) {
    // Bot bị kẹt trong đường hầm dọc, chỉ có thể đi lên/xuống
    // Đi lên
    for (let i = 1; i <= explosionRange; i++) {
      const checkY = y - i;
      if (checkY < 0) break;
      if (!helpers.isWalkable(MAP, x, checkY, true)) break; // Gặp tường

      const mapCoord = helpers.toMapCoord({ x, y: checkY });
      if (!BOMBS.some(b => b.x === mapCoord.x && b.y === mapCoord.y)) {
        trapPositions.push({ x, y: checkY, distance: i });
      }
    }

    // Đi xuống
    for (let i = 1; i <= explosionRange; i++) {
      const checkY = y + i;
      if (checkY >= MAP.length) break;
      if (!helpers.isWalkable(MAP, x, checkY, true)) break; // Gặp tường

      const mapCoord = helpers.toMapCoord({ x, y: checkY });
      if (!BOMBS.some(b => b.x === mapCoord.x && b.y === mapCoord.y)) {
        trapPositions.push({ x, y: checkY, distance: i });
      }
    }
  }

  // Sắp xếp theo khoảng cách (gần nhất trước) để ưu tiên vị trí gần bot đối thủ
  trapPositions.sort((a, b) => a.distance - b.distance);

  // Chỉ trả về nếu tìm được ít nhất 1 vị trí (lý tưởng là 2 vị trí ở 2 đầu)
  return trapPositions.length > 0 ? trapPositions : null;
}

function findReachableItem() {
  const myBomber = BOMBERS.find(b => b.name === process.env.BOMBER_NAME);
  if (ITEMS.length === 0) return null;

  // Filter items within Manhattan distance <= 6 grid cells
  const nearbyItems = ITEMS.filter(item => {
    if (!item) return false;

    const distance = helpers.manhattanDistance(item, myBomber);
    return distance <= (6 * helpers.WALL_SIZE);
  });

  // Find all valid paths to nearby items
  const validPaths = [];
  for (const item of nearbyItems) {
    const path = helpers.findPathToTarget(myBomber, item, MAP, false);
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

function checkBomAvailables(myBomber) {
  // Count active bombs owned by this bomber (tracked by uid)
  const ownedActiveBombs = BOMBS.filter(b => b && b.uid === myBomber.uid).length;
  const over20Sec = Date.now() - GAME_START_AT > 20000;
  const bomAvailable = ownedActiveBombs < myBomber.bombCount;
  return myBomber.speed == 1 ? (over20Sec ? bomAvailable : ownedActiveBombs == 0) : bomAvailable;
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
  let isInDanger = false;

  // Kiểm tra tất cả các danger zones
  for (const zone of dangerZones) {
    const tileLeft = zone.x * helpers.WALL_SIZE;
    const tileRight = (zone.x + 1) * helpers.WALL_SIZE;
    const tileTop = zone.y * helpers.WALL_SIZE;
    const tileBottom = (zone.y + 1) * helpers.WALL_SIZE;

    const overlapX = testBomber.x < tileRight && bomberRight > tileLeft;
    const overlapY = testBomber.y < tileBottom && bomberBottom > tileTop;

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

  // Tính toán thời gian cần thiết để di chuyển ra khỏi vùng nguy hiểm
  // Dựa vào tốc độ của bot (speed 1 = 40px/step, speed 2 = 80px/step, speed 3 = 120px/step)
  const moveSpeed = myBomber.speed; // pixels per step
  const timePerStep = 17; // milliseconds (ước tính, có thể cần điều chỉnh)
  const stepsToEscape = 2; // Ước tính số bước cần để thoát
  const estimatedEscapeTime = stepsToEscape * timePerStep;

  // Nếu thời gian đến khi nổ còn đủ để thoát, cho phép di chuyển
  // Với bot tốc độ cao, có thể chấp nhận rủi ro cao hơn
  const safetyMargin = myBomber.speed >= 2 ? 500 : 1000; // Bot nhanh hơn có thể chấp nhận rủi ro cao hơn

  const canMove = minTimeUntilExplosion > (estimatedEscapeTime + safetyMargin);

  // Tính danger level (0-10, 10 là nguy hiểm nhất)
  let dangerLevel = 0;
  if (minTimeUntilExplosion < 1000) {
    dangerLevel = 10; // Rất nguy hiểm, sẽ nổ trong 1 giây
  } else if (minTimeUntilExplosion < 2000) {
    dangerLevel = 7; // Nguy hiểm
  } else if (minTimeUntilExplosion < 3000) {
    dangerLevel = 4; // Hơi nguy hiểm
  } else {
    dangerLevel = 1; // Ít nguy hiểm
  }

  return {
    canMove,
    dangerLevel,
    timeUntilExplosion: minTimeUntilExplosion
  };
}

function writeLog(...args) {
  console.log(...args)

  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null) : String(a)
  ).join(' ');

  const log = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(FILE_NAME, log);
}
