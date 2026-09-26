/* =========================================================================
   HEIST: SHADOW RUN
   Vanilla JS / Canvas game. No frameworks, no build step, no network calls.

   IMPORTANT HONESTY NOTE (see section on "no fake AI claim"):
   The police "AI" here is NOT machine learning. It is a lightweight,
   fully deterministic JavaScript system that tallies simple statistics
   about how the player has been moving during the CURRENT run (which
   zones they linger in, which direction they favor, which hideout they
   reuse, how often they sprint or get spotted) and feeds those numbers
   back into the police unit's patrol targeting, vision range, speed and
   search bias. That's it — no neural nets, no external services, no
   persistence of behavior across runs. Everything resets each heist.
   ========================================================================= */

(() => {
'use strict';

/* ============================================================
   0. STORAGE
   ============================================================ */
const STORAGE_KEY = 'heistShadowRun_v1';

function defaultData(){
  return {
    settings: { sound:true, shake:true, reducedMotion:false },
    stats: { totalRuns:0, wins:0, bestEscapeTime:null },
    leaderboard: [],
    tutorialDone: false
  };
}
function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultData(), parsed, {
      settings: Object.assign(defaultData().settings, parsed.settings||{}),
      stats: Object.assign(defaultData().stats, parsed.stats||{}),
      leaderboard: Array.isArray(parsed.leaderboard) ? parsed.leaderboard : []
    });
  }catch(e){ return defaultData(); }
}
function saveData(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVE)); }catch(e){ /* storage unavailable - fail silently */ }
}
let SAVE = loadData();

/* ============================================================
   1. AUDIO (Web Audio API, generated tones only)
   ============================================================ */
