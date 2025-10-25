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

// const myBomber = {"x":42,"y":45,"speed":1,"type":1,"uid":"9ScMpyJwXb5322-kAAJ6","orient":"UP","isAlive":true,"size":35,"name":"bobao","movable":false,"protectCooldown":0,"score":10,"color":1,"explosionRange":3,"bombCount":1,"speedCount":0}
// const frozen = [{"x":40,"y":565,"speed":1,"type":1,"uid":"VD3JTrr0JPtwCwPQAAJ0","orient":"DOWN","isAlive":true,"size":35,"name":"aka000","movable":true,"protectCooldown":0,"score":0,"color":0,"explosionRange":2,"bombCount":1,"speedCount":0}]
// const findchest = helpers.findChestBreakScoresToFrozen(myBomber, frozen, sampleMap)
