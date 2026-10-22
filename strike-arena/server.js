'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { installWebSocketServer } = require('./miniws');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const W = 1200, H = 720;
const FIELD = { left: 72, right: 1128, top: 76, bottom: 644, goalTop: 290, goalBottom: 430 };
const MAX_HUMANS = 8, TEAM_SIZE = 4;
const TICK_MS = 1000 / 30;
const rooms = new Map();
const sockets = new Map();
const roomChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomId = () => crypto.randomBytes(6).toString('hex');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const normalize = (x, y) => {
  const m = Math.hypot(x, y);
  return m > 0.001 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
};
const sanitizeName = (v) => String(v || '').replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 16) || 'Spieler';
const validOpts = (opt) => ({
  duration: [120, 180, 300, 480].includes(Number(opt?.duration)) ? Number(opt.duration) : 180,
  difficulty: ['easy', 'normal', 'hard'].includes(opt?.difficulty) ? opt.difficulty : 'normal'
});
const json = (ws, data) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
};
function makeCode() {
  let s;
  do { s = Array.from(crypto.randomBytes(6)).slice(0, 5).map(b => roomChars[b % roomChars.length]).join(''); }
  while (rooms.has(s));
  return s;
}
function roomData(room) {
  return {
    code: room.code, hostId: room.hostId, status: room.status, opts: room.opts,
    users: [...room.users.values()].map(u => ({ id: u.id, name: u.name, team: u.team })),
    score: room.match?.score || [0, 0],
    timeLeft: room.match?.timeLeft ?? room.opts.duration
  };
}
function broadcast(room, event) {
  for (const u of room.users.values()) json(u.ws, event);
}
function updateRoom(room) {
  for (const u of room.users.values()) json(u.ws, { type: 'room', room: roomData(room), you: u.id });
}
function detach(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  ws.roomCode = null;
  if (!room) return;
  room.users.delete(ws.id);
  if (!room.users.size) { rooms.delete(code); return; }
  if (room.hostId === ws.id) room.hostId = room.users.values().next().value.id;
  if (room.match) room.match.players = room.match.players.filter(p => p.id !== ws.id);
  updateRoom(room);
}
function joinRoom(ws, room, name) {
  if (ws.roomCode) detach(ws);
  const count = [0, 0];
  for (const u of room.users.values()) count[u.team]++;
  const team = count[0] <= count[1] ? 0 : 1;
  const user = { id: ws.id, ws, name: sanitizeName(name), team };
  room.users.set(ws.id, user);
  ws.roomCode = room.code;
  updateRoom(room);
}
function baseSpawn(team, slot) {
  const slots = [
    { x: 159, y: 360 }, { x: 339, y: 200 },
    { x: 339, y: 520 }, { x: 472, y: 360 }
  ];
  const o = slots[slot];
  return { x: team === 0 ? o.x : W - o.x, y: o.y };
}
function makePlayer(id, name, team, slot, isBot = false) {
  const spawn = baseSpawn(team, slot);
  return {
    id, name, team, slot, isBot, x: spawn.x, y: spawn.y,
    vx: 0, vy: 0, cooldown: 0,
    input: { dx: 0, dy: 0, sprint: false, ax: team ? -1 : 1, ay: 0 },
    stamina: 100, botDecision: 0
  };
}
function resetFormation(match) {
  for (const p of match.players) {
    const sp = baseSpawn(p.team, p.slot);
    p.x = sp.x; p.y = sp.y; p.vx = 0; p.vy = 0;
  }
  match.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, last: -1 };
  match.freeze = 1.2;
}
function startMatch(room) {
  const players = [];
  for (let team = 0; team <= 1; team++) {
    const users = [...room.users.values()].filter(u => u.team === team);
    const preferredSlots = [3, 1, 2, 0];
    const taken = new Set();
    users.forEach((u, i) => {
      const slot = preferredSlots[i];
      taken.add(slot);
      players.push(makePlayer(u.id, u.name, team, slot));
    });
    for (let slot = 0; slot < TEAM_SIZE; slot++) if (!taken.has(slot)) {
      players.push(makePlayer(`BOT-${team}-${slot}`, ['Keeper', 'Flügel', 'Verteidiger', 'Stürmer'][slot], team, slot, true));
    }
  }
  room.match = { players, ball: { x: W / 2, y: H / 2, vx: 0, vy: 0, last: -1 },
    score: [0, 0], timeLeft: room.opts.duration, freeze: 1.5, ended: false,
    goalNotice: null, notices: [], tick: 0 };
  room.status = 'playing';
  updateRoom(room);
  broadcast(room, { type: 'started' });
}
function shoot(match, player, kind = 'shoot') {
  if (!player || match.freeze > 0 || match.ended || player.cooldown > 0 || dist(player, match.ball) > 54) return;
  const b = match.ball;
  const natural = normalize(b.x - player.x, b.y - player.y);
  const aim = normalize(player.input.ax, player.input.ay);
  let dir = Math.hypot(aim.x, aim.y) > 0 ? aim : natural;
  if (!dir.x && !dir.y) dir = { x: player.team ? -1 : 1, y: 0 };
  // Passing selects closest teammate ahead or open nearby teammate.
  if (kind === 'pass') {
    let target = null, best = Infinity;
    for (const other of match.players) {
      if (other.team !== player.team || other.id === player.id) continue;
      const d = dist(player, other);
      if (d < 45) continue;
      const alignment = (other.x - player.x) * (player.team ? -1 : 1);
      const score = d - alignment * 0.3;
      if (score < best) { best = score; target = other; }
    }
    if (target) dir = normalize(target.x + target.vx * 0.35 - b.x, target.y + target.vy * 0.35 - b.y);
  }
  const speed = kind === 'pass' ? 420 : 700;
  b.vx = dir.x * speed + player.vx * 0.19;
  b.vy = dir.y * speed + player.vy * 0.19;
  b.last = player.team;
  player.cooldown = kind === 'pass' ? 0.45 : 0.64;
  match.notices.push({ type: 'kick', x: b.x, y: b.y, team: player.team, kind });
}
function botInput(match, bot, difficulty, dt) {
  const ball = match.ball;
  const mates = match.players.filter(p => p.team === bot.team);
  const sorted = [...mates].sort((a, b) => dist(a, ball) - dist(b, ball));
  const rank = sorted.findIndex(p => p.id === bot.id);
  const attackRight = bot.team === 0;
  const goalX = attackRight ? FIELD.right : FIELD.left;
  const ownGoalX = attackRight ? FIELD.left : FIELD.right;
  const ballD = dist(bot, ball);
  let target;
  // Goalkeeper anchors around own box and challenges attacks.
  if (bot.slot === 0 && ballD > 150) {
    target = { x: ownGoalX + (attackRight ? 75 : -75), y: clamp(ball.y, 285, 435) };
  } else if (rank === 0 || (rank === 1 && ballD < 175 && bot.slot !== 0)) {
    target = { x: ball.x + ball.vx * 0.13, y: ball.y + ball.vy * 0.13 };
  } else if (bot.slot === 3) {
    target = { x: clamp(ball.x + (attackRight ? 150 : -150), FIELD.left + 90, FIELD.right - 90), y: clamp(ball.y, 190, 530) };
  } else {
    const sp = baseSpawn(bot.team, bot.slot);
    target = { x: clamp(sp.x + (ball.x - W / 2) * 0.45, FIELD.left + 35, FIELD.right - 35), y: sp.y + (ball.y - H / 2) * 0.28 };
  }
  const d = dist(bot, target);
  const motion = normalize(target.x - bot.x, target.y - bot.y);
  const scale = clamp(d / 38, 0, 1);
  bot.input.dx = motion.x * scale;
  bot.input.dy = motion.y * scale;
  bot.input.sprint = ballD < 245 && bot.stamina > 25 && difficulty !== 'easy';
  const goalDir = normalize(goalX - ball.x, 360 - ball.y);
  bot.input.ax = goalDir.x; bot.input.ay = goalDir.y;
  if (ballD < 44 && bot.cooldown <= 0) {
    const distanceToGoal = Math.abs(goalX - ball.x);
    const error = difficulty === 'hard' ? 0.13 : difficulty === 'easy' ? 0.85 : 0.38;
    bot.input.ay += (Math.random() - 0.5) * error;
    if (distanceToGoal < 380 || Math.random() < (difficulty === 'hard' ? 0.5 : 0.22)) shoot(match, bot, 'shoot');
    else shoot(match, bot, 'pass');
  }
}
function stepMatch(room, dt) {
  const m = room.match;
  if (!m || m.ended) return;
  m.tick++;
  m.notices = [];
  if (m.freeze > 0) {
    m.freeze = Math.max(0, m.freeze - dt);
    return;
  }
  m.timeLeft = Math.max(0, m.timeLeft - dt);
  if (m.timeLeft === 0) {
    m.ended = true; room.status = 'ended';
    broadcast(room, { type: 'ended', score: m.score });
    updateRoom(room);
    return;
  }
  for (const p of m.players) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.isBot) botInput(m, p, room.opts.difficulty, dt);
    let { dx, dy, sprint } = p.input;
    const d = normalize(dx, dy);
    let sp = p.isBot ? (room.opts.difficulty === 'hard' ? 225 : room.opts.difficulty === 'easy' ? 164 : 195) : 215;
    const canSprint = sprint && p.stamina > 1;
    if (canSprint) {
      sp *= 1.35;
      p.stamina = Math.max(0, p.stamina - 24 * dt);
    } else p.stamina = Math.min(100, p.stamina + 13 * dt);
    p.vx = d.x * sp; p.vy = d.y * sp;
    p.x = clamp(p.x + p.vx * dt, FIELD.left + 18, FIELD.right - 18);
    p.y = clamp(p.y + p.vy * dt, FIELD.top + 18, FIELD.bottom - 18);
  }
  // Soft body separation: players cannot occupy the same space.
  for (let i = 0; i < m.players.length; i++) for (let j = i + 1; j < m.players.length; j++) {
    const a = m.players[i], b = m.players[j];
    let dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 29) {
      if (length < 0.01) { dx = 1; dy = 0; length = 1; }
      const push = (29 - length) * 0.5;
      a.x = clamp(a.x - dx / length * push, FIELD.left + 18, FIELD.right - 18);
      a.y = clamp(a.y - dy / length * push, FIELD.top + 18, FIELD.bottom - 18);
      b.x = clamp(b.x + dx / length * push, FIELD.left + 18, FIELD.right - 18);
      b.y = clamp(b.y + dy / length * push, FIELD.top + 18, FIELD.bottom - 18);
    }
  }
  const b = m.ball;
  for (const p of m.players) {
    const distance = dist(p, b);
    if (distance < 24 && distance > 0.01) {
      const n = normalize(b.x - p.x, b.y - p.y);
      b.x = p.x + n.x * 24;
      b.y = p.y + n.y * 24;
      const carry = Math.max(90, Math.hypot(p.vx, p.vy) * 0.95);
      b.vx = b.vx * 0.28 + n.x * carry * 0.65 + p.vx * 0.32;
      b.vy = b.vy * 0.28 + n.y * carry * 0.65 + p.vy * 0.32;
      b.last = p.team;
    }
  }
  b.x += b.vx * dt; b.y += b.vy * dt;
  const friction = Math.exp(-2.4 * dt);
  b.vx *= friction; b.vy *= friction;
  if (b.y < FIELD.top + 9) { b.y = FIELD.top + 9; b.vy = Math.abs(b.vy) * 0.77; }
  if (b.y > FIELD.bottom - 9) { b.y = FIELD.bottom - 9; b.vy = -Math.abs(b.vy) * 0.77; }
  const inGoal = b.y >= FIELD.goalTop && b.y <= FIELD.goalBottom;
  if ((b.x >= FIELD.right + 5 || b.x <= FIELD.left - 5) && inGoal) {
    const scoringTeam = b.x > W / 2 ? 0 : 1;
    m.score[scoringTeam]++;
    broadcast(room, { type: 'goal', team: scoringTeam, score: m.score, scorerTeam: b.last });
    resetFormation(m);
    updateRoom(room);
    return;
  }
  if (b.x > FIELD.right - 9 && !inGoal) { b.x = FIELD.right - 9; b.vx = -Math.abs(b.vx) * 0.75; }
  if (b.x < FIELD.left + 9 && !inGoal) { b.x = FIELD.left + 9; b.vx = Math.abs(b.vx) * 0.75; }
}
function gameState(room) {
  const m = room.match;
  return {
    tick: m.tick, players: m.players.map(p => ({ id: p.id, name: p.name, team: p.team, bot: p.isBot,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, stamina: Math.round(p.stamina) })),
    ball: { x: m.ball.x, y: m.ball.y, vx: m.ball.vx, vy: m.ball.vy },
    score: m.score, timeLeft: m.timeLeft, freeze: m.freeze, status: room.status, notices: m.notices
  };
}
function handleMessage(ws, message) {
  if (!message || typeof message !== 'object') return;
  const type = String(message.type || '');
  if (type === 'create') {
    const code = makeCode();
    const room = { code, hostId: ws.id, opts: validOpts(message.opts), users: new Map(),
      match: null, status: 'lobby', createdAt: Date.now() };
    rooms.set(code, room);
    joinRoom(ws, room, message.name);
    return;
  }
  if (type === 'join') {
    const code = String(message.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = rooms.get(code);
    if (!room) { json(ws, { type: 'error', message: 'Raum nicht gefunden. Prüfe den Code.' }); return; }
    if (room.status !== 'lobby') { json(ws, { type: 'error', message: 'Das Match läuft bereits. Warte auf die nächste Runde.' }); return; }
    if (room.users.size >= MAX_HUMANS) { json(ws, { type: 'error', message: 'Dieser Raum ist voll.' }); return; }
    joinRoom(ws, room, message.name);
    return;
  }
  if (type === 'leave') { detach(ws); json(ws, { type: 'left' }); return; }
  const room = rooms.get(ws.roomCode);
  if (!room || !room.users.has(ws.id)) return;
  if (type === 'team' && room.status === 'lobby') {
    const team = Number(message.team);
    if (team !== 0 && team !== 1) return;
    const count = [...room.users.values()].filter(u => u.team === team && u.id !== ws.id).length;
    if (count >= TEAM_SIZE) { json(ws, { type: 'error', message: 'Dieses Team ist bereits voll.' }); return; }
    room.users.get(ws.id).team = team;
    updateRoom(room);
  } else if (type === 'settings' && ws.id === room.hostId && room.status === 'lobby') {
    room.opts = validOpts(message.opts);
    updateRoom(room);
  } else if (type === 'start' && ws.id === room.hostId && room.status === 'lobby') {
    startMatch(room);
  } else if (type === 'rematch' && ws.id === room.hostId && room.status === 'ended') {
    room.status = 'lobby'; room.match = null;
    updateRoom(room);
  } else if (type === 'input' && room.status === 'playing' && room.match) {
    const p = room.match.players.find(p => p.id === ws.id);
    if (!p) return;
    let dx = clamp(finite(Number(message.dx)), -1, 1);
    let dy = clamp(finite(Number(message.dy)), -1, 1);
    const n = normalize(dx, dy);
    p.input.dx = n.x * Math.min(1, Math.hypot(dx, dy));
    p.input.dy = n.y * Math.min(1, Math.hypot(dx, dy));
    p.input.sprint = !!message.sprint;
    if (Number.isFinite(message.ax) && Number.isFinite(message.ay)) {
      const a = normalize(clamp(message.ax, -1, 1), clamp(message.ay, -1, 1));
      if (a.x || a.y) { p.input.ax = a.x; p.input.ay = a.y; }
    }
  } else if (type === 'action' && room.status === 'playing' && room.match && ['shoot', 'pass'].includes(message.kind)) {
    shoot(room.match, room.match.players.find(p => p.id === ws.id), message.kind);
  } else if (type === 'ping') json(ws, { type: 'pong', t: message.t });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: sockets.size }));
    return;
  }
  let safe;
  try { safe = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, ''); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  const filePath = path.resolve(PUBLIC, safe || 'index.html');
  if (filePath !== PUBLIC && !filePath.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
});
installWebSocketServer(server, '/ws', (ws) => {
  ws.id = randomId(); ws.roomCode = null; sockets.set(ws.id, ws);
  json(ws, { type: 'welcome', id: ws.id });
  ws.on('message', data => {
    try { handleMessage(ws, JSON.parse(String(data))); }
    catch (e) { json(ws, { type: 'error', message: 'Ungültige Nachricht.' }); }
  });
  ws.on('close', () => { detach(ws); sockets.delete(ws.id); });
  ws.on('error', () => {});
});
let previous = process.hrtime.bigint();
let broadcastTimer = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Math.min(0.1, Number(now - previous) / 1e9);
  previous = now;
  broadcastTimer++;
  for (const room of rooms.values()) if (room.status === 'playing') {
    stepMatch(room, dt);
    if (broadcastTimer % 2 === 0 && room.match) broadcast(room, { type: 'snapshot', state: gameState(room) });
  }
}, TICK_MS);
server.listen(PORT, '0.0.0.0', () => console.log(`STRIKE ARENA live on http://localhost:${PORT}`));
module.exports = { server, rooms, startMatch, stepMatch, shoot, validOpts, sanitizeName };