const Audio_ = (() => {
  let ctx = null;
  function ensureCtx(){
    if(!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC) ctx = new AC();
    }
    if(ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type='sine', vol=0.06, delay=0){
    if(!SAVE.settings.sound) return;
    const c = ensureCtx();
    if(!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  return {
    unlock(){ ensureCtx(); },
    click(){ tone(520, 0.08, 'square', 0.04); },
    pickup(){ tone(700, 0.09, 'sine', 0.07); tone(980, 0.12, 'sine', 0.06, 0.06); },
    alertUp(){ tone(220, 0.18, 'sawtooth', 0.045); },
    detect(){ tone(140, 0.35, 'square', 0.07); tone(100, 0.4, 'square', 0.06, 0.08); },
    hide(){ tone(340, 0.12, 'sine', 0.05); },
    distract(){ tone(880, 0.06, 'triangle', 0.06); tone(440, 0.1, 'triangle', 0.05, 0.05); },
    win(){ [523,659,784,1047].forEach((f,i)=>tone(f,0.35,'sine',0.07,i*0.12)); },
    lose(){ [300,240,180,120].forEach((f,i)=>tone(f,0.4,'sawtooth',0.06,i*0.13)); }
  };
})();

/* ============================================================
   2. GEOMETRY / MATH HELPERS
   ============================================================ */
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function lerp(a,b,t){ return a + (b - a) * t; }
function dist(x1,y1,x2,y2){ return Math.hypot(x2-x1, y2-y1); }
function angleTo(x1,y1,x2,y2){ return Math.atan2(y2-y1, x2-x1); }
function normalizeAngle(a){ while(a > Math.PI) a -= Math.PI*2; while(a < -Math.PI) a += Math.PI*2; return a; }
function angleDiff(a,b){ return normalizeAngle(b - a); }
function pointInRect(px,py,r){ return px>=r.x && px<=r.x+r.w && py>=r.y && py<=r.y+r.h; }
function fmtTime(sec){
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec/60), s = sec%60;
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}
function fmtMoney(v){ return '$' + Math.round(v).toLocaleString('en-US'); }

function hasLineOfSight(x1,y1,x2,y2, walls){
  const d = dist(x1,y1,x2,y2);
  const steps = Math.max(2, Math.floor(d/16));
  for(let i=1;i<steps;i++){
    const t = i/steps;
    const px = lerp(x1,x2,t), py = lerp(y1,y2,t);
    for(const w of walls){ if(pointInRect(px,py,w)) return false; }
  }
  return true;
}
function resolveCircleRect(entity, rect){
  const closestX = clamp(entity.x, rect.x, rect.x+rect.w);
  const closestY = clamp(entity.y, rect.y, rect.y+rect.h);
  const dx = entity.x - closestX, dy = entity.y - closestY;
  const distSq = dx*dx + dy*dy;
  if(distSq < entity.radius*entity.radius){
    const d = Math.sqrt(distSq) || 0.0001;
    const overlap = entity.radius - d;
    entity.x += (dx/d) * overlap;
    entity.y += (dy/d) * overlap;
  }
}

/* ============================================================
   3. WORLD / MAP DATA
   ============================================================ */
const WORLD_W = 1000, WORLD_H = 700;

const WALLS = [
  {x:100,y:70, w:150,h:120}, {x:300,y:50, w:120,h:100}, {x:500,y:80, w:180,h:130},
  {x:750,y:60, w:150,h:110}, {x:110,y:290,w:140,h:100}, {x:340,y:270,w:150,h:120},
  {x:590,y:290,w:160,h:100}, {x:790,y:270,w:140,h:130}, {x:140,y:490,w:160,h:100},
  {x:390,y:510,w:180,h:100}, {x:640,y:490,w:150,h:110}
];

const HIDE_ZONES = [
  {x:255,y:200,w:44,h:44,name:'Alley Nook'},
  {x:685,y:215,w:44,h:44,name:'Loading Dock'},
  {x:225,y:420,w:44,h:44,name:'Dumpster Row'},
  {x:575,y:440,w:44,h:44,name:'Service Alcove'}
];

const CAMERAS = [
  {x:420,y:35, baseAngle: Math.PI/2, range:145, halfAngle:0.48, oscSpeed:0.6, oscAmp:0.85},
  {x:800,y:210, baseAngle: Math.PI,   range:145, halfAngle:0.48, oscSpeed:0.5, oscAmp:0.8},
  {x:280,y:345, baseAngle: 0,          range:145, halfAngle:0.48, oscSpeed:0.7, oscAmp:0.85},
  {x:520,y:615, baseAngle: -Math.PI/2, range:145, halfAngle:0.48, oscSpeed:0.55,oscAmp:0.75}
];

const LOOT_DEFS = [
  {id:'l1', x:210,y:210, value:1200, icon:'\u{1F48E}', name:'Diamond'},
  {id:'l2', x:470,y:225, value:900,  icon:'\u{1F4BB}', name:'Data Drive'},
  {id:'l3', x:735,y:210, value:1500, icon:'\u{1F4B0}', name:'Cash Stack'},
  {id:'l4', x:290,y:460, value:800,  icon:'\u{1F3A8}', name:'Artifact'},
  {id:'l5', x:530,y:455, value:1600, icon:'\u{1F48E}', name:'Diamond'},
  {id:'l6', x:870,y:445, value:1000, icon:'\u{1F4B0}', name:'Cash Stack'}
];

const EXTRACTION = {x:26,y:26,w:82,h:72};
const SAFE_ZONE  = {x:0,y:585,w:175,h:115};
const PLAYER_SPAWN = {x:62,y:645};
const POLICE_STATION = {x:905,y:625};

const PATROL_WAYPOINTS = [
  {x:60,y:210},{x:270,y:55},{x:470,y:35},{x:700,y:215},{x:930,y:55},
  {x:60,y:400},{x:270,y:400},{x:500,y:405},{x:760,y:410},{x:930,y:430},
  {x:270,y:645},{x:500,y:655},{x:760,y:640},{x:930,y:225}
];

// zone grid: 4 columns x 3 rows = 12 zones, used for behavior tracking
const ZONE_COLS = 4, ZONE_ROWS = 3;
function zoneIndex(x,y){
  const col = clamp(Math.floor(x / (WORLD_W/ZONE_COLS)), 0, ZONE_COLS-1);
  const row = clamp(Math.floor(y / (WORLD_H/ZONE_ROWS)), 0, ZONE_ROWS-1);
  return row*ZONE_COLS + col;
}
function zoneLabel(idx){ return 'SECTOR ' + String(idx+1).padStart(2,'0'); }

/* ============================================================
   4. GAME MODES
   ============================================================ */
const MODES = {
  classic:  { key:'classic',  label:'CLASSIC HEIST', target:5000, time:480, units:2, learnMult:0.70, learnLabel:'MILD' },
  aihunt:   { key:'aihunt',   label:'AI HUNT',        target:5000, time:360, units:3, learnMult:1.15, learnLabel:'STANDARD' },
  timerush: { key:'timerush', label:'TIME RUSH',      target:3500, time:180, units:3, learnMult:1.35, learnLabel:'FAST' }
};

/* ============================================================
   5. TUTORIAL CONTENT
   ============================================================ */
const TUTORIAL_STEPS = [
  { icon:'\u{1F3AE}', title:'Move',      body:'Use WASD or the Arrow Keys to move through the city. On mobile, drag the stick in the bottom-left.' },
  { icon:'\u{1F4B0}', title:'Collect Loot', body:'Walk onto a loot marker to grab it automatically. You need to hit the loot target before you can escape.' },
  { icon:'\u{1F4F7}', title:'Avoid Cameras', body:'Rotating security cameras sweep a cone of vision. Cross gaps when the cone is looking away.' },
  { icon:'\u{1F648}', title:'Hide',       body:'Press E (or tap HIDE) inside an alley/dumpster zone to drop off the radar. Leaving the zone ends hiding automatically.' },
  { icon:'\u{1F3AF}', title:'Distract',   body:'Press Q (or tap DISTRACT) to throw a diversion that pulls nearby patrols away from you. It has a cooldown.' },
  { icon:'\u{1F3C1}', title:'Escape',     body:'Once you\'ve hit the loot target, get to the glowing green zone and press F (or tap ESCAPE) to complete the heist.' },
  { icon:'\u{1F9E0}', title:'The Police Learns', body:'This is the whole game: repeat a route, a hideout, or a direction too often and the AI ADAPTATION meter climbs. Predictable players get hunted.' }
];

/* ============================================================
   6. RADIO MESSAGES
   ============================================================ */
const Radio = (() => {
  let lastTime = -999;
  const MIN_GAP = 4.2;
  function push(text, force){
    const now = performance.now()/1000;
    if(!force && now - lastTime < MIN_GAP) return;
    lastTime = now;
    const el = document.getElementById('radioTicker');
    const div = document.createElement('div');
    div.className = 'radio-msg';
    div.textContent = text;
    el.appendChild(div);
    while(el.children.length > 2) el.removeChild(el.firstChild);
    setTimeout(()=>{ if(div.parentNode) div.parentNode.removeChild(div); }, 4200);
  }
  return { push };
})();

function notify(text, kind){
  const el = document.getElementById('notificationStack');
  const div = document.createElement('div');
  div.className = 'notify-toast' + (kind === 'loot' ? ' notify-loot' : kind === 'warn' ? ' notify-warn' : '');
  div.textContent = text;
  el.appendChild(div);
  while(el.children.length > 4) el.removeChild(el.firstChild);
  setTimeout(()=>{ if(div.parentNode) div.parentNode.removeChild(div); }, 2600);
}

/* ============================================================
   7. GAME STATE (rebuilt fresh every run)
   ============================================================ */
let G = null; // active game state object, created by startGame()

function makeBehaviorTracker(){
  return {
    zoneTime: new Array(ZONE_COLS*ZONE_ROWS).fill(0),
    dirTime: { up:0, down:0, left:0, right:0 },
    hideUsage: [0,0,0,0],
    sprintTime: 0, moveTime: 0,
    alarmEvents: 0, ticks: 0,
    lastKnownPos: null,
    distractionUses: 0, successfulDistractions: 0,
    cameraHits: 0, chaseEvents: 0,
    distanceTraveled: 0
  };
}

function computeAdaptation(tr, elapsed, modeDuration, learnMult){
  const timeRamp = clamp(elapsed / (modeDuration*0.72), 0, 1) * 52;
  const totalZone = tr.zoneTime.reduce((a,b)=>a+b, 0);
  const topZone = Math.max(...tr.zoneTime);
  const patternStrength = totalZone > 14 ? (topZone/totalZone) * 26 : (topZone/Math.max(1,totalZone)) * 10;
  const dirVals = Object.values(tr.dirTime);
  const totalDir = dirVals.reduce((a,b)=>a+b, 0);
  const topDir = Math.max(...dirVals);
  const dirStrength = totalDir > 8 ? (topDir/totalDir) * 22 : 0;
  const raw = (timeRamp + patternStrength + dirStrength) * learnMult;
  return clamp(raw, 0, 100);
}
function adaptationStage(a){
  if(a <= 25) return 'OBSERVING';
  if(a <= 50) return 'LEARNING';
  if(a <= 75) return 'PREDICTING';
  return 'HUNTING';
}
function topZoneIdx(tr){
  let best = 0;
  for(let i=1;i<tr.zoneTime.length;i++) if(tr.zoneTime[i] > tr.zoneTime[best]) best = i;
  return best;
}
function topHideZone(tr){
  let best = -1, bestVal = 0;
  for(let i=0;i<tr.hideUsage.length;i++){ if(tr.hideUsage[i] > bestVal){ bestVal = tr.hideUsage[i]; best = i; } }
  return bestVal > 0 ? best : -1;
}
function topDirection(tr){
  let best = 'left', bv = -1;
  for(const k in tr.dirTime){ if(tr.dirTime[k] > bv){ bv = tr.dirTime[k]; best = k; } }
  return best;
}

/* ---- Player ---- */
function makePlayer(){
  return {
    x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, radius: 12,
    baseSpeed: 158, sprintMult: 1.65,
    vx:0, vy:0, facing:{x:0,y:-1},
    stamina:100, health:100,
    hidden:false, hideZoneIdx:-1,
    sprinting:false, arrestTimer:0,
    lastX: PLAYER_SPAWN.x, lastY: PLAYER_SPAWN.y
  };
}

/* ---- Police unit ---- */
function makePolice(id, spawn){
  return {
    id, x:spawn.x, y:spawn.y, radius:12,
    baseSpeed:96, speed:96,
    baseVision:145, vision:145,
    baseHalfCone:0.56, halfCone:0.56,
    facingAngle: -Math.PI/2,
    state:'patrol', // patrol | suspicious | investigate | chase | search
    stateTimer:0,
    targetPoint:null,
    lastSeenPlayer:null
  };
}

/* ============================================================
   8. STARTING / ENDING A RUN
   ============================================================ */
function startGame(modeKey){
  const mode = MODES[modeKey];
  const units = [];
  for(let i=0;i<mode.units;i++){
    const spread = i*30 - (mode.units-1)*15;
    units.push(makePolice(i, {x: POLICE_STATION.x + spread, y: POLICE_STATION.y}));
  }
  G = {
    mode,
    player: makePlayer(),
    police: units,
    loot: LOOT_DEFS.map(l => ({...l, collected:false, animT:0})),
    lootCollected: 0,
    tracker: makeBehaviorTracker(),
    distraction: null, // {x,y,life}
    distractCooldown: 0,
    alert: 0, // 0-100
    elapsed: 0,
    timeLeft: mode.time,
    paused: false,
    running: true,
    ended: false,
    shakeT: 0,
    keys: {},
    joystick: {active:false, dx:0, dy:0, strength:0},
    inputAbility: { hidePressed:false, distractPressed:false, escapePressed:false }
  };

  document.getElementById('lootTarget').textContent = fmtMoney(mode.target);
  document.getElementById('hudModeLabel').textContent = mode.label;
  document.getElementById('hudObjective').textContent = `Collect ${fmtMoney(mode.target)}, then reach extraction.`;
  document.getElementById('btnEscapeAction').classList.add('hidden');
  document.getElementById('mEscape').classList.add('hidden');
  document.getElementById('radioTicker').innerHTML = '';
  document.getElementById('notificationStack').innerHTML = '';

  showScreen('game-screen');
  resizeCanvas();
  Radio.push('POLICE NETWORK: "All units, standard patrol."', true);

  if(!rafRunning){ rafRunning = true; lastFrameTime = performance.now(); requestAnimationFrame(loop); }
}

function endGame(result, extra){
  if(!G || G.ended) return;
  G.ended = true;
  G.running = false;

  const tr = G.tracker;
  const adaptation = computeAdaptation(tr, G.elapsed, G.mode.time, G.mode.learnMult);
  SAVE.stats.totalRuns++;

  if(result === 'win'){
    SAVE.stats.wins++;
    if(SAVE.stats.bestEscapeTime === null || G.elapsed < SAVE.stats.bestEscapeTime){
      SAVE.stats.bestEscapeTime = G.elapsed;
    }
    // route efficiency: ideal straight-line path vs actual distance travelled
    let ideal = dist(PLAYER_SPAWN.x, PLAYER_SPAWN.y, G.player.x, G.player.y);
    const collectedLoot = G.loot.filter(l=>l.collected);
    let cx = PLAYER_SPAWN.x, cy = PLAYER_SPAWN.y;
    ideal = 0;
    for(const l of collectedLoot){ ideal += dist(cx,cy,l.x,l.y); cx=l.x; cy=l.y; }
    ideal += dist(cx,cy, EXTRACTION.x+EXTRACTION.w/2, EXTRACTION.y+EXTRACTION.h/2);
    const traveled = Math.max(ideal, tr.distanceTraveled);
    const efficiency = clamp(Math.round((ideal / Math.max(1,traveled)) * 100), 0, 100);

    const baseLoot = G.lootCollected;
    const escapeBonus = Math.max(0, (G.mode.time - G.elapsed)) * 5;
    const stealthBonus = (100 - G.alert) * 10;
    const speedBonus = efficiency * 8;
    const distractionBonus = tr.successfulDistractions * 120;
    const alertPenalty = G.alert * 6;
    const detectionPenalty = tr.cameraHits * 40 + tr.chaseEvents * 70;
    const score = Math.max(0, Math.round(baseLoot*0.4 + escapeBonus + stealthBonus + speedBonus + distractionBonus - alertPenalty - detectionPenalty));

    let rating = 'C';
    if(score >= 4200) rating = 'S';
    else if(score >= 3000) rating = 'A';
    else if(score >= 1800) rating = 'B';

    SAVE.leaderboard.push({ mode:G.mode.label, score, loot:baseLoot, date:new Date().toLocaleDateString() });
    SAVE.leaderboard.sort((a,b)=>b.score-a.score);
    SAVE.leaderboard = SAVE.leaderboard.slice(0,10);
    saveData();

    document.getElementById('winRating').textContent = rating;
    document.getElementById('winLootTotal').textContent = fmtMoney(baseLoot) + ' STOLEN';
    document.getElementById('winEscapeTime').textContent = fmtTime(G.elapsed);
    document.getElementById('winAlert').textContent = Math.round(G.alert) + '%';
    document.getElementById('winAdapt').textContent = Math.round(adaptation) + '%';
    document.getElementById('winEfficiency').textContent = efficiency + '%';
    Audio_.win();
    showScreen('win-screen');
  } else {
    saveData();
    const reasons = {
      caught: '"You were caught."',
      timeout: '"Time ran out before you could get clear."'
    };
    document.getElementById('loseReason').textContent = reasons[extra] || reasons.caught;
    document.getElementById('loseSurvived').textContent = fmtTime(G.elapsed);
    document.getElementById('loseLoot').textContent = fmtMoney(G.lootCollected);
    document.getElementById('loseAdapt').textContent = Math.round(adaptation) + '%';
    document.getElementById('loseResponse').textContent = adaptationStage(adaptation);
    Audio_.lose();
    showScreen('lose-screen');
  }
}

/* ============================================================
   9. UPDATE LOOP
   ============================================================ */
let lastFrameTime = 0;
let rafRunning = false;

function loop(now){
  if(!G || !G.running){ rafRunning = false; return; }
  let dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  dt = Math.min(dt, 0.05); // clamp to avoid huge steps on tab switch

  if(!G.paused && !G.ended){
    update(dt);
  }
  render();
  requestAnimationFrame(loop);
}

function currentMoveVector(){
  const k = G.keys;
  let mx = 0, my = 0;
  if(k['w']||k['arrowup']) my -= 1;
  if(k['s']||k['arrowdown']) my += 1;
  if(k['a']||k['arrowleft']) mx -= 1;
  if(k['d']||k['arrowright']) mx += 1;
  if(mx !== 0 || my !== 0){
    const len = Math.hypot(mx,my) || 1;
    return { x: mx/len, y: my/len, strength: 1 };
  }
  if(G.joystick.active && G.joystick.strength > 0.05){
    return { x:G.joystick.dx, y:G.joystick.dy, strength:G.joystick.strength };
  }
  return { x:0, y:0, strength:0 };
}

function update(dt){
  G.elapsed += dt;
  G.timeLeft = Math.max(0, G.mode.time - G.elapsed);
  if(G.shakeT > 0) G.shakeT = Math.max(0, G.shakeT - dt);

  updatePlayer(dt);
  updateCameras(dt);
  updatePolice(dt);
  updateDistraction(dt);
  updateAlert(dt);
  updateTracker(dt);
  updateLoot();
  updateArrest(dt);
  updateHudDom();

  if(G.timeLeft <= 0 && !G.ended){ endGame('lose', 'timeout'); }
}

function updatePlayer(dt){
  const p = G.player;
  const mv = currentMoveVector();
  const wantsSprint = (G.keys['shift'] || G.inputAbility.sprintHold) && p.stamina > 1 && mv.strength > 0;
  p.sprinting = wantsSprint;

  let speed = p.baseSpeed * (wantsSprint ? p.sprintMult : 1) * (0.4 + 0.6*mv.strength);
  if(p.hidden) speed *= 0.85;

  p.lastX = p.x; p.lastY = p.y;
  p.x += mv.x * speed * dt;
  p.y += mv.y * speed * dt;
  p.x = clamp(p.x, p.radius, WORLD_W - p.radius);
  p.y = clamp(p.y, p.radius, WORLD_H - p.radius);
  for(const w of WALLS) resolveCircleRect(p, w);

  if(mv.strength > 0){ p.facing.x = mv.x; p.facing.y = mv.y; }

  if(wantsSprint){ p.stamina = clamp(p.stamina - 34*dt, 0, 100); }
  else{ p.stamina = clamp(p.stamina + 16*dt, 0, 100); }

  // hiding
  const inHideZone = HIDE_ZONES.findIndex(z => pointInRect(p.x,p.y,z));
  if(G.inputAbility.hidePressed){
    if(!p.hidden && inHideZone >= 0){
      p.hidden = true; p.hideZoneIdx = inHideZone;
      Audio_.hide();
      notify('Hidden — ' + HIDE_ZONES[inHideZone].name, null);
      G.tracker.hideUsage[inHideZone]++;
    } else if(p.hidden){
      p.hidden = false; p.hideZoneIdx = -1;
    }
    G.inputAbility.hidePressed = false;
  }
  if(p.hidden && inHideZone < 0){ p.hidden = false; p.hideZoneIdx = -1; }

  // distraction trigger
  if(G.inputAbility.distractPressed){
    G.inputAbility.distractPressed = false;
    if(G.distractCooldown <= 0){
      const dx = p.facing.x || 0, dy = p.facing.y || -1;
      let tx = clamp(p.x + dx*130, 20, WORLD_W-20);
      let ty = clamp(p.y + dy*130, 20, WORLD_H-20);
      G.distraction = { x:tx, y:ty, life:6 };
      G.distractCooldown = 8;
      G.tracker.distractionUses++;
      const nearby = G.police.filter(u => dist(u.x,u.y,p.x,p.y) < 300).length;
      if(nearby > 0) G.tracker.successfulDistractions++;
      Audio_.distract();
      notify('Diversion thrown', null);
      Radio.push('POLICE NETWORK: "Disturbance reported, investigating."');
    }
  }
  if(G.distractCooldown > 0) G.distractCooldown = Math.max(0, G.distractCooldown - dt);

  // escape trigger
  const inExtraction = pointInRect(p.x,p.y, EXTRACTION);
  const canEscape = inExtraction && G.lootCollected >= G.mode.target;
  document.getElementById('btnEscapeAction').classList.toggle('hidden', !canEscape);
  document.getElementById('mEscape').classList.toggle('hidden', !canEscape);
  if(canEscape && G.inputAbility.escapePressed){
    G.inputAbility.escapePressed = false;
    endGame('win');
  } else {
    G.inputAbility.escapePressed = false;
  }

  // distance traveled (for route efficiency)
  G.tracker.distanceTraveled += dist(p.lastX,p.lastY,p.x,p.y);
}

function updateCameras(dt){
  G.camAngles = G.camAngles || CAMERAS.map(c => c.baseAngle);
  const p = G.player;
  const t = G.elapsed;
  G.camDetecting = G.camDetecting || CAMERAS.map(()=>false);

  CAMERAS.forEach((c, i) => {
    const angle = c.baseAngle + Math.sin(t * c.oscSpeed + i*1.3) * c.oscAmp;
    G.camAngles[i] = angle;
    let detecting = false;
    if(!p.hidden){
      const d = dist(c.x,c.y,p.x,p.y);
      if(d < c.range){
        const ang = angleTo(c.x,c.y,p.x,p.y);
        if(Math.abs(angleDiff(angle, ang)) < c.halfAngle && hasLineOfSight(c.x,c.y,p.x,p.y,WALLS)){
          detecting = true;
        }
      }
    }
    if(detecting && !G.camDetecting[i]){
      G.alert = clamp(G.alert + 14, 0, 100);
      G.tracker.alarmEvents++;
      G.tracker.cameraHits++;
      G.tracker.lastKnownPos = {x:p.x, y:p.y};
      Audio_.alertUp();
      Radio.push('POLICE NETWORK: "Camera flag — ' + zoneLabel(zoneIndex(p.x,p.y)) + '."');
    }
    if(detecting){
      G.alert = clamp(G.alert + 22*dt, 0, 100);
      G.tracker.lastKnownPos = {x:p.x, y:p.y};
    }
    G.camDetecting[i] = detecting;
  });
}

function pickPatrolTarget(unit, tr, adaptation){
  const bias = clamp(0.15 + (adaptation/100) * 0.65, 0, 0.8);
  if(Math.random() < bias){
    const tz = topZoneIdx(tr);
    // pick the patrol waypoint closest to the frequently-visited zone
    let best = PATROL_WAYPOINTS[0], bd = Infinity;
    for(const wp of PATROL_WAYPOINTS){
      if(zoneIndex(wp.x,wp.y) === tz){
        const d = dist(unit.x,unit.y,wp.x,wp.y);
        if(d < bd){ bd = d; best = wp; }
      }
    }
    if(bd !== Infinity) return best;
  }
  return PATROL_WAYPOINTS[Math.floor(Math.random()*PATROL_WAYPOINTS.length)];
}

function updatePolice(dt){
  const p = G.player;
  const tr = G.tracker;
  const adaptation = computeAdaptation(tr, G.elapsed, G.mode.time, G.mode.learnMult);
  G.adaptation = adaptation;
  const stage = adaptationStage(adaptation);
  if(G.lastStage && G.lastStage !== stage){
    if(stage === 'LEARNING') Radio.push('AI SYSTEM: "Building a behavior profile on the suspect."', true);
    else if(stage === 'PREDICTING') Radio.push('AI SYSTEM: "Predicting likely escape route."', true);
    else if(stage === 'HUNTING') Radio.push('AI SYSTEM: "Pattern locked. Deploying targeted patrols."', true);
  }
  G.lastStage = stage;

  const t = adaptation/100;
  const predictBias = stage === 'PREDICTING' || stage === 'HUNTING';

  for(const u of G.police){
    u.vision = u.baseVision * (1 + 0.35*t);
    u.halfCone = u.baseHalfCone * (1 + 0.12*t);
    u.speed = u.baseSpeed * (1 + 0.28*t);
    u.stateTimer -= dt;

    // --- perception ---
    const d = dist(u.x,u.y,p.x,p.y);
    const ang = angleTo(u.x,u.y,p.x,p.y);
    const inCone = Math.abs(angleDiff(u.facingAngle, ang)) < u.halfCone;
    const canSee = !p.hidden && d < u.vision && inCone && hasLineOfSight(u.x,u.y,p.x,p.y,WALLS);
    const hearsNoise = !p.hidden && p.sprinting && d < 95;
    const closeProximity = !p.hidden && d < 55;

    if(canSee || hearsNoise || closeProximity){
      if(u.state !== 'chase'){
        if(u.state !== 'suspicious' && u.state !== 'investigate'){
          Radio.push('POLICE NETWORK: "Suspect spotted near ' + zoneLabel(zoneIndex(p.x,p.y)) + '."');
        }
        if(canSee){
          if(u.state !== 'chase'){ tr.chaseEvents++; Audio_.detect(); G.shakeIntent = true; }
          u.state = 'chase'; u.stateTimer = 0.4;
        } else if(u.state === 'patrol'){
          u.state = 'suspicious'; u.stateTimer = 1.4;
        }
      } else {
        u.stateTimer = 0.4;
      }
      tr.lastKnownPos = {x:p.x,y:p.y};
      G.alert = clamp(G.alert + (canSee ? 26 : 8) * dt, 0, 100);
    }

    // --- state machine movement ---
    if(u.state === 'patrol'){
      if(!u.targetPoint || dist(u.x,u.y,u.targetPoint.x,u.targetPoint.y) < 18){
        u.targetPoint = pickPatrolTarget(u, tr, adaptation);
      }
      moveToward(u, u.targetPoint, u.speed*0.55, dt);
    } else if(u.state === 'suspicious'){
      if(u.stateTimer <= 0){ u.state = 'patrol'; }
      else { u.facingAngle = lerp(u.facingAngle, ang, 0.08); }
    } else if(u.state === 'investigate'){
      if(u.targetPoint) moveToward(u, u.targetPoint, u.speed*0.85, dt);
      if(u.stateTimer <= 0 || (u.targetPoint && dist(u.x,u.y,u.targetPoint.x,u.targetPoint.y) < 20)){
        u.state = 'search'; u.stateTimer = 2.2; u.targetPoint = tr.lastKnownPos || u.targetPoint;
      }
    } else if(u.state === 'chase'){
      moveToward(u, {x:p.x,y:p.y}, u.speed, dt);
      if(u.stateTimer <= 0){
        u.state = 'search';
        u.stateTimer = 3 + t*2;
        u.targetPoint = tr.lastKnownPos || {x:p.x,y:p.y};
        if(predictBias){
          const dir = topDirection(tr);
          const vecs = {up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0}};
          const v = vecs[dir];
          const lookahead = 130 + t*110;
          u.predictedPoint = {
            x: clamp((tr.lastKnownPos?tr.lastKnownPos.x:p.x) + v.x*lookahead, 20, WORLD_W-20),
            y: clamp((tr.lastKnownPos?tr.lastKnownPos.y:p.y) + v.y*lookahead, 20, WORLD_H-20)
          };
        } else { u.predictedPoint = null; }
      }
    } else if(u.state === 'search'){
      const useHideBias = predictBias && Math.random() < 0.35;
      if(!u.targetPoint || (u.stateTimer <= 0)){
        if(useHideBias && topHideZone(tr) >= 0){
          const hz = HIDE_ZONES[topHideZone(tr)];
          u.targetPoint = {x:hz.x+hz.w/2, y:hz.y+hz.h/2};
          Radio.push('AI SYSTEM: "Known hideout — checking it directly."');
        } else if(u.predictedPoint){
          u.targetPoint = u.predictedPoint; u.predictedPoint = null;
        } else {
          u.state = 'patrol'; u.targetPoint = null;
        }
        u.stateTimer = 3.5;
      }
      if(u.targetPoint){
        moveToward(u, u.targetPoint, u.speed*0.8, dt);
        if(dist(u.x,u.y,u.targetPoint.x,u.targetPoint.y) < 20 && u.stateTimer > 0){ u.stateTimer = Math.min(u.stateTimer, 0.4); }
      }
      if(u.stateTimer <= -3){ u.state = 'patrol'; u.targetPoint = null; }
    }

    for(const w of WALLS) resolveCircleRect(u, w);
    u.x = clamp(u.x, u.radius, WORLD_W-u.radius);
    u.y = clamp(u.y, u.radius, WORLD_H-u.radius);
  }

  // distraction pulls in patrol/suspicious/search units
  if(G.distraction){
    for(const u of G.police){
      if((u.state === 'patrol' || u.state === 'suspicious') && dist(u.x,u.y,G.distraction.x,G.distraction.y) < 420){
        u.state = 'investigate'; u.targetPoint = {x:G.distraction.x, y:G.distraction.y}; u.stateTimer = 4.5;
      }
    }
  }
}

