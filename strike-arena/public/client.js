(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const q = new URLSearchParams(window.location.search);
  const W = 1200, H = 720, F = { left: 72, right: 1128, top: 76, bottom: 644, goalTop: 290, goalBottom: 430 };
  const COLORS = ['#66baff', '#ff707c'];
  const DARK_COLORS = ['#2859b5', '#ae344e'];
  const ctx = $('pitchCanvas').getContext('2d');
  let socket = null, connected = false, currentRoom = null, myId = null, mode = 'home';
  let pendingSolo = false, world = null, lastStateTick = -1, toastTimeout, bannerTimeout, pendingRejoin = null;
  let pingMs = 0, pingAt = 0, reconnectTimer, frameClock = 0, lastFrame = performance.now();
  const smoothPlayers = new Map();
  const keys = new Set();
  const sparks = [];
  const stars = Array.from({length: 115}, (_, i) => ({ x: ((i * 137.5 + 57) % W), y: i % 2 ? 27 + (i * 2 % 24) : H - 27 - (i * 3 % 20), r: 1 + (i % 3) * 0.6, t: i * 1.73 }));
  const pointer = { active: false, x: 0, y: 0 };
  const stick = { active: false, pointerId: null, x: 0, y: 0 };
  let sprintTouch = false;
  let viewVersion = 0;

  try { $('playerName').value = localStorage.getItem('strike-name') || 'Spieler'; } catch {}
  if (q.get('room')) {
    $('roomCode').value = q.get('room').trim().slice(0,5).toUpperCase();
    $('setupHint').textContent = 'Du hast einen Einladungslink geöffnet. Namen eingeben und auf BEITRETEN klicken.';
  }
  function notice(text) {
    $('toast').textContent = text;
    $('toast').classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 3200);
  }
  function connectionUI(online) {
    connected = online;
    $('connectionDot').classList.toggle('connected', online);
    $('connectionText').textContent = online ? 'Server online' : 'Server offline';
    for (const id of ['createBtn','soloBtn','joinBtn']) $(id).disabled = !online;
  }
  function connect() {
    clearTimeout(reconnectTimer);
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${scheme}//${location.host}/ws`);
    socket.addEventListener('open', () => {
      connectionUI(true);
      if (pendingRejoin) {
        send({type:'join',code:pendingRejoin.code,name:pendingRejoin.name,team:pendingRejoin.team});
        notice('Verbindung wiederhergestellt. Du trittst dem Match erneut bei.');
        pendingRejoin = null;
      } else if (mode !== 'home' && !currentRoom) switchTo('home');
    });
    socket.addEventListener('close', () => {
      connectionUI(false);
      if (currentRoom) {
        pendingRejoin = {code:currentRoom.code,name:currentRoom.users.find(u=>u.id===myId)?.name || getName(),team:currentRoom.users.find(u=>u.id===myId)?.team ?? 0};
      }
      currentRoom = null; world = null; smoothPlayers.clear();
      if (mode !== 'home') switchTo('home');
      notice('Verbindung verloren. Automatische Wiederverbindung läuft.');
      reconnectTimer = setTimeout(connect, 2000);
    });
    socket.addEventListener('error', () => {});
    socket.addEventListener('message', ({ data }) => {
      let msg; try { msg = JSON.parse(data); } catch { return; }
      onMessage(msg);
    });
  }
  function send(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      notice('Keine Serververbindung. Bitte kurz erneut versuchen.');
      return false;
    }
    socket.send(JSON.stringify(data));
    return true;
  }
  function getName() {
    const name = $('playerName').value.replace(/[<>]/g, '').trim().slice(0,16) || 'Spieler';
    try { localStorage.setItem('strike-name', name); } catch {}
    return name;
  }
  function switchTo(next) {
    mode = next;
    for (const view of ['home','lobby','game']) $(`${view}Screen`).classList.toggle('hidden', view !== next);
    $('footer').classList.toggle('hidden', next === 'game');
    window.scrollTo({ top: 0, behavior: 'instant' });
    viewVersion++;
  }
  function onMessage(msg) {
    if (msg.type === 'welcome') { myId = msg.id; return; }
    if (msg.type === 'error') { notice(msg.message); pendingSolo = false; pendingRejoin = null; return; }
    if (msg.type === 'left') { currentRoom = null; world = null; switchTo('home'); return; }
    if (msg.type === 'room') {
      currentRoom = msg.room; myId = msg.you; pendingRejoin = null;
      if (currentRoom.status === 'lobby') {
        if (mode !== 'lobby') switchTo('lobby');
        renderLobby();
        if (pendingSolo && currentRoom.hostId === myId) {
          pendingSolo = false;
          send({type:'start'});
        }
      } else {
        if (mode !== 'game') { switchTo('game'); $('endOverlay').classList.add('hidden'); }
        $('gameCode').textContent = currentRoom.code;
        $('blueScore').textContent = currentRoom.score[0];
        $('redScore').textContent = currentRoom.score[1];
        $('matchClock').textContent = formatTime(currentRoom.timeLeft);
        if (currentRoom.status === 'ended') showEnd(currentRoom.score);
      }
      return;
    }
    if (msg.type === 'started') {
      world = null; lastStateTick = -1; smoothPlayers.clear(); sparks.length = 0;
      $('endOverlay').classList.add('hidden'); showBanner('ANPFIFF', 900);
      return;
    }
    if (msg.type === 'snapshot') {
      world = msg.state;
      if (lastStateTick !== world.tick) {
        addNewParticles(world.notices || []);
        lastStateTick = world.tick;
      }
      updateHUD();
      return;
    }
    if (msg.type === 'goal') {
      playSfx('goal');
      showBanner(msg.team === 0 ? 'TOR FÜR BLAU!' : 'TOR FÜR ROT!', 1600);
      $('blueScore').textContent = msg.score[0]; $('redScore').textContent = msg.score[1];
      return;
    }
    if (msg.type === 'ended') { showEnd(msg.score); return; }
    if (msg.type === 'pong') { pingMs = Math.max(0, Date.now() - msg.t); }
  }
  function showBanner(text, ms) {
    const b = $('gameBanner'); b.textContent = text;
    b.classList.remove('hidden');
    clearTimeout(bannerTimeout); bannerTimeout = setTimeout(() => b.classList.add('hidden'), ms);
  }
  function formatTime(seconds) {
    const s = Math.ceil(Math.max(0, seconds || 0));
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }
  function showEnd(score) {
    if (mode !== 'game') switchTo('game');
    const me = currentRoom?.users.find(u => u.id === myId);
    const winner = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1;
    $('endTitle').textContent = winner < 0 ? 'UNENTSCHIEDEN!' : me?.team === winner ? 'SIEG!' : 'ABPFIFF!';
    $('endScore').textContent = `${score[0]} : ${score[1]}`;
    $('endText').textContent = winner < 0 ? 'Beide Teams haben alles gegeben!' : `${winner === 0 ? 'Blue Strikers' : 'Red Rivals'} gewinnen das Match.`;
    $('rematchBtn').classList.toggle('hidden', currentRoom?.hostId !== myId);
    $('endOverlay').classList.remove('hidden');
  }
  function renderLobby() {
    if (!currentRoom) return;
    $('displayCode').textContent = currentRoom.code;
    const teams = [currentRoom.users.filter(u => u.team === 0),currentRoom.users.filter(u => u.team === 1)];
    teams.forEach((users, team) => {
      $(`${team === 0 ? 'blue' : 'red'}Count`).textContent = `${users.length} / 4`;
      const target = $(`${team === 0 ? 'blue' : 'red'}Roster`);
      target.replaceChildren();
      for (let i = 0; i < 4; i++) {
        const user = users[i]; const row = document.createElement('div'); row.className = 'roster-slot';
        const avatar = document.createElement('span'); avatar.className = 'avatar-round';
        avatar.textContent = user ? user.name.charAt(0).toUpperCase() : '✦';
        avatar.style.color = user ? COLORS[team] : '#739888';
        const label = document.createElement('strong');
        label.textContent = user ? user.name + (user.id === myId ? ' (Du)' : '') : 'Freier Platz';
        if (!user) label.className = 'empty-slot';
        const tag = document.createElement('span');
        tag.className = user?.id === currentRoom.hostId ? 'host-tag' : 'bot-tag';
        tag.textContent = !user ? 'BOT' : user.id === currentRoom.hostId ? 'HOST' : 'PLAYER';
        row.append(avatar,label,tag); target.append(row);
      }
    });
    const me = currentRoom.users.find(u => u.id === myId);
    ['blue','red'].forEach((teamName, team) => {
      const button = $(`${teamName}Join`);
      button.disabled = me?.team === team || teams[team].length >= 4;
      button.textContent = me?.team === team ? '✓ Dein Team' : `Team ${team === 0 ? 'Blau' : 'Rot'} wählen`;
    });
    const host = currentRoom.hostId === myId;
    $('startBtn').classList.toggle('hidden', !host);
    $('lobbyWaitText').textContent = host ? 'Freie Plätze werden automatisch von Bots besetzt.' : 'Warte darauf, dass der Host das Match startet.';
    $('durationSelect').disabled = !host;
    $('difficultySelect').disabled = !host;
    $('durationSelect').value = currentRoom.opts.duration;
    $('difficultySelect').value = currentRoom.opts.difficulty;
  }
  function updateHUD() {
    if (!world || mode !== 'game') return;
    $('blueScore').textContent = world.score[0]; $('redScore').textContent = world.score[1];
    $('matchClock').textContent = formatTime(world.timeLeft);
    const roster = $('matchRoster');
    const prior = roster.dataset.signature;
    const signature = world.players.map(p => p.id + p.team + p.bot).join(',');
    if (signature !== prior) {
      roster.replaceChildren();
      for (const team of [0,1]) for (const p of world.players.filter(p=>p.team===team)) {
        const row = document.createElement('div'); row.className = 'match-row' + (p.id === myId ? ' me' : '');
        const dot = document.createElement('span'); dot.className = 'p-dot'; dot.style.background = COLORS[team];
        const name = document.createElement('span'); name.className = 'p-name'; name.textContent = p.name + (p.id === myId ? ' ★' : '');
        const tag = document.createElement('span'); tag.className = 'p-bot'; tag.textContent = p.bot ? 'BOT' : '';
        row.append(dot,name,tag); roster.append(row);
      }
      roster.dataset.signature = signature;
    }
    const holder = world.players.find(p => p.id === world.ball.ownerId);
    $('possessionText').textContent = holder ? (holder.id === myId ? 'DU HAST DEN BALL' : `${holder.name} · ${holder.team === 0 ? 'Blau' : 'Rot'}`) : 'Freier Ball';
    $('matchStatus').textContent = world.freeze > .1 ? 'ANSTOSS' : world.ball.ownerId === myId ? 'BALLKONTROLLE' : 'MATCH LÄUFT';
    $('pingLabel').textContent = pingMs ? `PING ${pingMs} MS` : 'LIVE-VERBINDUNG';
  }
  function leave() {
    send({type:'leave'});
    currentRoom = null; world = null; pendingSolo = false; pendingRejoin = null;
    smoothPlayers.clear(); $('endOverlay').classList.add('hidden');
    switchTo('home');
  }
  $('brandBtn').addEventListener('click', () => { if (mode !== 'home') leave(); });
  $('soloBtn').addEventListener('click', () => { pendingSolo = true; send({type:'create',name:getName()}); });
  $('createBtn').addEventListener('click', () => { pendingSolo = false; send({type:'create',name:getName()}); });
  $('joinBtn').addEventListener('click', () => {
    const code = $('roomCode').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { notice('Bitte einen gültigen 5-stelligen Raumcode eingeben.'); return; }
    send({type:'join',code,name:getName()});
  });
  $('roomCode').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g,'').toUpperCase(); });
  $('roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
  $('playerName').addEventListener('keydown', e => { if (e.key === 'Enter') $('soloBtn').click(); });
  $('leaveLobby').addEventListener('click',leave);
  $('leaveMatch').addEventListener('click',leave);
  $('endLeaveBtn').addEventListener('click',leave);
  for (const t of ['blue','red']) $(`${t}Join`).addEventListener('click', () => send({type:'team',team:t==='blue'?0:1}));
  $('startBtn').addEventListener('click', () => send({type:'start'}));
  $('rematchBtn').addEventListener('click',() => { $('endOverlay').classList.add('hidden'); world=null; send({type:'rematch'}); });
  for (const id of ['durationSelect','difficultySelect']) $(id).addEventListener('change', () => send({type:'settings',opts:{duration:Number($('durationSelect').value),difficulty:$('difficultySelect').value}}));
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); notice('In die Zwischenablage kopiert!'); }
    catch { notice('Kopieren nicht erlaubt – Raumcode: ' + currentRoom?.code); }
  }
  $('copyCode').addEventListener('click',()=>currentRoom&&copyText(currentRoom.code));
  $('copyLink').addEventListener('click',()=>currentRoom&&copyText(`${location.origin}/?room=${currentRoom.code}`));

  function currentAim() {
    const me = world?.players.find(p=>p.id===myId);
    let dx = Number(keys.has('d')||keys.has('arrowright')) - Number(keys.has('a')||keys.has('arrowleft'));
    let dy = Number(keys.has('s')||keys.has('arrowdown')) - Number(keys.has('w')||keys.has('arrowup'));
    if (stick.active) {dx=stick.x;dy=stick.y;}
    let ax = dx, ay = dy;
    if (pointer.active && me) {ax=pointer.x-me.x;ay=pointer.y-me.y;}
    else if (Math.abs(ax)+Math.abs(ay)<.001 && me) {ax=me.team===1?-1:1;ay=0;}
    const m=Math.hypot(ax,ay)||1;
    return {ax:ax/m,ay:ay/m};
  }
  function action(kind) {
    if (!connected || mode !== 'game' || !world || world.status !== 'playing' || world.freeze > 0) return;
    send({type:'action',kind,...currentAim()});
    if (kind !== 'tackle') playSfx('kick');
  }
  // Input: keyboard, mouse aim, and touch control.
  window.addEventListener('keydown', e => {
    if (mode !== 'game' || $('endOverlay').classList.contains('hidden') === false) return;
    const k = e.key.toLowerCase();
    if ([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) e.preventDefault();
    if (!e.repeat && (k === ' ' || k === 'e' || k === 'q')) action(k === 'e' ? 'pass' : k === 'q' ? 'tackle' : 'shoot');
    keys.add(k);
  });
  window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur',()=>{keys.clear();sprintTouch=false;stick.x=0;stick.y=0;});
  $('pitchCanvas').addEventListener('pointermove',e=> {
    if (e.pointerType !== 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    pointer.x = (e.clientX-rect.left)*W/rect.width;
    pointer.y = (e.clientY-rect.top)*H/rect.height;
    pointer.active = true;
  });
  $('pitchCanvas').addEventListener('pointerleave',()=>pointer.active=false);
  $('pitchCanvas').addEventListener('pointerdown',e=> { if(e.pointerType==='mouse'&&e.button===0&&mode==='game') action('shoot'); });
  const joy = $('joystick');
  function moveStick(e) {
    const rect = joy.getBoundingClientRect();
    const x = e.clientX - (rect.left+rect.width/2), y = e.clientY-(rect.top+rect.height/2);
    const max = rect.width * .35;
    const n = Math.max(max,Math.hypot(x,y));
    stick.x = x/n; stick.y = y/n;
    $('joystickKnob').style.transform = `translate(${stick.x*max}px,${stick.y*max}px)`;
  }
  joy.addEventListener('pointerdown',e=> { e.preventDefault();stick.active=true;stick.pointerId=e.pointerId;joy.setPointerCapture(e.pointerId);moveStick(e); });
  joy.addEventListener('pointermove',e=> { if(stick.active&&stick.pointerId===e.pointerId)moveStick(e); });
  function releaseStick(e) { if (stick.pointerId!==e.pointerId)return;stick.active=false;stick.pointerId=null;stick.x=0;stick.y=0;$('joystickKnob').style.transform='translate(0,0)'; }
  joy.addEventListener('pointerup',releaseStick);joy.addEventListener('pointercancel',releaseStick);
  $('touchShoot').addEventListener('pointerdown',e=>{e.preventDefault();action('shoot');});
  $('touchPass').addEventListener('pointerdown',e=>{e.preventDefault();action('pass');});
  $('touchTackle').addEventListener('pointerdown',e=>{e.preventDefault();action('tackle');});
  $('touchSprint').addEventListener('pointerdown',e=>{e.preventDefault();sprintTouch=true;e.currentTarget.setPointerCapture(e.pointerId);});
  $('touchSprint').addEventListener('pointerup',()=>sprintTouch=false);
  $('touchSprint').addEventListener('pointercancel',()=>sprintTouch=false);

  let audioContext;
  function playSfx(kind) {
    try {
      audioContext = audioContext || new (window.AudioContext||window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.type = kind === 'goal' ? 'triangle':'sine';
      const t = audioContext.currentTime;
      oscillator.frequency.setValueAtTime(kind === 'goal'?480:180,t);
      oscillator.frequency.exponentialRampToValueAtTime(kind === 'goal'?950:70,t+(kind==='goal'?.6:.12));
      gain.gain.setValueAtTime(.065,t);
      gain.gain.exponentialRampToValueAtTime(.001,t+(kind==='goal'?.7:.15));
      oscillator.connect(gain);gain.connect(audioContext.destination);
      oscillator.start(t);oscillator.stop(t+(kind==='goal'?.72:.16));
    } catch {}
  }
  function sendInputs() {
    if (!connected || mode !== 'game' || !world || world.status !== 'playing') return;
    let dx = Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));
    let dy = Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));
    if (stick.active) { dx = stick.x; dy = stick.y; }
    const d = Math.hypot(dx,dy);if(d>1){dx/=d;dy/=d;}
    const {ax,ay}=currentAim();
    send({type:'input',dx,dy,ax,ay,sprint:keys.has('shift')||sprintTouch});
  }
  setInterval(sendInputs,50);
  setInterval(()=> { if(connected && mode !== 'home'){ pingAt=Date.now();send({type:'ping',t:pingAt}); } },5000);

  const normalizedClient=(x,y)=>{const n=Math.hypot(x,y)||1;return {x:x/n,y:y/n};};
  // Broadcast-style 2D pitch, players and ball.
  function rr(x,y,w,h,r,fill,stroke,width=1) {
    ctx.beginPath(); ctx.roundRect(x,y,w,h,r); if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}
  }
  function circle(x,y,r,fill,stroke=null,width=1){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
  function line(x1,y1,x2,y2,color,width=2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function drawPitch(time){
    ctx.fillStyle='#0d2119';ctx.fillRect(0,0,W,H);
    // Stadium rail and moving LED advertising on top/bottom.
    for(let i=0;i<stars.length;i++){
      const s=stars[i]; circle(s.x,s.y,s.r,`rgba(170,244,183,${.1+.22*Math.abs(Math.sin(time*.0017+s.t))})`);
    }
    rr(60,64,1080,592,9,'#163a27','#355e41',3);
    ctx.save();ctx.beginPath();ctx.rect(F.left,F.top,F.right-F.left,F.bottom-F.top);ctx.clip();
    for(let i=0;i<10;i++){
      ctx.fillStyle=i%2===0?'#205d37':'#22683b';
      ctx.fillRect(F.left+i*(F.right-F.left)/10,F.top,(F.right-F.left)/10+1,F.bottom-F.top);
    }
    const overlay=ctx.createLinearGradient(0,F.top,0,F.bottom);overlay.addColorStop(0,'#05150f56');overlay.addColorStop(.45,'#00000000');overlay.addColorStop(1,'#03130c74');ctx.fillStyle=overlay;ctx.fillRect(F.left,F.top,F.right-F.left,F.bottom-F.top);
    for(let i=0;i<150;i++){
      const x=F.left+(i*89.432%1056),y=F.top+(i*197.2%568);
      line(x,y,x+2,y-2,'#ffffff08',1);
    }
    ctx.restore();
    const white='#d9ffe18f';
    ctx.lineWidth=3;ctx.strokeStyle=white;ctx.strokeRect(F.left,F.top,F.right-F.left,F.bottom-F.top);
    line(W/2,F.top,W/2,F.bottom,white,3);
    circle(W/2,H/2,90,null,white,3);circle(W/2,H/2,4,'#d9ffe1bd');
    // Penalty and goalkeeper areas, penalty spots.
    ctx.strokeStyle=white;ctx.lineWidth=3;
    ctx.strokeRect(F.left,223,177,274);ctx.strokeRect(F.right-177,223,177,274);
    ctx.strokeRect(F.left,290,55,140);ctx.strokeRect(F.right-55,290,55,140);
    circle(190,H/2,4,'#d9ffe1b9');circle(1010,H/2,4,'#d9ffe1b9');
    ctx.beginPath();ctx.arc(190,H/2,87,-1.12,1.12);ctx.stroke();ctx.beginPath();ctx.arc(1010,H/2,87,Math.PI-1.12,Math.PI+1.12);ctx.stroke();
    // Goal boxes with net grids.
    for(const left of [true,false]){
      const x=left?27:F.right;
      rr(x, F.goalTop,45, F.goalBottom-F.goalTop,2,'#081916','#b9ffcb',3);
      for(let i=1;i<=5;i++) line(x+i*7,F.goalTop,x+i*7,F.goalBottom,'#b9ffcb42',1);
      for(let i=1;i<10;i++)line(x,F.goalTop+i*14,x+45,F.goalTop+i*14,'#b9ffcb42',1);
    }
    // Field corners
    for(const [x,y,a] of [[F.left,F.top,0],[F.right,F.top,Math.PI/2],[F.right,F.bottom,Math.PI],[F.left,F.bottom,Math.PI*1.5]]){
      ctx.beginPath();ctx.arc(x,y,15,a,a+Math.PI/2);ctx.strokeStyle=white;ctx.lineWidth=2;ctx.stroke();
    }
    // LED sideboards
    rr(260,20,260,18,4,'#193c2c');rr(680,20,260,18,4,'#193c2c');
    ctx.font='bold 12px Inter, sans-serif';ctx.fillStyle='#32d6b0cc';ctx.textAlign='center';
    ctx.fillText('STRIKE ARENA',390,34);ctx.fillText('ONLINE MATCH',810,34);
  }
  function drawPlayer(p, time) {
    const isMe=p.id===myId;
    const x=p.sx,y=p.sy;
    // Player movement shadow + selected halo
    circle(x+2,y+10,19,'#03130da6');
    if(isMe){circle(x,y,26,'#32d6b020','#32d6b0',3);}
    const hue=COLORS[p.team];
    const gradient=ctx.createRadialGradient(x-7,y-8,2,x,y,19);
    gradient.addColorStop(0,p.team===0?'#e0f4ff':'#ffe8ed');
    gradient.addColorStop(.15,hue); gradient.addColorStop(1,DARK_COLORS[p.team]);
    circle(x,y,17,gradient,'#f6fffb',2.3);
    // Kit stripe
    ctx.save();ctx.translate(x,y);ctx.rotate(-.22);
    rr(-3,-13,6,26,2,'#f8fff9a6');ctx.restore();
    circle(x,y,5,p.team===0?'#1b3460':'#6f1836');
    ctx.font='900 11px DM Sans,sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff';
    ctx.fillText(String((p.slot??1)+1),x,y+4);
    if(isMe){circle(x,y-30,5,'#32d6b0');line(x,y-38,x,y-44,'#32d6b0',2);}
    if(!p.bot || isMe){
      const label=p.name.length>12?p.name.slice(0,11)+'…':p.name;
      ctx.font='800 12px DM Sans,sans-serif';const measure=ctx.measureText(label).width;
      rr(x-measure/2-8,y-55,measure+16,17,4,isMe?'#32d6b0':'#07180ecf');
      ctx.fillStyle=isMe?'#06352e':'#f5fff7';ctx.fillText(label,x,y-42);
    }
    if(isMe){
      const sw=38;rr(x-sw/2,y+27,sw,4,2,'#001c16','#4a8a55',1);
      rr(x-sw/2+1,y+28,(sw-2)*p.stamina/100,2,1,'#32d6b0');
    }
  }
  function drawBall(ball,time){
    if(!ball)return;
    const x=ball.x,y=ball.y;
    circle(x+4,y+7,12,'#020c0869');
    const g=ctx.createRadialGradient(x-5,y-6,0,x,y,12);
    g.addColorStop(0,'#fff');g.addColorStop(.72,'#e6f6e8');g.addColorStop(1,'#879c8b');
    circle(x,y,11,g,'#a8b9ae',1.5);
    const angle=time*.001+Math.atan2(ball.vy,ball.vx);
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);
    ctx.fillStyle='#15251b';ctx.beginPath();
    for(let j=0;j<5;j++){
      const a=j*Math.PI*2/5-Math.PI/2;
      const px=Math.cos(a)*5.8,py=Math.sin(a)*5.8;
      if(j===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    ctx.closePath();ctx.fill();
    for(let j=0;j<5;j++){
      const a=j*Math.PI*2/5-Math.PI/2;
      circle(Math.cos(a)*9,Math.sin(a)*9,1.4,'#21352a');
    }
    ctx.restore();
    const sp=Math.hypot(ball.vx,ball.vy);
    if(sp>160){
      const n=Math.min(4,Math.floor(sp/130));
      for(let i=1;i<=n;i++) circle(x-ball.vx/sp*i*11,y-ball.vy/sp*i*11,Math.max(1,5-i),'#e5fff542');
    }
  }
  function addNewParticles(events){
    for(const e of events){
      if(e.type!=='kick')continue;
      for(let i=0;i<12;i++){
        const a=Math.PI*2*i/12,sp=55+Math.random()*130;
        sparks.push({x:e.x,y:e.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,t:0,life:.35+Math.random()*.25,color:COLORS[e.team]});
      }
    }
  }
  function drawParticles(dt){
    for(let i=sparks.length-1;i>=0;i--){
      const s=sparks[i];s.t+=dt;if(s.t>s.life){sparks.splice(i,1);continue;}
      s.x+=s.vx*dt;s.y+=s.vy*dt;s.vx*=.94;s.vy*=.94;
      ctx.globalAlpha=Math.max(0,1-s.t/s.life);
      circle(s.x,s.y,2.2,s.color);
    }ctx.globalAlpha=1;
  }
  function render(now){
    const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;frameClock+=dt;
    if(mode==='game'){
      ctx.clearRect(0,0,W,H);drawPitch(now);
      if(world){
        const ids=new Set();
        for(const p of world.players){
          ids.add(p.id);
          let v=smoothPlayers.get(p.id);
          if(!v){v={sx:p.x,sy:p.y,...p};smoothPlayers.set(p.id,v);}
          v.sx+=(p.x-v.sx)*Math.min(1,dt*13);
          v.sy+=(p.y-v.sy)*Math.min(1,dt*13);
          Object.assign(v,{name:p.name,id:p.id,team:p.team,bot:p.bot,stamina:p.stamina});
          v.slot=p.slot;
          drawPlayer(v,now);
        }
        for(const id of smoothPlayers.keys())if(!ids.has(id))smoothPlayers.delete(id);
        if(!render.previousBall) render.previousBall={...world.ball};
        const ball=render.previousBall;
        if (Math.hypot(world.ball.x-ball.x,world.ball.y-ball.y)>180) {ball.x=world.ball.x;ball.y=world.ball.y;}
        else {ball.x+=(world.ball.x-ball.x)*Math.min(1,dt*18);ball.y+=(world.ball.y-ball.y)*Math.min(1,dt*18);}
        ball.vx=world.ball.vx;ball.vy=world.ball.vy;
        // Ball controller aura + shooting direction when in possession.
        const holder=world.players.find(p=>p.id===world.ball.ownerId);
        if(holder){
          const v=smoothPlayers.get(holder.id);
          if(v){circle(v.sx,v.sy,22,null,holder.id===myId?'#32d6b0b0':'#ffffff50',1.6);}
        }
        if(world.ball.ownerId===myId){
          const a=currentAim();const n=normalizedClient(a.ax,a.ay);const x=ball.x,y=ball.y;
          ctx.beginPath();ctx.moveTo(x+n.x*20,y+n.y*20);ctx.lineTo(x+n.x*77,y+n.y*77);
          ctx.strokeStyle='#32d6b0c0';ctx.lineWidth=3;ctx.setLineDash([7,7]);ctx.stroke();ctx.setLineDash([]);
        }
        drawBall(ball,now);
        drawParticles(dt);
        if(world.freeze>0){
          ctx.fillStyle='#ffffffa0';ctx.font='900 20px DM Sans,sans-serif';ctx.textAlign='center';
          ctx.fillText('ANSTOSS',W/2,140);
        }
      }else{
        ctx.fillStyle='#f6fff8';ctx.textAlign='center';ctx.font='900 28px DM Sans,sans-serif';ctx.fillText('SPIELFELD WIRD GELADEN ...',W/2,H/2);
      }
    } else render.previousBall=null;
    requestAnimationFrame(render);
  }
  connectionUI(false);
  connect();
  requestAnimationFrame(render);
})();
