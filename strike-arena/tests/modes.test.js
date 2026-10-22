'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {startMatch,stepMatch,kick,validOpts,GAME_MODES,ticker}=require('../server');
ticker.unref();
const ws={readyState:1,send(){}};
function room(mode,people=1){
 const users=new Map();for(let t=0;t<2;t++)for(let j=0;j<(t===0?people:0);j++){const id=`player-${t}-${j}`;users.set(id,{id,team:t,name:id,ws});}
 const r={code:'TEST3',hostId:'player-0-0',status:'lobby',opts:validOpts({mode,duration:120,difficulty:'normal'}),users,match:null};startMatch(r);return r;
}
test('all new game modes are recognized without invalid mode injection',()=>{
 assert.deepEqual(Object.keys(GAME_MODES),['1v1','2v2','3v3','4v4','penalties']);
 assert.equal(validOpts({mode:'wrong'}).mode,'4v4');
 assert.equal(validOpts({mode:'1v1'}).mode,'1v1');
});
for(const [mode,total] of [['1v1',4],['2v2',6],['3v3',8],['4v4',8]])test(mode+' uses matching active players and dedicated keepers',()=>{
 const r=room(mode);assert.equal(r.match.players.length,total);
 assert.equal(r.match.players.filter(p=>!p.isBot).length,1);
 assert.ok(r.match.players.some(p=>p.team===1&&p.slot===0));
 r.match.freeze=0;for(let i=0;i<90;i++)stepMatch(r,1/30);
 assert.ok(Number.isFinite(r.match.ball.x));assert.equal(r.status,'playing');
});
test('penalty shootout progresses turn by turn and has no free-ball physics',()=>{
 const r=room('penalties'),m=r.match;
 assert.equal(m.penalty.phase,'aim');assert.equal(m.penalty.turn,0);
 assert.equal(m.players.length,4);
 const striker=m.players.find(p=>p.id==='player-0-0');
 assert.equal(kick(m,striker,'pass',{x:1,y:0}),false);
 assert.equal(kick(m,striker,'shoot',{x:1,y:0}),true);
 assert.equal(kick(m,striker,'shoot',{x:1,y:0}),false);
 for(let i=0;i<20;i++)stepMatch(r,1/30);
 assert.equal(m.penalty.phase,'result');assert.equal(m.penalty.shots[0],1);
 for(let i=0;i<55;i++)stepMatch(r,1/30);
 assert.equal(m.penalty.turn,1);assert.equal(m.penalty.phase,'aim');
 for(let i=0;i<40;i++)stepMatch(r,1/30);
 assert.equal(m.penalty.phase,'flight');
 for(let i=0;i<75;i++)stepMatch(r,1/30);
 assert.ok(m.penalty.shots[1]>=1);
});
test('penalty shooter can miss by aiming outside the goal',()=>{
 const r=room('penalties'),m=r.match,striker=m.players.find(p=>p.id==='player-0-0');
 assert.equal(kick(m,striker,'shoot',{x:1,y:1}),true);
 for(let i=0;i<20;i++)stepMatch(r,1/30);
 assert.equal(m.penalty.last,'DANEBEN');assert.deepEqual(m.score,[0,0]);
});
test('3D module includes browser renderer, goal replay and responsive pitch',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const c=fs.readFileSync(path.resolve(__dirname,'../public/client.js'),'utf8');
 const t=fs.readFileSync(path.resolve(__dirname,'../public/arena3d.js'),'utf8');
 const h=fs.readFileSync(path.resolve(__dirname,'../public/index.html'),'utf8');
 assert.match(t,/WebGLRenderer/);assert.match(t,/ACESFilmicToneMapping/);assert.match(t,/castShadow/);
 assert.match(c,/startReplay/);assert.match(c,/replayFrame/);assert.match(c,/changeView/);
 for(const id of ['quickModeSelect','viewSelect','modeSelect','gameViewSelect','penaltyKick','skipReplay'])assert.match(h,new RegExp(`id="${id}"`));
});