function moveToward(unit, target, speed, dt){
  const a = angleTo(unit.x,unit.y,target.x,target.y);
  unit.facingAngle = a;
  unit.x += Math.cos(a) * speed * dt;
  unit.y += Math.sin(a) * speed * dt;
}

function updateDistraction(dt){
  if(G.distraction){
    G.distraction.life -= dt;
    if(G.distraction.life <= 0) G.distraction = null;
  }
}

function updateAlert(dt){
  const p = G.player;
  const inSafe = pointInRect(p.x,p.y,SAFE_ZONE);
  let decay = 6*dt;
  if(p.hidden) decay = 16*dt;
  if(inSafe) decay = 22*dt;
  G.alert = clamp(G.alert - decay, 0, 100);

  const stateEl = document.getElementById('alertState');
  const label = G.alert <= 25 ? 'LOW' : G.alert <= 50 ? 'SUSPICIOUS' : G.alert <= 75 ? 'SEARCHING' : 'LOCKDOWN';
  if(stateEl.textContent !== label){
    stateEl.textContent = label;
    if(label === 'LOCKDOWN') Radio.push('POLICE NETWORK: "Lockdown protocol engaged."', true);
  }
  document.getElementById('alertFill').style.width = G.alert + '%';

  const vignette = document.getElementById('dangerVignette');
  vignette.classList.toggle('danger-active', G.alert > 75 || G.player.arrestTimer > 0);
}

