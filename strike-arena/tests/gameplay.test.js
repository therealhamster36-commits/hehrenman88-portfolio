'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {startMatch,stepMatch,kick,tackle,ticker}=require('../server');
ticker.unref();
const fakeWS={readyState:1,send(){}};
function fixture(){const room={code:'TEST2',hostId:'human',status:'lobby',opts:{duration:120,difficulty:'normal'},users:new Map([['human',{id:'human',name:'Captain',team:0,ws:fakeWS}]]),match:null};startMatch(room);room.match.freeze=0;return room;}
test('client HTML contains every queried element and both touchscreen controls',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../public/index.html'),'utf8');
  const client=fs.readFileSync(path.resolve(__dirname,'../public/client.js'),'utf8');
  const ids=new Set([...client.matchAll(/\$\(['"]([^'"$]+)['"]\)/g)].map(m=>m[1]));
  for(const id of ids)assert.match(html,new RegExp(`id="${id}"`),`Missing id #${id}`);
  for(const id of ['touchPass','touchShoot','touchTackle','joystick','matchStatus','possessionText'])assert.match(html,new RegExp(`id="${id}"`));
});
test('human can control, shoot and score a legitimate goal',()=>{
  const r=fixture(),m=r.match,p=m.players.find(p=>p.id==='human');
  p.x=1010;p.y=360;p.input.ax=1;p.input.ay=0;
  m.ball.ownerId=p.id;m.ball.x=p.x+24;m.ball.y=p.y;
  assert.equal(kick(m,p,'shoot',{x:1,y:0}),true);
  assert.equal(m.ball.ownerId,null);
  for(let i=0;i<30&&m.score[0]===0;i++)stepMatch(r,1/30);
  assert.deepEqual(m.score,[1,0]);
  assert.ok(m.freeze>0,'kickoff freeze restored after goal');
  assert.equal(m.ball.x,600);
});
test('shoot action cannot fire without possession or close contact',()=>{
  const r=fixture(),m=r.match,p=m.players.find(p=>p.id==='human');
  assert.equal(kick(m,p,'shoot'),false);
  assert.deepEqual(m.score,[0,0]);
});
test('pass relinquishes ball and preserves finite velocity',()=>{
  const r=fixture(),m=r.match,p=m.players.find(p=>p.id==='human');
  m.ball.ownerId=p.id;m.ball.x=p.x+24;m.ball.y=p.y;
  assert.equal(kick(m,p,'pass',{x:1,y:0}),true);
  assert.equal(m.ball.ownerId,null);
  assert.ok(Number.isFinite(m.ball.vx)&&Number.isFinite(m.ball.vy));
  assert.ok(Math.hypot(m.ball.vx,m.ball.vy)>300);
});
test('tackle is team-aware and enforced by cooldown',()=>{
  const r=fixture(),m=r.match,h=m.players.find(p=>p.id==='human'),enemy=m.players.find(p=>p.team===1);
  h.x=600;h.y=360;enemy.x=621;enemy.y=360;
  m.ball.ownerId=enemy.id;m.ball.x=645;m.ball.y=360;
  assert.equal(tackle(m,h),true);assert.equal(m.ball.ownerId,h.id);
  assert.equal(tackle(m,h),false);
});
test('match ends at timer zero and no post-finish goals appear',()=>{
  const r=fixture(),m=r.match;m.timeLeft=.05;
  stepMatch(r,1/30);stepMatch(r,1/30);
  assert.equal(r.status,'ended');assert.equal(m.ended,true);
  assert.equal(kick(m,m.players[0],'shoot'),false);
});
test('AI match does not freeze with a permanent goalkeeper possession',()=>{
  const r=fixture(),m=r.match;let kicks=0,owners=new Set();
  for(let i=0;i<1200;i++){stepMatch(r,1/30);if(m.notices.some(n=>n.type==='kick'))kicks++;if(m.ball.ownerId)owners.add(m.ball.ownerId);}
  assert.ok(kicks>=3,`Only ${kicks} kicks in 40 seconds`);
  assert.ok(owners.size>=2,`Only ${owners.size} possessors`);
});
