'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { installWebSocketServer } = require('./miniws');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const W = 1200, H = 720;
const FIELD = { left: 72, right: 1128, top: 76, bottom: 644, goalTop: 290, goalBottom: 430 };
const TEAM_SIZE = 4, MAX_HUMANS = 8, PLAYER_RADIUS = 16, BALL_RADIUS = 10;
const DT = 1 / 30;
const rooms = new Map(), sockets = new Map();
const roomChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
function normalized(x, y) { const l = Math.hypot(x, y); return l > 0.0001 ? {x:x/l,y:y/l} : {x:0,y:0}; }
function sanitizeName(v) { return String(v || '').replace(/[<>\x00-\x1f]/g, '').trim().slice(0,16) || 'Spieler'; }
function validOpts(opt) { return { duration:[120,180,300,480].includes(+opt?.duration) ? +opt.duration : 180, difficulty:['easy','normal','hard'].includes(opt?.difficulty)?opt.difficulty:'normal' }; }
const safeSend = (ws, data) => { if (ws.readyState === 1) ws.send(JSON.stringify(data)); };
function newRoomCode() { let code; do { code = [...crypto.randomBytes(5)].map(n => roomChars[n % roomChars.length]).join(''); } while(rooms.has(code)); return code; }
function roomData(room) { return {code:room.code,hostId:room.hostId,status:room.status,opts:room.opts,users:[...room.users.values()].map(u=>({id:u.id,name:u.name,team:u.team})),score:room.match?.score||[0,0],timeLeft:room.match?.timeLeft??room.opts.duration}; }
function broadcast(room, event) { for(const u of room.users.values())safeSend(u.ws,event); }
function updateRoom(room) { const data = roomData(room); for(const u of room.users.values())safeSend(u.ws,{type:'room',room:data,you:u.id}); }
function spawnPoint(team, slot) { const spots=[{x:140,y:360},{x:360,y:205},{x:335,y:515},{x:465,y:360}];const p=spots[slot];return {x:team?W-p.x:p.x,y:p.y}; }
function makePlayer(id,name,team,slot,isBot=false) {const o=spawnPoint(team,slot);return {id,name,team,slot,isBot,x:o.x,y:o.y,vx:0,vy:0,facing:{x:team?-1:1,y:0},input:{dx:0,dy:0,ax:team?-1:1,ay:0,sprint:false},cooldown:0,tackleCooldown:0,stamina:100};}
function initialBall(){ return {x:W/2,y:H/2,vx:0,vy:0,ownerId:null,loose:0,ignoreId:null,last:-1}; }
function resetFormation(m){ for(const p of m.players){ const o=spawnPoint(p.team,p.slot);p.x=o.x;p.y=o.y;p.vx=p.vy=0;p.cooldown=0;p.tackleCooldown=0;p.facing={x:p.team?-1:1,y:0};p.input.dx=0;p.input.dy=0;} m.ball=initialBall();m.freeze=2.3; }
function startMatch(room){
  const players=[];
  for(let team=0;team<2;team++){
    const users=[...room.users.values()].filter(u=>u.team===team);
    const pref=[3,1,2,0],taken=new Set();
    users.forEach((u,i)=>{const slot=pref[i];taken.add(slot);players.push(makePlayer(u.id,u.name,team,slot));});
    for(let slot=0;slot<TEAM_SIZE;slot++)if(!taken.has(slot))players.push(makePlayer(`BOT-${team}-${slot}`,['Torwart','Flügel','Abwehr','Angriff'][slot],team,slot,true));
  }
  room.match={players,ball:initialBall(),score:[0,0],timeLeft:room.opts.duration,freeze:1.6,ended:false,notices:[],tick:0};
  room.status='playing';updateRoom(room);broadcast(room,{type:'started'});
}
function getOwner(m){ return m.players.find(p=>p.id===m.ball.ownerId) || null; }
function ballDirection(p){let a=normalized(p.input.ax,p.input.ay);if(!a.x&&!a.y)a=p.facing;return a;}
function canTakeBall(m,p){return m.freeze<=0&&!m.ended&&(!m.ball.ownerId||m.ball.ownerId===p.id)&&m.ball.loose<=0&&distance(p,m.ball)<45;}
function selectPass(m,p,aim){
  const teammates=m.players.filter(t=>t.team===p.team&&t.id!==p.id);
  let target=null,score=-Infinity;
  for(const t of teammates){ const delta=normalized(t.x-p.x,t.y-p.y);const d=distance(t,p);
    if(d<50)continue;
    const alignment=delta.x*aim.x+delta.y*aim.y;
    const fieldProgress=(t.x-p.x)*(p.team===0?1:-1);
    const enemies=m.players.filter(e=>e.team!==p.team);
    const targetThreat=enemies.some(e=>distance(e,t)<100)?-2.5:0;
    const alongPath=enemies.some(e=>{const t0=clamp(((e.x-p.x)*(t.x-p.x)+(e.y-p.y)*(t.y-p.y))/Math.max(1,d*d),0,1);return t0>.08&&t0<.96&&Math.hypot(e.x-(p.x+(t.x-p.x)*t0),e.y-(p.y+(t.y-p.y)*t0))<57;})?-2:0;
    const s=alignment*1.6+fieldProgress/800-d/1000+targetThreat+alongPath;
    if(s>score){score=s;target=t;}
  }
  return target;
}
function kick(m,p,kind='shoot',aimOverride){
  if(!p || m.freeze>0 || m.ended || p.cooldown>0 || !canTakeBall(m,p))return false;
  const b=m.ball;
  let aim=aimOverride?normalized(aimOverride.x,aimOverride.y):ballDirection(p);
  if(!aim.x&&!aim.y)aim={x:p.team?-1:1,y:0};
  if(kind==='pass'){
    const target=selectPass(m,p,aim);
    if(target) aim=normalized(target.x+target.vx*.24-b.x,target.y+target.vy*.24-b.y);
  }
  const speed=kind==='pass'?500:820;
  b.ownerId=null;b.ignoreId=p.id;b.loose=kind==='pass'?.15:.22;
  b.x=clamp(p.x+aim.x*29,FIELD.left+BALL_RADIUS,FIELD.right-BALL_RADIUS);
  b.y=clamp(p.y+aim.y*29,FIELD.top+BALL_RADIUS,FIELD.bottom-BALL_RADIUS);
  b.vx=aim.x*speed+p.vx*.15;b.vy=aim.y*speed+p.vy*.15;b.last=p.team;
  p.cooldown=kind==='pass'?.35:.48;
  m.notices.push({type:'kick',kind,x:b.x,y:b.y,team:p.team});
  return true;
}
function takeBall(m,p){
  const b=m.ball;b.ownerId=p.id;b.vx=0;b.vy=0;b.last=p.team;b.ignoreId=null;b.loose=0;
}
function tackle(m,p){
  if(!p || m.freeze>0 || p.tackleCooldown>0 || m.ended)return false;
  p.tackleCooldown=.65;
  const b=m.ball,owner=getOwner(m);
  if(owner && owner.team!==p.team && distance(p,owner)<54){takeBall(m,p);p.cooldown=.13;m.notices.push({type:'tackle',x:p.x,y:p.y,team:p.team});return true;}
  if(!owner && distance(p,b)<48 && b.loose<=.12){takeBall(m,p);return true;}
  return false;
}
function botDecision(m,bot,difficulty){
  const b=m.ball, owner=getOwner(m), sign=bot.team===0?1:-1;
  const targetGoalX=sign>0?FIELD.right:FIELD.left;
  const mates=m.players.filter(p=>p.team===bot.team&&p.slot!==0);
  const sortedMates=mates.sort((a,c)=>distance(a,b)-distance(c,b));
  const pressureRank=sortedMates.findIndex(p=>p.id===bot.id);
  const teammateOwns=owner&&owner.team===bot.team;
  let target;
  if(owner?.id===bot.id){
    if(bot.slot===0){
      bot.input.dx=bot.input.dy=0;bot.input.sprint=false;
      if(bot.cooldown<=0)kick(m,bot,'pass');
      return;
    }
    const goalDistance=Math.abs(targetGoalX-b.x);
    if((bot.slot!==3 && goalDistance>440 && Math.random()<.085 && bot.cooldown<=0) || (goalDistance<290 && bot.cooldown<=0)){
      const deviation=difficulty==='easy'?.13:difficulty==='hard'?.035:.075;
      const aim=normalized(sign,(H/2-b.y)/Math.max(130,goalDistance)+(Math.random()-.5)*deviation);
      kick(m,bot,goalDistance<290?'shoot':'pass',aim);
      return;
    }
    target={x:targetGoalX,y:clamp(H/2+(bot.y-H/2)*.42,250,470)};
  } else if(bot.slot===0){ // goalkeeper is anchored; only contests close balls
    const homeX=sign>0?FIELD.left+48:FIELD.right-48;
    target={x:homeX,y:clamp(b.y,FIELD.goalTop+20,FIELD.goalBottom-20)};
    if(!teammateOwns && distance(bot,b)<110)target={x:b.x,y:b.y};
  } else if(!teammateOwns && (pressureRank === 0 || (pressureRank === 1 && (bot.team===0?b.x<W*.53:b.x>W*.47)) || (owner && owner.team!==bot.team && distance(bot,owner)<110))){
    target={x:b.x+b.vx*.12,y:b.y+b.vy*.12};
  } else if(bot.slot===3){
    target={x:clamp(b.x+sign*145,FIELD.left+100,FIELD.right-100),y:clamp(b.y*.7+H*.15,180,540)};
  } else {
    const base=spawnPoint(bot.team,bot.slot);
    target={x:clamp(base.x+(b.x-W/2)*.52,FIELD.left+75,FIELD.right-75),y:clamp(base.y+(b.y-H/2)*.40,FIELD.top+60,FIELD.bottom-60)};
  }
  if(!target)target={x:bot.x,y:bot.y};
  const d=distance(bot,target), dir=normalized(target.x-bot.x,target.y-bot.y);
  bot.input.dx=dir.x*clamp(d/40,0,1);bot.input.dy=dir.y*clamp(d/40,0,1);
  bot.input.sprint=d>120&&bot.stamina>32&&difficulty!=='easy';
  if(owner?.id!==bot.id){const aim=normalized(targetGoalX-b.x,H/2-b.y);bot.input.ax=aim.x;bot.input.ay=aim.y;}
  if(owner && owner.team!==bot.team && distance(bot,owner)<44 && bot.tackleCooldown<=0)tackle(m,bot);
}
function stepMatch(room,dt){
  const m=room.match;
  if(!m||m.ended)return;
  dt=clamp(finite(dt),0,.055);m.tick++;m.notices=[];
  if(m.freeze>0){m.freeze=Math.max(0,m.freeze-dt);return;}
  m.timeLeft=Math.max(0,m.timeLeft-dt);
  if(m.timeLeft<=0){m.ended=true;room.status='ended';broadcast(room,{type:'ended',score:[...m.score]});updateRoom(room);return;}
  const b=m.ball;b.loose=Math.max(0,b.loose-dt);if(b.loose===0)b.ignoreId=null;
  for(const p of m.players){
    p.cooldown=Math.max(0,p.cooldown-dt);p.tackleCooldown=Math.max(0,p.tackleCooldown-dt);
    if(p.isBot)botDecision(m,p,room.opts.difficulty);
    const input=normalized(p.input.dx,p.input.dy), active=input.x||input.y;
    let speed=p.isBot?({easy:192,normal:218,hard:234}[room.opts.difficulty]):242;
    const sprint=p.input.sprint&&p.stamina>2&&active;
    if(sprint){speed*=1.26;p.stamina=Math.max(0,p.stamina-32*dt);}else p.stamina=Math.min(100,p.stamina+24*dt);
    const targetVx=input.x*speed,targetVy=input.y*speed;
    const blend=Math.min(1,dt*12);
    p.vx+=(targetVx-p.vx)*blend;p.vy+=(targetVy-p.vy)*blend;
    p.x=clamp(p.x+p.vx*dt,FIELD.left+PLAYER_RADIUS,FIELD.right-PLAYER_RADIUS);
    p.y=clamp(p.y+p.vy*dt,FIELD.top+PLAYER_RADIUS,FIELD.bottom-PLAYER_RADIUS);
    if(active)p.facing=input;
  }
  for(let i=0;i<m.players.length;i++)for(let j=i+1;j<m.players.length;j++){
    const a=m.players[i],c=m.players[j];const d=distance(a,c);
    if(d>=32)continue;
    const dir=d<.001?{x:1,y:0}:normalized(c.x-a.x,c.y-a.y);
    const push=(32-Math.max(.001,d))/2;
    a.x=clamp(a.x-dir.x*push,FIELD.left+PLAYER_RADIUS,FIELD.right-PLAYER_RADIUS);
    a.y=clamp(a.y-dir.y*push,FIELD.top+PLAYER_RADIUS,FIELD.bottom-PLAYER_RADIUS);
    c.x=clamp(c.x+dir.x*push,FIELD.left+PLAYER_RADIUS,FIELD.right-PLAYER_RADIUS);
    c.y=clamp(c.y+dir.y*push,FIELD.top+PLAYER_RADIUS,FIELD.bottom-PLAYER_RADIUS);
  }
  const owner=getOwner(m);
  if(owner){
    // Tight controlled dribble, with the ball in front of the player.
    const f=owner.facing;
    b.x=owner.x+f.x*24;b.y=owner.y+f.y*24;
    b.vx=owner.vx;b.vy=owner.vy;
    for(const foe of m.players){
      if(foe.team===owner.team||distance(foe,owner)>=30 || foe.tackleCooldown>0)continue;
      // AI challenges require positioning, rather than pinball collisions.
      if(foe.isBot)tackle(m,foe);
    }
  } else {
    b.x+=b.vx*dt;b.y+=b.vy*dt;
    const friction=Math.exp(-1.45*dt);b.vx*=friction;b.vy*=friction;
    const inGoal=b.y>=FIELD.goalTop+BALL_RADIUS&&b.y<=FIELD.goalBottom-BALL_RADIUS;
    if((b.x>=FIELD.right+BALL_RADIUS || b.x<=FIELD.left-BALL_RADIUS)&&inGoal){
      const team=b.x>W/2?0:1;m.score[team]++;
      broadcast(room,{type:'goal',team,score:[...m.score],scorerTeam:b.last});
      resetFormation(m);updateRoom(room);return;
    }
    if(b.y<FIELD.top+BALL_RADIUS){b.y=FIELD.top+BALL_RADIUS;b.vy=Math.abs(b.vy)*.74;}
    if(b.y>FIELD.bottom-BALL_RADIUS){b.y=FIELD.bottom-BALL_RADIUS;b.vy=-Math.abs(b.vy)*.74;}
    if(b.x>FIELD.right-BALL_RADIUS&&!inGoal){b.x=FIELD.right-BALL_RADIUS;b.vx=-Math.abs(b.vx)*.7;}
    if(b.x<FIELD.left+BALL_RADIUS&&!inGoal){b.x=FIELD.left+BALL_RADIUS;b.vx=Math.abs(b.vx)*.7;}
    // Only ONE player can pick up a loose ball. Exclude the kicker briefly.
    if(b.loose<=0){
      const nearest=m.players.filter(p=>p.id!==b.ignoreId).sort((a,c)=>distance(a,b)-distance(c,b))[0];
      if(nearest && distance(nearest,b)<PLAYER_RADIUS+BALL_RADIUS+6)takeBall(m,nearest);
    }
  }
}
function snapshot(room){const m=room.match;return {tick:m.tick,players:m.players.map(p=>({id:p.id,name:p.name,team:p.team,slot:p.slot,bot:p.isBot,x:+p.x.toFixed(1),y:+p.y.toFixed(1),vx:+p.vx.toFixed(1),vy:+p.vy.toFixed(1),stamina:Math.round(p.stamina),facing:p.facing})),ball:{x:m.ball.x,y:m.ball.y,vx:m.ball.vx,vy:m.ball.vy,ownerId:m.ball.ownerId},score:[...m.score],timeLeft:m.timeLeft,freeze:m.freeze,status:room.status,notices:m.notices};}
function removeSocket(ws){
  const room=rooms.get(ws.roomCode);ws.roomCode=null;if(!room)return;
  room.users.delete(ws.id);
  if(room.match){const p=room.match.players.find(p=>p.id===ws.id);if(p){p.isBot=true;p.name=['Torwart','Flügel','Abwehr','Angriff'][p.slot];p.id=`BOT-${p.team}-${p.slot}`;p.input.dx=p.input.dy=0;if(room.match.ball.ownerId===ws.id)room.match.ball.ownerId=p.id;}}
  if(!room.users.size){rooms.delete(room.code);return;}
  if(room.hostId===ws.id)room.hostId=room.users.keys().next().value;
  updateRoom(room);
}
function joinRoom(ws,room,name,requestedTeam){
  if(ws.roomCode)removeSocket(ws);
  const counts=[0,0];for(const u of room.users.values())counts[u.team]++;
  const team=([0,1].includes(requestedTeam) && counts[requestedTeam]<TEAM_SIZE)?requestedTeam:(counts[0]<=counts[1]?0:1);
  room.users.set(ws.id,{id:ws.id,ws,team,name:sanitizeName(name)});ws.roomCode=room.code;
  if(room.status==='playing'&&room.match){
    const available=room.match.players.filter(p=>p.team===team&&p.isBot).sort((a,c)=>c.slot-a.slot)[0];
    if(available){if(room.match.ball.ownerId===available.id)room.match.ball.ownerId=ws.id;available.id=ws.id;available.name=sanitizeName(name);available.isBot=false;available.input={dx:0,dy:0,ax:team?-1:1,ay:0,sprint:false};}
  }
  updateRoom(room);
}
function handleMessage(ws,msg){
  if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
  const type=String(msg.type||'');
  if(type==='create'){
    const code=newRoomCode();const room={code,hostId:ws.id,opts:validOpts(msg.opts),users:new Map(),match:null,status:'lobby',createdAt:Date.now()};
    rooms.set(code,room);joinRoom(ws,room,msg.name);return;
  }
  if(type==='join'){
    const code=String(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');const room=rooms.get(code);
    if(!room){safeSend(ws,{type:'error',message:'Raum nicht gefunden. Bitte Code prüfen.'});return;}
    if(room.status==='ended'){safeSend(ws,{type:'error',message:'Dieses Match ist beendet. Bitte warte auf die nächste Runde.'});return;}
    if(room.users.size>=MAX_HUMANS){safeSend(ws,{type:'error',message:'Dieser Raum ist voll.'});return;}
    joinRoom(ws,room,msg.name,Number(msg.team));return;
  }
  if(type==='leave'){removeSocket(ws);safeSend(ws,{type:'left'});return;}
  const room=rooms.get(ws.roomCode);if(!room||!room.users.has(ws.id))return;
  if(type==='team'&&room.status==='lobby'){
    const team=Number(msg.team);if(![0,1].includes(team))return;
    if([...room.users.values()].filter(u=>u.team===team&&u.id!==ws.id).length>=TEAM_SIZE){safeSend(ws,{type:'error',message:'Team ist bereits voll.'});return;}
    room.users.get(ws.id).team=team;updateRoom(room);
  } else if(type==='settings'&&room.status==='lobby'&&ws.id===room.hostId){room.opts=validOpts(msg.opts);updateRoom(room);
  } else if(type==='start'&&room.status==='lobby'&&ws.id===room.hostId){startMatch(room);
  } else if(type==='rematch'&&room.status==='ended'&&ws.id===room.hostId){room.status='lobby';room.match=null;updateRoom(room);
  } else if(type==='input'&&room.status==='playing'&&room.match){
    const p=room.match.players.find(p=>p.id===ws.id);if(!p)return;
    const dx=clamp(finite(Number(msg.dx)),-1,1),dy=clamp(finite(Number(msg.dy)),-1,1);
    const n=normalized(dx,dy),m=Math.min(1,Math.hypot(dx,dy));p.input.dx=n.x*m;p.input.dy=n.y*m;
    p.input.sprint=msg.sprint===true;
    if(Number.isFinite(msg.ax)&&Number.isFinite(msg.ay)){const a=normalized(clamp(msg.ax,-1,1),clamp(msg.ay,-1,1));if(a.x||a.y){p.input.ax=a.x;p.input.ay=a.y;}}
  } else if(type==='action'&&room.status==='playing'&&room.match){
    const p=room.match.players.find(p=>p.id===ws.id);if(!p)return;
    const aim=Number.isFinite(msg.ax)&&Number.isFinite(msg.ay)?normalized(msg.ax,msg.ay):null;
    if(msg.kind==='shoot'||msg.kind==='pass')kick(room.match,p,msg.kind,aim);
    else if(msg.kind==='tackle')tackle(room.match,p);
  } else if(type==='ping'){safeSend(ws,{type:'pong',t:msg.t});}
}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,version:2,rooms:rooms.size,players:sockets.size}));return;}
  let rel;try{rel=decodeURIComponent(u.pathname).replace(/^[/\\]+/,'')||'index.html';}catch{res.writeHead(400);res.end();return;}
  const file=path.resolve(PUBLIC,rel);
  if(!file.startsWith(PUBLIC+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
  fs.readFile(file,(error,content)=>{if(error){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(content);});
});
installWebSocketServer(server,'/ws',ws=>{
  ws.id=crypto.randomBytes(6).toString('hex');ws.roomCode=null;sockets.set(ws.id,ws);safeSend(ws,{type:'welcome',id:ws.id});
  ws.on('message',data=>{try{handleMessage(ws,JSON.parse(String(data)));}catch(error){safeSend(ws,{type:'error',message:'Ungültige Nachricht.'});}});
  ws.on('close',()=>{removeSocket(ws);sockets.delete(ws.id);});ws.on('error',()=>{});
});
let last=process.hrtime.bigint(),accumulator=0,broadcastTick=0;
const ticker=setInterval(()=>{
  const now=process.hrtime.bigint();accumulator=Math.min(.15,accumulator+Math.max(0,Number(now-last)/1e9));last=now;
  while(accumulator>=DT){
    accumulator-=DT;broadcastTick++;
    for(const room of rooms.values())if(room.status==='playing'&&room.match){stepMatch(room,DT);if(broadcastTick%2===0)broadcast(room,{type:'snapshot',state:snapshot(room)});}
  }
},1000/30);
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log(`STRIKE ARENA v2 ready on port ${PORT}`));
module.exports={server,rooms,startMatch,stepMatch,kick,tackle,validOpts,sanitizeName,makePlayer,snapshot,ticker};