function updateTracker(dt){
  const p = G.player;
  const tr = G.tracker;
  tr.ticks++;
  const zi = zoneIndex(p.x,p.y);
  tr.zoneTime[zi] += dt;

  const mv = currentMoveVector();
  if(mv.strength > 0.1){
    tr.moveTime += dt;
    if(p.sprinting) tr.sprintTime += dt;
    if(Math.abs(mv.x) > Math.abs(mv.y)){
      if(mv.x < 0) tr.dirTime.left += dt; else tr.dirTime.right += dt;
    } else {
      if(mv.y < 0) tr.dirTime.up += dt; else tr.dirTime.down += dt;
    }
  }
}

function updateLoot(){
  const p = G.player;
  for(const l of G.loot){
    if(l.collected){ l.animT = Math.min(1, l.animT + 0.05); continue; }
    if(dist(p.x,p.y,l.x,l.y) < p.radius + 16){
      l.collected = true;
      G.lootCollected += l.value;
      Audio_.pickup();
      notify('+' + fmtMoney(l.value) + ' ' + l.name, 'loot');
    }
  }
}

function updateArrest(dt){
  const p = G.player;
  const chasers = G.police.filter(u => u.state === 'chase' && dist(u.x,u.y,p.x,p.y) < 28);
  if(chasers.length > 0){
    p.arrestTimer = clamp(p.arrestTimer + dt, 0, 1.15);
  } else {
    p.arrestTimer = clamp(p.arrestTimer - dt*1.4, 0, 1.15);
  }
  p.health = clamp(100 - (p.arrestTimer/1.15)*100, 0, 100);
  if(p.arrestTimer >= 1.15 && !G.ended){
    endGame('lose', 'caught');
  }
}

