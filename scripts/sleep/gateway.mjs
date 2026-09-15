/** Local WebSocket gateway. Device producers send the same v1 JSON packets
 * to /input over WebSocket; browsers subscribe at /stream. No cloud relay. */
import http from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {SleepGenerator,SleepPosture,simulationPackets,validateSleepPacket,sleepPose} from '../../lib/sleep/model.js';
const host=process.env.SOMA_SLEEP_HOST||'127.0.0.1',port=Number(process.env.SOMA_SLEEP_PORT||8765),demo=process.argv.includes('--demo');
const server=http.createServer((req,res)=>{res.writeHead(req.url==='/health'?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/health'?{status:'ok',mode:demo?'synthetic':'device',protocol:'soma-sleep-v1'}:{error:'Not found'}));});
const wss=new WebSocketServer({noServer:true,maxPayload:1000000,perMessageDeflate:false}),listeners=new Set();
server.on('upgrade',(req,socket,head)=>{if(!['/stream','/input'].includes(req.url)||demo&&req.url==='/input'){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>{ws.on('error',()=>{});if(req.url==='/stream'){listeners.add(ws);ws.on('close',()=>listeners.delete(ws));}else ws.on('message',data=>{try{broadcast(validateSleepPacket(JSON.parse(data.toString())));}catch{ws.close(1008,'Invalid soma-sleep-v1 packet');}});});});
function broadcast(packet){const text=JSON.stringify(packet);for(const ws of listeners){if(ws.bufferedAmount>1000000){ws.close(1013,'Consumer too slow');listeners.delete(ws);}else if(ws.readyState===WebSocket.OPEN)ws.send(text);}}
const generator=new SleepGenerator(),posture=new SleepPosture();let timer;
if(demo)timer=setInterval(()=>{const blocks=new Map();for(let i=0;i<25;i++){const frame=generator.step(.004,undefined,posture.step(.004,generator.time,'supine'));for(const p of simulationPackets(frame)){if(!blocks.has(p.kind))blocks.set(p.kind,{...p,samples:[]});blocks.get(p.kind).samples.push(...p.samples);}}for(const p of blocks.values())broadcast(p);},100);
server.listen(port,host,()=>console.log(JSON.stringify({url:`ws://${host}:${server.address().port}/stream`,input:`ws://${host}:${server.address().port}/input`,mode:demo?'synthetic':'device'})));
function shutdown(){clearInterval(timer);for(const c of wss.clients)c.terminate();wss.close();server.close();}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
