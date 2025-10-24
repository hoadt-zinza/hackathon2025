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
  // socket.emit('join', {});
})

console.log('xx', helpers.findBombPositionsForEnemyArea(
  { x: 565, y: 565, explosionRange: 2 },
  { x: 125, y: 79 },
  sampleMap
))