function updateHudDom(){
  document.getElementById('healthFill').style.width = G.player.health + '%';
  document.getElementById('staminaFill').style.width = G.player.stamina + '%';
  document.getElementById('hudTimer').textContent = fmtTime(G.timeLeft);
  document.getElementById('lootCollected').textContent = fmtMoney(G.lootCollected);

  const adaptation = G.adaptation || 0;
  document.getElementById('adaptFill').style.width = adaptation + '%';
  document.getElementById('adaptState').textContent = adaptationStage(adaptation);

  document.getElementById('distractCooldown').style.transform = 'scaleY(' + clamp(G.distractCooldown/8,0,1) + ')';
  document.getElementById('btnHide').classList.toggle('active-ability', G.player.hidden);
  document.getElementById('btnSprint').classList.toggle('active-ability', G.player.sprinting);
}

/* ============================================================
   10. RENDER
   ============================================================ */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const miniCanvas = document.getElementById('minimapCanvas');
const miniCtx = miniCanvas.getContext('2d');

function resizeCanvas(){
  const stage = document.getElementById('gameStage');
  const availW = stage.clientWidth - 20;
  const availH = stage.clientHeight - 20;
  const scale = Math.max(0.3, Math.min(availW / WORLD_W, availH / WORLD_H));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = WORLD_W * dpr;
  canvas.height = WORLD_H * dpr;
  canvas.style.width = (WORLD_W * scale) + 'px';
  canvas.style.height = (WORLD_H * scale) + 'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize', () => { if(G) resizeCanvas(); });

