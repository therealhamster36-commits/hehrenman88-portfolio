const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const PORT = 41981;
const url = `ws://127.0.0.1:${PORT}/ws`;
let child;
async function waitFor(fn, timeout=3500) {
  const start=Date.now();
  while(Date.now()-start<timeout){ const v=await fn();if(v) return v;await new Promise(r=>setTimeout(r,30)); }
  throw new Error('Timeout waiting for condition');
}
function makeClient(){
  const ws=new WebSocket(url);
  const events=[];
  ws.addEventListener('message', e=> {events.push(JSON.parse(e.data));});
  const open=new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  return {ws,events,open,send:p=>ws.send(JSON.stringify(p))};
}
test.before(async()=>{
  child=spawn(process.execPath,['server.js'],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,PORT:String(PORT)},stdio:'pipe'});
  await waitFor(async()=>{
    try {const res=await fetch(`http://127.0.0.1:${PORT}/health`);return res.ok;}catch{return false;}
  });
});
test.after(()=>child?.kill());
test('room creation, invitation, 2 humans, bots, synced match, team switch',async()=>{
  const a=makeClient(),b=makeClient(); await Promise.all([a.open,b.open]);
  a.send({type:'create',name:'Captain',opts:{duration:120,difficulty:'hard'}});
  const initial=await waitFor(()=>a.events.find(e=>e.type==='room'));
  const code=initial.room.code;
  assert.match(code,/^[A-Z2-9]{5}$/);
  assert.equal(initial.room.users.length,1);
  b.send({type:'join',code,name:'Striker'});
  await waitFor(()=>a.events.find(e=>e.type==='room'&&e.room.users.length===2));
  const latest= a.events.filter(e=>e.type==='room').at(-1);
  assert.equal(latest.room.users[1].team,1);
  b.send({type:'team',team:0});
  await waitFor(()=>a.events.find(e=>e.type==='room'&&e.room.users.length===2&&e.room.users[1].team===0));
  a.send({type:'start'});
  await waitFor(()=>a.events.find(e=>e.type==='started'));
  const snapA=await waitFor(()=>a.events.find(e=>e.type==='snapshot'));
  const snapB=await waitFor(()=>b.events.find(e=>e.type==='snapshot'));
  assert.equal(snapA.state.players.length,8);
  assert.equal(snapA.state.players.filter(p=>!p.bot).length,2);
  assert.equal(snapB.state.players.length,8);
  assert.ok(snapA.state.timeLeft>0);
  await new Promise(r=>setTimeout(r,1650));
  a.send({type:'input',dx:1,dy:0,sprint:true,ax:1,ay:0});
  await new Promise(r=>setTimeout(r,220));
  const moved=a.events.filter(e=>e.type==='snapshot').at(-1).state;
  const p0=snapA.state.players.find(p=>p.name==='Captain');
  const p1=moved.players.find(p=>p.name==='Captain');
  assert.ok(p1.x>p0.x,`movement did not happen (${p0.x} -> ${p1.x})`);
  a.send({type:'action',kind:'shoot'});
  b.ws.close();a.ws.close();
});
test('invalid room is rejected',async()=>{
  const c=makeClient();await c.open;
  c.send({type:'join',code:'XXXXX',name:'Player'});
  const err=await waitFor(()=>c.events.find(e=>e.type==='error'));
  assert.match(err.message,/nicht gefunden/);
  c.ws.close();
});
test('late joining a live match replaces a bot without restarting',async()=>{
  const host=makeClient();await host.open;
  host.send({type:'create',name:'Host'});
  const ready=await waitFor(()=>host.events.find(e=>e.type==='room'));
  const code=ready.room.code;
  host.send({type:'start'});
  await waitFor(()=>host.events.find(e=>e.type==='started'));
  const friend=makeClient();await friend.open;
  friend.send({type:'join',code,name:'Friend',team:1});
  const joined=await waitFor(()=>friend.events.find(e=>e.type==='room'&&e.room.status==='playing'));
  assert.equal(joined.room.code,code);
  const next=await waitFor(()=>friend.events.find(e=>e.type==='snapshot'&&e.state.players.some(p=>p.name==='Friend')));
  assert.equal(next.state.players.filter(p=>!p.bot).length,2);
  host.ws.close();friend.ws.close();
});
