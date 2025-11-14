import dotenv from 'dotenv';
import { io } from 'socket.io-client';
import * as helpers from './helpers.js';
import sampleMap from './sample/map.js';

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

for(let x = 0; x < 1000; x++) {
  const timeStartLoop = Date.now()

  for (let y = 0; y < 10000; y++) {
    helpers.createDangerZonesForBomb({x : 40, y: 40}, 5, sampleMap)
  }

  console.log(`--------${timeStartLoop}-------------`, )

  await sleep(20 - (Date.now() - timeStartLoop));
}