function render(){
  if(!G) return;
  ctx.save();
  if(G.shakeIntent && SAVE.settings.shake){
    G.shakeIntent = false;
    G.shakeMag = 6;
  }
  if(G.shakeMag && G.shakeMag > 0.1 && SAVE.settings.shake){
    const sx = (Math.random()-0.5) * G.shakeMag;
    const sy = (Math.random()-0.5) * G.shakeMag;
    ctx.translate(sx, sy);
    G.shakeMag *= 0.88;
  } else { G.shakeMag = 0; }

  ctx.clearRect(-20,-20,WORLD_W+40,WORLD_H+40);

  // ground
  ctx.fillStyle = '#11151c';
  ctx.fillRect(0,0,WORLD_W,WORLD_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for(let x=0;x<=WORLD_W;x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,WORLD_H); ctx.stroke(); }
  for(let y=0;y<=WORLD_H;y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(WORLD_W,y); ctx.stroke(); }

  // safe zone
  ctx.fillStyle = 'rgba(53,214,124,0.08)';
  ctx.fillRect(SAFE_ZONE.x,SAFE_ZONE.y,SAFE_ZONE.w,SAFE_ZONE.h);
  ctx.fillStyle = 'rgba(53,214,124,0.55)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('ENTRY / SAFE', SAFE_ZONE.x+10, SAFE_ZONE.y+18);

  // extraction zone
  const canEsc = G.lootCollected >= G.mode.target;
  ctx.fillStyle = canEsc ? 'rgba(53,214,124,0.28)' : 'rgba(53,214,124,0.10)';
  ctx.fillRect(EXTRACTION.x,EXTRACTION.y,EXTRACTION.w,EXTRACTION.h);
  ctx.strokeStyle = canEsc ? '#35d67c' : 'rgba(53,214,124,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(EXTRACTION.x,EXTRACTION.y,EXTRACTION.w,EXTRACTION.h);
  ctx.fillStyle = '#9be8bd';
  ctx.fillText('EXTRACTION', EXTRACTION.x+8, EXTRACTION.y+18);

  // buildings
  for(const w of WALLS){
    ctx.fillStyle = '#1b2129';
    ctx.fillRect(w.x,w.y,w.w,w.h);
    ctx.strokeStyle = 'rgba(45,212,255,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(w.x,w.y,w.w,w.h);
  }

  // hide zones
  HIDE_ZONES.forEach((z,i) => {
    ctx.save();
    ctx.setLineDash([4,4]);
    ctx.strokeStyle = 'rgba(240,192,74,0.55)';
    ctx.fillStyle = 'rgba(240,192,74,0.07)';
    ctx.fillRect(z.x,z.y,z.w,z.h);
    ctx.strokeRect(z.x,z.y,z.w,z.h);
    ctx.restore();
    ctx.fillStyle = 'rgba(240,192,74,0.8)';
    ctx.font = '16px sans-serif';
    ctx.fillText('\u{1F5C4}', z.x+z.w/2-8, z.y+z.h/2+6);
  });

  // cameras + cones
  CAMERAS.forEach((c,i) => {
    const angle = G.camAngles ? G.camAngles[i] : c.baseAngle;
    const detecting = G.camDetecting && G.camDetecting[i];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c.x,c.y);
    ctx.arc(c.x,c.y,c.range, angle-c.halfAngle, angle+c.halfAngle);
    ctx.closePath();
    ctx.fillStyle = detecting ? 'rgba(255,59,78,0.28)' : 'rgba(45,212,255,0.09)';
    ctx.fill();
    ctx.strokeStyle = detecting ? 'rgba(255,59,78,0.6)' : 'rgba(45,212,255,0.25)';
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = detecting ? '#ff3b4e' : '#2dd4ff';
    ctx.beginPath(); ctx.arc(c.x,c.y,6,0,Math.PI*2); ctx.fill();
  });

  // loot
  for(const l of G.loot){
    if(l.collected) continue;
    const bob = Math.sin(G.elapsed*2.5 + l.x) * 3;
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(l.icon, l.x, l.y + bob);
    ctx.textAlign = 'left';
  }

  // distraction marker
  if(G.distraction){
    const r = 14 + Math.sin(G.elapsed*10)*4;
    ctx.strokeStyle = 'rgba(240,192,74,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(G.distraction.x, G.distraction.y, r, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#f0c04a';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', G.distraction.x, G.distraction.y+5);
    ctx.textAlign = 'left';
  }

  // police
  for(const u of G.police){
    const stateColors = { patrol:'#8a93a3', suspicious:'#f0c04a', investigate:'#f0c04a', chase:'#ff3b4e', search:'#ff9d5c' };
    ctx.save();
    ctx.translate(u.x,u.y);
    ctx.rotate(u.facingAngle);
    ctx.fillStyle = stateColors[u.state] || '#ff3b4e';
    ctx.beginPath();
    ctx.moveTo(14,0); ctx.lineTo(-10,8); ctx.lineTo(-10,-8); ctx.closePath();
    ctx.fill();
    ctx.restore();
    if(u.state === 'chase'){
      ctx.strokeStyle = 'rgba(255,59,78,0.5)';
      ctx.beginPath(); ctx.arc(u.x,u.y,20,0,Math.PI*2); ctx.stroke();
    }
  }

  // player
  const p = G.player;
  ctx.save();
  ctx.globalAlpha = p.hidden ? 0.45 : 1;
  ctx.fillStyle = '#2dd4ff';
  ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x+p.facing.x*16, p.y+p.facing.y*16); ctx.stroke();
  ctx.restore();
  if(p.arrestTimer > 0){
    ctx.strokeStyle = 'rgba(255,59,78,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.radius+6, -Math.PI/2, -Math.PI/2 + (p.arrestTimer/1.15)*Math.PI*2);
    ctx.stroke();
  }

  ctx.restore();
  renderMinimap();
}

function renderMinimap(){
  const w = miniCanvas.width, h = miniCanvas.height;
  const sx = w/WORLD_W, sy = h/WORLD_H;
  miniCtx.clearRect(0,0,w,h);
  miniCtx.fillStyle = '#0d1016';
  miniCtx.fillRect(0,0,w,h);
  miniCtx.fillStyle = 'rgba(255,255,255,0.06)';
  for(const wall of WALLS) miniCtx.fillRect(wall.x*sx, wall.y*sy, wall.w*sx, wall.h*sy);

  miniCtx.fillStyle = '#35d67c';
  miniCtx.fillRect(EXTRACTION.x*sx, EXTRACTION.y*sy, EXTRACTION.w*sx, EXTRACTION.h*sy);

  miniCtx.fillStyle = '#a06bff';
  for(const c of CAMERAS) miniCtx.fillRect(c.x*sx-2, c.y*sy-2, 4,4);

  miniCtx.fillStyle = '#f0c04a';
  for(const l of G.loot) if(!l.collected) miniCtx.fillRect(l.x*sx-2, l.y*sy-2, 4,4);

  const p = G.player;
  for(const u of G.police){
    const d = dist(u.x,u.y,p.x,p.y);
    const reveal = u.state === 'chase' || d < 220 || G.alert > 75;
    if(reveal){ miniCtx.fillStyle = '#ff3b4e'; miniCtx.fillRect(u.x*sx-2.5, u.y*sy-2.5, 5,5); }
  }

  miniCtx.fillStyle = '#2dd4ff';
  miniCtx.beginPath(); miniCtx.arc(p.x*sx, p.y*sy, 3.5, 0, Math.PI*2); miniCtx.fill();
}

/* ============================================================
   11. MENU PARTICLE BACKGROUND (lightweight, decorative)
   ============================================================ */
(function menuParticles(){
  const c = document.getElementById('menuParticles');
  const pctx = c.getContext('2d');
  let particles = [];
  let running = false;

  function resize(){
    c.width = window.innerWidth; c.height = window.innerHeight;
  }
  function init(){
    resize();
    particles = Array.from({length: 46}, () => ({
      x: Math.random()*c.width, y: Math.random()*c.height,
      vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10,
      r: Math.random()*1.6+0.6
    }));
  }
  function tick(){
    if(!running) return;
    pctx.clearRect(0,0,c.width,c.height);
    const reduced = SAVE.settings.reducedMotion;
    pctx.fillStyle = 'rgba(45,212,255,0.5)';
    for(const p of particles){
      if(!reduced){
        p.x += p.vx * 0.016; p.y += p.vy * 0.016;
        if(p.x < 0) p.x = c.width; if(p.x > c.width) p.x = 0;
        if(p.y < 0) p.y = c.height; if(p.y > c.height) p.y = 0;
      }
      pctx.beginPath(); pctx.arc(p.x,p.y,p.r,0,Math.PI*2); pctx.fill();
    }
    requestAnimationFrame(tick);
  }
  window.addEventListener('resize', () => { if(running) resize(); });
  window.__startMenuParticles = () => { if(!running){ running = true; init(); tick(); } };
  window.__stopMenuParticles = () => { running = false; };
})();

/* ============================================================
   12. UI / SCREEN MANAGEMENT
   ============================================================ */
const ALL_SCREENS = ['loading-screen','main-menu','mode-select','howto-modal','settings-modal',
  'leaderboard-modal','tutorial-overlay','briefing-overlay','game-screen','pause-overlay',
  'win-screen','lose-screen'];

function showScreen(id){
  ALL_SCREENS.forEach(s => {
    const el = document.getElementById(s);
    if(!el) return;
    if(s === id) el.classList.remove('hidden'); else if(s !== 'game-screen' || id !== 'pause-overlay') {
      // keep game-screen visible underneath pause/win/lose overlays
      if(['pause-overlay','win-screen','lose-screen'].includes(id) && s === 'game-screen') return;
      el.classList.add('hidden');
    }
  });
  if(id === 'main-menu'){ window.__startMenuParticles(); updateOpsPanel(); }
  else { window.__stopMenuParticles(); }
}

function updateOpsPanel(){
  document.getElementById('opsTotalRuns').textContent = SAVE.stats.totalRuns;
  document.getElementById('opsBestEscape').textContent = SAVE.stats.bestEscapeTime !== null ? fmtTime(SAVE.stats.bestEscapeTime) : '--:--';
  const rate = SAVE.stats.totalRuns > 0 ? Math.round((SAVE.stats.wins / SAVE.stats.totalRuns)*100) : 0;
  document.getElementById('opsWinRate').textContent = rate + '%';
}

function renderLeaderboard(){
  const el = document.getElementById('leaderboardList');
  el.innerHTML = '';
  if(SAVE.leaderboard.length === 0){
    el.innerHTML = '<div class="leaderboard-empty">No runs recorded yet. Complete a heist to set the first score.</div>';
    return;
  }
  SAVE.leaderboard.forEach((row,i) => {
    const div = document.createElement('div');
    div.className = 'leaderboard-row';
    div.innerHTML = `<span class="leaderboard-rank">#${i+1}</span><span>${row.score.toLocaleString()} pts</span><span class="leaderboard-mode">${row.mode} · ${row.date}</span>`;
    el.appendChild(div);
  });
}

/* ---- settings UI sync ---- */
function syncSettingsUI(){
  document.getElementById('toggleSound').checked = SAVE.settings.sound;
  document.getElementById('toggleShake').checked = SAVE.settings.shake;
  document.getElementById('toggleReducedMotion').checked = SAVE.settings.reducedMotion;
  document.body.classList.toggle('reduced-motion', SAVE.settings.reducedMotion);
}

let currentModeKey = 'aihunt';
let tutorialStepIdx = 0;
let settingsReturnScreen = 'main-menu';

/* ============================================================
   13. EVENT WIRING
   ============================================================ */
function on(id, evt, fn){ const el = document.getElementById(id); if(el) el.addEventListener(evt, fn); }

document.addEventListener('DOMContentLoaded', () => {
  // loading sequence (purely cosmetic, gives premium feel)
  const fill = document.getElementById('loadingBarFill');
  const status = document.getElementById('loadingStatus');
  const steps = ['BOOTING CITY GRID…','LOADING PATROL ROUTES…','CALIBRATING CAMERAS…','SYNCING BEHAVIOR MODEL…','READY'];
  let p = 0;
  const iv = setInterval(() => {
    p += 20 + Math.random()*10;
    fill.style.width = Math.min(100,p) + '%';
    status.textContent = steps[Math.min(steps.length-1, Math.floor(p/22))];
    if(p >= 100){
      clearInterval(iv);
      setTimeout(() => { showScreen('main-menu'); }, 250);
    }
  }, 220);

  syncSettingsUI();
  updateOpsPanel();

  // main menu buttons
  on('btnStart','click', () => { Audio_.unlock(); Audio_.click(); showScreen('mode-select'); });
  on('btnHowTo','click', () => { Audio_.click(); showScreen('howto-modal'); });
  on('btnSettings','click', () => { Audio_.click(); settingsReturnScreen = 'main-menu'; showScreen('settings-modal'); });
  on('btnLeaderboard','click', () => { Audio_.click(); renderLeaderboard(); showScreen('leaderboard-modal'); });

  // generic close buttons — settings can be opened from the main menu OR from the
  // in-game pause overlay, so it needs to remember where to return to.
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      Audio_.click();
      const target = btn.getAttribute('data-close');
      if(target === 'settings-modal'){ showScreen(settingsReturnScreen); }
      else { showScreen('main-menu'); }
    });
  });

  // mode select cards
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      Audio_.click();
      currentModeKey = card.getAttribute('data-mode');
      const mode = MODES[currentModeKey];
      document.getElementById('briefingModeTitle').textContent = mode.label + ' — BRIEFING';
      document.getElementById('briefingObjective').textContent = `Collect ${fmtMoney(mode.target)} and reach extraction`;
      document.getElementById('briefingTime').textContent = fmtTime(mode.time);
      document.getElementById('briefingUnits').textContent = mode.units;
      document.getElementById('briefingLearning').textContent = mode.learnLabel;
      showScreen('briefing-overlay');
    });
  });

  on('btnBeginHeist','click', () => {
    Audio_.click();
    if(!SAVE.tutorialDone){
      tutorialStepIdx = 0;
      renderTutorialStep();
      showScreen('tutorial-overlay');
    } else {
      showScreen('game-screen');
      startGame(currentModeKey);
    }
  });

  function renderTutorialStep(){
    const s = TUTORIAL_STEPS[tutorialStepIdx];
    document.getElementById('tutorialStepCount').textContent = (tutorialStepIdx+1) + ' / ' + TUTORIAL_STEPS.length;
    document.getElementById('tutorialIcon').textContent = s.icon;
    document.getElementById('tutorialTitle').textContent = s.title;
    document.getElementById('tutorialBody').textContent = s.body;
    document.getElementById('btnNextTutorial').textContent = tutorialStepIdx === TUTORIAL_STEPS.length-1 ? 'START HEIST' : 'NEXT';
  }
  function finishTutorial(){
    SAVE.tutorialDone = true; saveData();
    showScreen('game-screen');
    startGame(currentModeKey);
  }
  on('btnNextTutorial','click', () => {
    Audio_.click();
    if(tutorialStepIdx === TUTORIAL_STEPS.length-1){ finishTutorial(); }
    else { tutorialStepIdx++; renderTutorialStep(); }
  });
  on('btnSkipTutorial','click', () => { Audio_.click(); finishTutorial(); });

  // settings toggles
  on('toggleSound','change', e => { SAVE.settings.sound = e.target.checked; saveData(); });
  on('toggleShake','change', e => { SAVE.settings.shake = e.target.checked; saveData(); });
  on('toggleReducedMotion','change', e => {
    SAVE.settings.reducedMotion = e.target.checked;
    document.body.classList.toggle('reduced-motion', e.target.checked);
    saveData();
  });

  on('btnClearScores','click', () => {
    SAVE.leaderboard = [];
    saveData();
    renderLeaderboard();
  });

  // ability buttons (desktop, click-to-trigger)
  on('btnHide','click', () => { G && (G.inputAbility.hidePressed = true); });
  on('btnDistract','click', () => { G && (G.inputAbility.distractPressed = true); });
  on('btnEscapeAction','click', () => { G && (G.inputAbility.escapePressed = true); });
  const sprintBtn = document.getElementById('btnSprint');
  sprintBtn.addEventListener('mousedown', () => { if(G) G.inputAbility.sprintHold = true; });
  sprintBtn.addEventListener('mouseup', () => { if(G) G.inputAbility.sprintHold = false; });
  sprintBtn.addEventListener('mouseleave', () => { if(G) G.inputAbility.sprintHold = false; });

  // pause
  on('btnPause','click', () => { if(G){ G.paused = true; showScreen('pause-overlay'); } });
  on('btnResume','click', () => { if(G){ G.paused = false; showScreen('game-screen'); } });
  on('btnPauseSettings','click', () => { settingsReturnScreen = 'pause-overlay'; showScreen('settings-modal'); });
  on('btnQuitToMenu','click', () => {
    if(G){ G.running = false; }
    showScreen('main-menu');
  });

  // win / lose
  on('btnWinPlayAgain','click', () => { showScreen('game-screen'); startGame(currentModeKey); });
  on('btnWinMenu','click', () => { showScreen('main-menu'); });
  on('btnLoseRetry','click', () => { showScreen('game-screen'); startGame(currentModeKey); });
  on('btnLoseMenu','click', () => { showScreen('main-menu'); });

  /* ---- keyboard ---- */
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if(G){ G.keys[k] = true; }
    if(k === 'e' && G && !G.paused && !G.ended) G.inputAbility.hidePressed = true;
    if(k === 'q' && G && !G.paused && !G.ended) G.inputAbility.distractPressed = true;
    if(k === 'f' && G && !G.paused && !G.ended) G.inputAbility.escapePressed = true;
    if(k === 'shift' && G) G.inputAbility.sprintHold = true;
    if(k === 'escape' && G && !G.ended){
      G.paused = !G.paused;
      showScreen(G.paused ? 'pause-overlay' : 'game-screen');
    }
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if(G){ G.keys[k] = false; }
    if(k === 'shift' && G) G.inputAbility.sprintHold = false;
  });

  /* ---- mobile joystick ---- */
  const joyZone = document.getElementById('joystickZone');
  const joyThumb = document.getElementById('joystickThumb');
  let joyBaseX = 0, joyBaseY = 0;
  const JOY_MAX = 46;

  function joyStart(clientX, clientY){
    const rect = joyZone.getBoundingClientRect();
    joyBaseX = rect.left + rect.width/2;
    joyBaseY = rect.top + rect.height/2;
    if(G) G.joystick.active = true;
  }
  function joyMove(clientX, clientY){
    if(!G || !G.joystick.active) return;
    let dx = clientX - joyBaseX, dy = clientY - joyBaseY;
    const len = Math.hypot(dx,dy);
    const clampedLen = Math.min(len, JOY_MAX);
    const strength = clampedLen / JOY_MAX;
    if(len > 0){ dx = (dx/len); dy = (dy/len); } else { dx = 0; dy = 0; }
    G.joystick.dx = dx; G.joystick.dy = dy; G.joystick.strength = strength;
    joyThumb.style.transform = `translate(calc(-50% + ${dx*clampedLen}px), calc(-50% + ${dy*clampedLen}px))`;
  }
  function joyEnd(){
    if(G){ G.joystick.active = false; G.joystick.strength = 0; }
    joyThumb.style.transform = 'translate(-50%,-50%)';
  }
  joyZone.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; joyStart(t.clientX,t.clientY); joyMove(t.clientX,t.clientY); }, {passive:false});
  joyZone.addEventListener('touchmove', e => { e.preventDefault(); const t = e.touches[0]; joyMove(t.clientX,t.clientY); }, {passive:false});
  joyZone.addEventListener('touchend', e => { e.preventDefault(); joyEnd(); }, {passive:false});
  joyZone.addEventListener('mousedown', e => { joyStart(e.clientX,e.clientY); joyMove(e.clientX,e.clientY);
    const mm = ev => joyMove(ev.clientX,ev.clientY);
    const mu = () => { joyEnd(); window.removeEventListener('mousemove',mm); window.removeEventListener('mouseup',mu); };
    window.addEventListener('mousemove',mm); window.addEventListener('mouseup',mu);
  });

  /* ---- mobile action buttons ---- */
  const mSprint = document.getElementById('mSprint');
  mSprint.addEventListener('touchstart', e => { e.preventDefault(); if(G) G.inputAbility.sprintHold = true; }, {passive:false});
  mSprint.addEventListener('touchend', e => { e.preventDefault(); if(G) G.inputAbility.sprintHold = false; }, {passive:false});
  document.getElementById('mHide').addEventListener('touchstart', e => { e.preventDefault(); if(G) G.inputAbility.hidePressed = true; }, {passive:false});
  document.getElementById('mDistract').addEventListener('touchstart', e => { e.preventDefault(); if(G) G.inputAbility.distractPressed = true; }, {passive:false});
  document.getElementById('mEscape').addEventListener('touchstart', e => { e.preventDefault(); if(G) G.inputAbility.escapePressed = true; }, {passive:false});

  showScreen('loading-screen');
});

})();
