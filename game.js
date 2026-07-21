/* =========================================================================
   BUG BLITZ v2  —  Three.js r128
   Adds: object pooling, endless mode, daily challenge (seeded), boss bugs,
   new bug behaviors (splitter/armored/friendly), missions/achievements,
   hit-stop + squash juice, adaptive quality.
   ========================================================================= */

// ---------- persistent save ----------
const SAVE_KEY = 'bugblitz_save_v2';
let save = {
  coins:0, best:{}, unlocked:1,
  upgrades:{ hammer:0, magnet:false, slowmo:false, extraLife:false, coinBoost:false, comboGuard:false, starterFrenzy:false, wideMagnet:false, reinforced:false },
  endlessBest:0,
  daily:{ date:'', done:false, best:0 },
  missions:null, missionRerollDate:'',
  stats:{ totalSmashed:0, wasps:0, bosses:0, bestCombo:0 },
};
function deepMerge(base, over){ for(const k in over){ if(over[k]&&typeof over[k]==='object'&&!Array.isArray(over[k])) base[k]=deepMerge(base[k]||{},over[k]); else base[k]=over[k]; } return base; }
// Persistence goes through BSData when present (Reddit/Devvit-backed, per user)
// and falls back to localStorage automatically. See src/client/data.js.
function persist(){
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch(e){}
  if (window.BSData) window.BSData.save(save);
}
// Submit a run's score to the daily leaderboard (no-op when standalone).
function submitScore(mode, score, wave){
  if (window.BSData) window.BSData.submitScore(mode, score, wave);
}

// ---------- seeded RNG (mulberry32) for daily challenge ----------
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function seedFromStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
let RNG = Math.random; // swapped to seeded during daily runs
function rand(){ return RNG(); }

// ---------- level / biome config ----------
const LEVELS = [
  { name:'Garden',   biome:'🌿', diff:'Easy',    sky:0x152a12, ground:0x24451c, fog:0x1a3315, need:12, time:45, speed:1.0,  spawn:1.15, bugs:['beetle','ant'], boss:'queenAnt' },
  { name:'Meadow',   biome:'🌼', diff:'Easy',    sky:0x27350f, ground:0x3c5416, fog:0x2c3d12, need:16, time:45, speed:1.15, spawn:1.0,  bugs:['beetle','ant','fly'], boss:'bigFly' },
  { name:'Swamp',    biome:'🐸', diff:'Medium',  sky:0x0e2622, ground:0x18382f, fog:0x123029, need:20, time:50, speed:1.3,  spawn:0.9,  bugs:['fly','ant','spider'], boss:'broodSpider' },
  { name:'Hive',     biome:'🐝', diff:'Medium',  sky:0x2e2408, ground:0x4a3a0d, fog:0x352a0a, need:24, time:50, speed:1.5,  spawn:0.8,  bugs:['bee','fly','beetle'], boss:'hornet' },
  { name:'Cave',     biome:'🕸️', diff:'Hard',    sky:0x0c0c14, ground:0x1a1a26, fog:0x101018, need:28, time:55, speed:1.7,  spawn:0.72, bugs:['spider','beetle','roach'], boss:'broodSpider' },
  { name:'Inferno',  biome:'🔥', diff:'Hard',    sky:0x2a0e08, ground:0x431409, fog:0x300f08, need:32, time:60, speed:1.95, spawn:0.62, bugs:['roach','bee','spider','fly'], boss:'hornet' },
  { name:'Void',     biome:'🌌', diff:'Insane',  sky:0x0a0618, ground:0x140a2c, fog:0x0d0722, need:40, time:60, speed:2.3,  spawn:0.5,  bugs:['roach','bee','spider','fly','wasp'], boss:'voidMonarch' },
];

// bug archetypes
const BUGS = {
  beetle:{ hp:1, pts:10, scale:1.0, color:0x5a3a1a, accent:0x8a5a2a, sp:0.8,  wings:false },
  ant:   { hp:1, pts:12, scale:0.7, color:0x2a1a10, accent:0x4a2a18, sp:1.4,  wings:false },
  fly:   { hp:1, pts:15, scale:0.75,color:0x2a2a30, accent:0x556699,sp:1.7,  wings:true, fly:true },
  spider:{ hp:2, pts:22, scale:1.1, color:0x1a1018, accent:0x3a2030, sp:1.0,  legs:8 },
  bee:   { hp:1, pts:18, scale:0.9, color:0xd8a020, accent:0x1a1a1a, sp:1.5,  wings:true, fly:true, stripes:true },
  roach: { hp:2, pts:20, scale:1.05,color:0x3a2416, accent:0x6a4426, sp:1.6,  wings:false },
  wasp:  { hp:2, pts:30, scale:0.95,color:0xe0b030, accent:0x201008, sp:2.0,  wings:true, fly:true, stripes:true, aggressive:true },
  // new behavior bugs
  splitter:{ hp:1, pts:16, scale:1.15,color:0x6a2a7a, accent:0xaa4aca, sp:1.0, splits:true },
  armored: { hp:1, pts:26, scale:1.05,color:0x445566, accent:0x99b0c0, sp:0.9, armored:true, legs:6 },
  larva:   { hp:1, pts:8,  scale:0.5, color:0x8a5a7a, accent:0xcaa0ba, sp:2.0 },   // splitter children
  ladybug: { hp:1, pts:0,  scale:0.85,color:0xdd3333, accent:0x111111, sp:1.1, friendly:true, spots:true }, // DON'T hit
};

// boss defs
const BOSSES = {
  queenAnt:   { name:'Queen Ant',    hp:24, scale:2.6, color:0x3a2214, accent:0x6a3a20, base:'ant',    pts:400, spawns:'ant' },
  bigFly:     { name:'Horsefly',     hp:28, scale:2.4, color:0x2a2a34, accent:0x6677aa, base:'fly',    pts:450, fly:true, spawns:'fly' },
  broodSpider:{ name:'Brood Mother', hp:40, scale:2.9, color:0x1a1018, accent:0x5a2a4a, base:'spider', pts:600, spawns:'spider' },
  hornet:     { name:'Giant Hornet', hp:44, scale:2.5, color:0xe0b030, accent:0x201008, base:'wasp',   pts:700, fly:true, aggressive:true, spawns:'bee' },
  voidMonarch:{ name:'Void Monarch', hp:64, scale:3.2, color:0x3a1a6a, accent:0xaa60ff, base:'spider', pts:1200, spawns:'roach' },
};

// ---------- AUDIO ENGINE ----------
const Audio = (() => {
  let ctx, master, musicGain, sfxGain, muted=false, musicTimer=null, musicStep=0, drumLayer=false;
  function init(){
    if (ctx) return;
    ctx = new (window.AudioContext||window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 1.0; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.55; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.95; sfxGain.connect(master);
  }
  function _initMusic(){ if(window.BSMusic){ BSMusic.attach(ctx, master); } }
  function now(){ return ctx.currentTime; }
  function tone(freq, dur, type='sine', gain=0.3, dest, slide=0){
    if(!ctx||muted) return; dest=dest||sfxGain;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq, now());
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(20,freq*slide), now()+dur);
    g.gain.setValueAtTime(0.0001, now());
    g.gain.exponentialRampToValueAtTime(gain, now()+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now()+dur);
    o.connect(g); g.connect(dest); o.start(); o.stop(now()+dur+0.02);
  }
  function noise(dur, gain=0.3, filterFreq=1200){
    if(!ctx||muted) return;
    const buf=ctx.createBuffer(1, ctx.sampleRate*dur, ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=filterFreq;
    const g=ctx.createGain(); g.gain.value=gain;
    src.connect(f); f.connect(g); g.connect(sfxGain); src.start();
  }
  const sfx = {
    squish(){ noise(0.14, 0.35, 900); tone(180, 0.12, 'sawtooth', 0.18, sfxGain, 0.4); },
    tough(){ noise(0.2, 0.4, 600); tone(90, 0.18, 'square', 0.2, sfxGain, 0.5); },
    clank(){ noise(0.08,0.3,3000); tone(1400,0.06,'square',0.12); tone(900,0.08,'triangle',0.1); },
    miss(){ tone(200, 0.25, 'sine', 0.2, sfxGain, 0.5); },
    combo(n){ tone(440+ n*80, 0.14, 'triangle', 0.28); tone(660+n*80,0.16,'sine',0.18); },
    coin(){ tone(880, 0.08, 'square', 0.2); tone(1320, 0.1, 'square', 0.15); },
    power(){ tone(523,0.1,'triangle',0.3); tone(659,0.1,'triangle',0.3); tone(784,0.16,'triangle',0.3); },
    hurt(){ noise(0.3,0.5,400); tone(140,0.3,'sawtooth',0.3,sfxGain,0.3); },
    friendly(){ tone(300,0.15,'sine',0.25,sfxGain,0.6); tone(150,0.2,'sine',0.2,sfxGain,0.6); },
    bossHit(){ noise(0.12,0.4,700); tone(70,0.14,'square',0.25,sfxGain,0.7); },
    bossDie(){ [110,90,70,55,40].forEach((f,i)=>setTimeout(()=>{ noise(0.3,0.5,500); tone(f,0.4,'sawtooth',0.3,sfxGain,0.5);},i*120)); },
    win(){ [523,659,784,1046].forEach((f,i)=>setTimeout(()=>tone(f,0.3,'triangle',0.3),i*120)); },
    lose(){ [392,330,262,175].forEach((f,i)=>setTimeout(()=>tone(f,0.32,'triangle',0.3,sfxGain,0.5),i*150)); setTimeout(()=>tone(150,0.5,'sawtooth',0.32,sfxGain,0.25),620); setTimeout(()=>{noise(0.18,0.4,220);tone(70,0.35,'sine',0.3,sfxGain,0.6);},760); },
    tick(){ tone(1200,0.05,'sine',0.15); },
    unlock(){ [659,880,1046,1318].forEach((f,i)=>setTimeout(()=>tone(f,0.2,'triangle',0.28),i*90)); },
  };
  const SCALES = [ [0,3,5,7,10], [0,2,4,7,9], [0,2,3,5,7], [0,1,4,6,8] ];
  let curScale = SCALES[0], curRoot = 55, kickStep=0;
  function startMusic(levelIdx, intense){
    if(!ctx) return; stopMusic();
    _initMusic(); if(window.BSMusic){ var _hard=(intense||levelIdx>=3); BSMusic.play(_hard?'gameB':'gameA'); return; }
    curScale = SCALES[levelIdx % SCALES.length];
    curRoot = 41 + (levelIdx%4)*3; musicStep=0; drumLayer=!!intense;
    const tempo = 0.28 - Math.min(levelIdx,6)*0.012;
    musicTimer = setInterval(()=>{
      if(muted) return; const s=musicStep;
      if(s%4===0){ const bn=curRoot*Math.pow(2,(curScale[(s/4)%curScale.length])/12); tone(bn,0.5,'triangle',0.5,musicGain,1); }
      const an=curRoot*4*Math.pow(2,(curScale[s%curScale.length]+(s%8<4?0:12))/12);
      tone(an,0.18,'sine',0.28,musicGain);
      if(s%8===6) tone(an*1.5,0.12,'triangle',0.15,musicGain);
      if(drumLayer){ if(s%2===0) noise(0.05,0.18,4000); if(s%8===4){ noise(0.12,0.25,300);} }
      musicStep=(musicStep+1)%64;
    }, tempo*1000);
  }
  function setIntensity(on){ drumLayer=on; }
  function stopMusic(){ if(musicTimer){ clearInterval(musicTimer); musicTimer=null; } if(window.BSMusic) BSMusic.stop(); }
  function setMuted(m){ muted=m; if(master) master.gain.value=m?0:1.0; }
  function resume(){ if(ctx&&ctx.state==='suspended') ctx.resume(); }
  function startMenuMusic(){ if(!ctx) return; stopMusic(); _initMusic(); if(window.BSMusic){ BSMusic.play('menu'); return; } curScale=[0,3,7,10,12]; curRoot=36; musicStep=0; drumLayer=false; musicTimer=setInterval(()=>{ if(muted) return; const s=musicStep; if(s%8===0){ const bn=curRoot*Math.pow(2,(curScale[(s/8)%curScale.length])/12); tone(bn,1.4,'sine',0.4,musicGain,1); } if(s%4===0){ const an=curRoot*3*Math.pow(2,(curScale[s%curScale.length])/12); tone(an,0.9,'triangle',0.22,musicGain); } if(s%16===10){ const sp=curRoot*6*Math.pow(2,(curScale[s%curScale.length])/12); tone(sp,0.7,'sine',0.12,musicGain); } musicStep=(musicStep+1)%64; }, 360); }
  return { init, sfx, startMusic, startMenuMusic, setIntensity, stopMusic, setMuted, resume, get muted(){return muted;} };
})();

function haptic(ms){ if(navigator.vibrate) navigator.vibrate(ms); }

// ---------- THREE setup ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
let QUALITY = 2; // pixel ratio cap, adaptive
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 200);
const CAM_BASE = new THREE.Vector3(0, 15, 11);
camera.position.copy(CAM_BASE);
camera.lookAt(0,0,0);

const amb = new THREE.AmbientLight(0xffffff, 0.55); scene.add(amb);
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(-8,20,6); sun.castShadow=true; sun.shadow.mapSize.set(1024,1024);
sun.shadow.camera.left=-16; sun.shadow.camera.right=16; sun.shadow.camera.top=16; sun.shadow.camera.bottom=-16;
scene.add(sun);
const fill = new THREE.PointLight(0x88ccff,0.5,60); fill.position.set(10,8,-6); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.85); rim.position.set(6,10,-14); scene.add(rim);
const rimTint = new THREE.PointLight(0xffffff, 0.0, 90); rimTint.position.set(0,14,-16); scene.add(rimTint);

const groundMat = new THREE.MeshStandardMaterial({ color:0x24451c, roughness:0.95 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40,40), groundMat);
ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);

// ---------- shared geometry/material cache (perf) ----------
const GEO = {
  abd: new THREE.SphereGeometry(0.55,10,8),
  thx: new THREE.SphereGeometry(0.4,10,8),
  head: new THREE.SphereGeometry(0.28,8,8),
  eye: new THREE.SphereGeometry(0.09,6,6),
  leg: new THREE.CylinderGeometry(0.04,0.04,0.6,4),
  wing: new THREE.CircleGeometry(0.5,8),
  stripe: new THREE.TorusGeometry(0.5,0.09,6,12),
  spot: new THREE.SphereGeometry(0.08,6,6),
  plate: new THREE.IcosahedronGeometry(0.62,0),
  octa: new THREE.OctahedronGeometry(0.4,0),
  shell: new THREE.SphereGeometry(0.6,14,10),
  eyeShine: new THREE.SphereGeometry(0.045,6,6),
};
const eyeMat = new THREE.MeshStandardMaterial({ color:0x0a0a12, roughness:0.12, metalness:0.4, emissive:0xff3344, emissiveIntensity:0.7 });
const eyeShineMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.05, emissive:0xffffff, emissiveIntensity:0.35 });
const wingMat = new THREE.MeshStandardMaterial({ color:0xdff0ff, transparent:true, opacity:0.38, roughness:0.05, metalness:0.3, side:THREE.DoubleSide });
const bodyMatCache = {}, accMatCache = {}, shellMatCache = {};
function bodyMat(color){ if(!bodyMatCache[color]) bodyMatCache[color]=new THREE.MeshStandardMaterial({ color, roughness:0.34, metalness:0.3 }); return bodyMatCache[color]; }
function accMat(color){ if(!accMatCache[color]) accMatCache[color]=new THREE.MeshStandardMaterial({ color, roughness:0.3, metalness:0.35 }); return accMatCache[color]; }
function shellMat(color){ if(!shellMatCache[color]) shellMatCache[color]=new THREE.MeshStandardMaterial({ color, roughness:0.45, metalness:0.0, emissive:0x000000, emissiveIntensity:0 }); return shellMatCache[color]; }

// ---------- decor via InstancedMesh (perf) ----------
let decorMesh=null;
let decorMeshes=[];
function buildDecor(cfg){
  decorMeshes.forEach(d=>{ scene.remove(d); d.geometry.dispose(); }); decorMeshes=[];
  if(decorMesh){ scene.remove(decorMesh); decorMesh=null; }
  // base tone + a lighter and darker sibling so the field has tonal variety
  const base=new THREE.Color(cfg.ground);
  const tint=(mul)=>{ const c=base.clone(); const h={}; c.getHSL(h); c.setHSL(h.h,h.s,Math.min(0.85,Math.max(0.04,h.l*mul))); return c.getHex(); };
  const families=[
    { geo:new THREE.DodecahedronGeometry(1,0),      col:tint(1.0),  N:20, flat:true,  tall:[0.7,1.0] }, // angular rocks
    { geo:new THREE.IcosahedronGeometry(0.9,0),     col:tint(1.35), N:12, flat:true,  tall:[0.5,0.8] }, // lighter smaller stones
    { geo:new THREE.SphereGeometry(0.8,7,5),        col:tint(0.7),  N:8,  flat:false, tall:[0.6,0.9] }, // rounded dark mounds
  ];
  const m=new THREE.Matrix4(), q=new THREE.Quaternion(), pos=new THREE.Vector3(), scl=new THREE.Vector3();
  families.forEach(f=>{
    const mat=new THREE.MeshStandardMaterial({ color:f.col, roughness:1, metalness:0, flatShading:f.flat });
    const dm=new THREE.InstancedMesh(f.geo, mat, f.N); dm.castShadow=true; dm.receiveShadow=true;
    for(let i=0;i<f.N;i++){
      const s=0.3+Math.random()*0.85;
      const ty=f.tall[0]+Math.random()*(f.tall[1]-f.tall[0]);
      pos.set((Math.random()-0.5)*32, s*0.4*ty, (Math.random()-0.5)*28-4);
      q.setFromEuler(new THREE.Euler(Math.random(),Math.random(),Math.random()));
      scl.set(s, s*ty, s);
      m.compose(pos,q,scl); dm.setMatrixAt(i,m);
    }
    dm.instanceMatrix.needsUpdate=true; scene.add(dm); decorMeshes.push(dm);
  });
}

// ---------- particle burst POOL (perf) ----------
const burstPool=[]; const burstsActive=[];
function getBurst(){
  let b=burstPool.pop();
  if(!b){
    const n=12; const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n*3),3));
    const mat=new THREE.PointsMaterial({ size:0.35, transparent:true, opacity:1 });
    b=new THREE.Points(geo,mat); b.userData={ vel:[] };
    for(let i=0;i<n;i++) b.userData.vel.push(new THREE.Vector3());
  }
  return b;
}
function spawnBurst(pos,color){
  const b=getBurst(); const p=b.geometry.attributes.position.array;
  for(let i=0;i<12;i++){ p[i*3]=pos.x; p[i*3+1]=pos.y; p[i*3+2]=pos.z;
    b.userData.vel[i].set((Math.random()-0.5)*0.4, Math.random()*0.5, (Math.random()-0.5)*0.4); }
  b.geometry.attributes.position.needsUpdate=true;
  b.material.color.setHex(color); b.material.opacity=1; b.userData.life=1;
  scene.add(b); burstsActive.push(b);
}
function updateBursts(dt){
  for(let i=burstsActive.length-1;i>=0;i--){
    const b=burstsActive[i]; const p=b.geometry.attributes.position.array;
    b.userData.life-=dt*2;
    for(let j=0;j<12;j++){ b.userData.vel[j].y-=0.03; p[j*3]+=b.userData.vel[j].x; p[j*3+1]+=b.userData.vel[j].y; p[j*3+2]+=b.userData.vel[j].z; }
    b.geometry.attributes.position.needsUpdate=true; b.material.opacity=Math.max(0,b.userData.life);
    if(b.userData.life<=0){ scene.remove(b); burstsActive.splice(i,1); burstPool.push(b); }
  }
}

// ---------- bug factory + POOL ----------
function buildBugMesh(type){
  const spec=BUGS[type]; const g=new THREE.Group();
  const bm=bodyMat(spec.color), am=accMat(spec.accent);
  const abd=new THREE.Mesh(GEO.abd,bm); abd.scale.set(1,0.8,1.35); abd.position.z=0.25; g.add(abd);
  const thx=new THREE.Mesh(GEO.thx,am); thx.position.z=-0.35; g.add(thx);
  const head=new THREE.Mesh(GEO.head,bm); head.position.z=-0.75; g.add(head);
  [-0.15,0.15].forEach(x=>{ const e=new THREE.Mesh(GEO.eye,eyeMat); e.position.set(x,0.12,-0.92); g.add(e);
    const sh=new THREE.Mesh(GEO.eyeShine,eyeShineMat); sh.position.set(x-0.03,0.17,-0.99); g.add(sh); });
  if(spec.stripes){ for(let i=0;i<2;i++){ const s=new THREE.Mesh(GEO.stripe,am); s.rotation.y=Math.PI/2; s.position.z=0.1+i*0.3; s.scale.set(1,0.8,1); g.add(s);} }
  if(spec.spots){ for(let i=0;i<5;i++){ const s=new THREE.Mesh(GEO.spot,am); const a=i/5*Math.PI*2; s.position.set(Math.cos(a)*0.3,0.35,0.25+Math.sin(a)*0.35); g.add(s);} }
  if(spec.armored){ for(let i=0;i<3;i++){ const pl=new THREE.Mesh(GEO.plate,am); pl.scale.set(1,0.5,0.7); pl.position.set(0,0.28,0.1+i*0.28-0.2); g.add(pl);} }
  const wings=[];
  if(spec.wings){ [-1,1].forEach(side=>{ const w=new THREE.Mesh(GEO.wing,wingMat); w.scale.set(0.5,1,1); w.position.set(side*0.35,0.25,0); w.rotation.z=side*0.3; g.add(w); wings.push(w);}); }
  const legs=[]; const legCount=spec.legs||6;
  for(let i=0;i<legCount;i++){ const side=i<legCount/2?-1:1; const idx=i%(legCount/2);
    const leg=new THREE.Mesh(GEO.leg,am); leg.position.set(side*0.4,0,-0.3+idx*0.3); leg.rotation.z=side*1.0; leg.rotation.x=0.3; g.add(leg); legs.push({mesh:leg,phase:i}); }
  g.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
  g.userData={ type, wings, legs };
  return g;
}
const bugPools={};
function getBug(type){
  bugPools[type]=bugPools[type]||[];
  let g=bugPools[type].pop();
  if(!g){ g=buildBugMesh(type); }
  const spec=BUGS[type];
  g.scale.setScalar(spec.scale);
  g.visible=true;
  g.userData.spec=spec; g.userData.hp=spec.hp; g.userData.alive=true;
  g.userData.t=Math.random()*10; g.userData.dying=undefined; g.userData.isBoss=false;
  return g;
}
function releaseBug(g){
  scene.remove(g);
  if(g.userData.noPool || g.userData.isBoss){ return; }
  const t=g.userData.type;
  if(bugPools[t] && bugPools[t].length<40) bugPools[t].push(g);
}

// boss uses a bug mesh scaled up with a health aura
function makeBoss(key){
  const bd=BOSSES[key];
  const g=buildBugMesh(bd.base);
  // recolor
  g.traverse(o=>{ if(o.isMesh && o.material && o.material.color){
    if(o.material===eyeMat) return;
  }});
  g.scale.setScalar(bd.scale);
  const aura=new THREE.PointLight(0xff4040,1.6,14); aura.position.y=1; g.add(aura);
  g.userData.spec = Object.assign({}, BUGS[bd.base], { fly:bd.fly, aggressive:bd.aggressive, pts:bd.pts });
  g.userData.hp=bd.hp; g.userData.maxHp=bd.hp; g.userData.alive=true; g.userData.isBoss=true;
  g.userData.bossKey=key; g.userData.spawnAcc=0; g.userData.t=0; g.userData.dying=undefined; g.userData.noPool=true;
  return g;
}

// ---------- game state ----------
const G = {
  state:'menu', mode:'campaign', levelIdx:0, cfg:null, daily:false,
  score:0, combo:0, comboTimer:0, lives:3, maxLives:3, bestComboRun:0,
  smashed:0, need:12, time:45, elapsed:0, endlessWave:0,
  bugs:[], spawnAcc:0, spawnEvery:1.1,
  slowmo:0, magnet:false, frenzy:0, multiTimer:0,
  boss:null, bossPhase:false,
  earnedCoins:0, hitStop:0,
  missionProgress:{},
};

// ---------- DOM ----------
const $=id=>document.getElementById(id);
const els={};
['hud','score','coins','combo','multiTxt','lives','progress','barLeft','barRight','powerRow','scoreLabel',
 'menu','menuCoins','levelSelect','levelGrid','shopScreen','shopGrid','shopCoins','modeGrid',
 'missionScreen','missionList','missionSub','endScreen','endTitle','endStars','finalScore','earnedCoins',
 'muteBtn','quitBtn','topBtns','flash','toast','nextBtn','bossbar','bossName','bossHp','bossHpTxt','fps'].forEach(k=>els[k]=$(k));

function showOverlay(name){
  ['menu','levelSelect','shopScreen','missionScreen','endScreen'].forEach(o=>els[o].classList.add('hide'));
  els.hud.classList.add('hide'); els.topBtns.classList.add('hide'); els.fps.classList.add('hide');
  if(name) els[name].classList.remove('hide');
  if(name==='menu'){ els.menuCoins.textContent=save.coins; buildModes(); G.state='menu'; Audio.startMenuMusic(); }
}
let toastT=null;
function toast(msg, sub){
  els.toast.innerHTML = msg + (sub?`<small>${sub}</small>`:'');
  els.toast.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>els.toast.classList.remove('show'), 2600);
}

// ---------- MODES UI ----------
function buildModes(){
  ensureDaily(); ensureMissions();
  const dDone = save.daily.done;
  els.modeGrid.innerHTML = `
    <div class="mode" data-m="campaign"><div class="mi">🗺️</div><div class="mn">Campaign</div><div class="md">7 biomes · bosses</div></div>
    <div class="mode ${dDone?'dailydone':''}" data-m="daily"><div class="badge">DAILY</div><div class="mi">📅</div><div class="mn">Daily Run</div><div class="md">${dDone?'★ Done '+save.daily.best:'One seed · one shot'}</div></div>
    <div class="mode" data-m="endless"><div class="mi">♾️</div><div class="mn">Endless</div><div class="md">Best wave ${save.endlessBest}</div></div>
    <div class="mode" data-m="howto"><div class="mi">❓</div><div class="mn">How to Play</div><div class="md">Quick guide</div></div>`;
  els.modeGrid.querySelectorAll('.mode').forEach(el=>{
    el.onclick=()=>{ const m=el.dataset.m;
      Audio.init(); Audio.resume();
      if(m==='campaign'){ buildLevelGrid(); showOverlay('levelSelect'); }
      else if(m==='daily'){ startDaily(); }
      else if(m==='endless'){ startEndless(); }
      else if(m==='howto'){ const hp=document.getElementById('howto'); hp.classList.add('show'); const cb=document.getElementById('howtoClose'); if(cb) cb.onclick=(ev)=>{ ev.stopPropagation(); hp.classList.remove('show'); }; hp.onclick=(ev)=>{ if(ev.target===hp) hp.classList.remove('show'); }; }
    };
  });
}

// ---------- level select ----------
function buildLevelGrid(){
  els.levelGrid.innerHTML='';
  LEVELS.forEach((lv,i)=>{
    const locked=(i+1)>save.unlocked; const stars=save.best[i]?.stars||0;
    const el=document.createElement('div');
    el.className='lvl'+(locked?' locked':'');
    el.innerHTML=`${locked?'<div class="lock-ico">🔒</div>':''}<div class="biome">${lv.biome}</div>
      <div class="lname">${lv.name}</div><div class="diff">${lv.diff}</div>
      <div class="stars">${'★'.repeat(stars)}${'☆'.repeat(3-stars)}</div>`;
    if(!locked) el.onclick=()=>startLevel(i,'campaign');
    els.levelGrid.appendChild(el);
  });
}

// ---------- shop ----------
const SHOP_ITEMS=[
  { key:'hammer', name:'Power Hammer', desc:'+1 smash damage. Crush tough bugs faster.', cost:120, max:2, get lvl(){return save.upgrades.hammer;}, buy(){save.upgrades.hammer++;} },
  { key:'magnet', name:'Shard Magnet', desc:'Auto-collect shard & power-up drops.', cost:150, get owned(){return save.upgrades.magnet;}, buy(){save.upgrades.magnet=true;} },
  { key:'slowmo', name:'Reflex Chip', desc:'Slow-mo power-ups last 50% longer.', cost:140, get owned(){return save.upgrades.slowmo;}, buy(){save.upgrades.slowmo=true;} },
  { key:'extraLife', name:'Spare Heart', desc:'Start every run with +1 life.', cost:200, get owned(){return save.upgrades.extraLife;}, buy(){save.upgrades.extraLife=true;} },
  { key:'coinBoost', name:'Coin Boost', desc:'+25% shards earned from every run.', cost:220, get owned(){return save.upgrades.coinBoost;}, buy(){save.upgrades.coinBoost=true;} },
  { key:'comboGuard', name:'Combo Guard', desc:'Combos last longer before they break.', cost:180, get owned(){return save.upgrades.comboGuard;}, buy(){save.upgrades.comboGuard=true;} },
  { key:'starterFrenzy', name:'Kickstart', desc:'Begin every run with a 4s 2x frenzy.', cost:240, get owned(){return save.upgrades.starterFrenzy;}, buy(){save.upgrades.starterFrenzy=true;} },
  { key:'wideMagnet', name:'Wide Magnet', desc:'Magnet grabs drops sooner and faster. (needs Shard Magnet)', cost:160, get owned(){return save.upgrades.wideMagnet;}, buy(){save.upgrades.wideMagnet=true;} },
  { key:'reinforced', name:'Reinforced Heart', desc:'Start with another +1 life. (needs Spare Heart)', cost:300, get owned(){return save.upgrades.reinforced;}, buy(){save.upgrades.reinforced=true;} },
];
function buildShop(){
  els.shopCoins.textContent=save.coins; els.shopGrid.innerHTML='';
  SHOP_ITEMS.forEach(it=>{
    const isMax=it.max?it.lvl>=it.max:it.owned;
    const canAfford=save.coins>=it.cost&&!isMax;
    const el=document.createElement('div');
    el.className='item'+(isMax?' owned':'')+(!canAfford&&!isMax?' cant':'');
    const status=it.max?`Lv ${it.lvl}/${it.max}`:(it.owned?'OWNED':'');
    el.innerHTML=`<div class="iname">${it.name}</div><div class="idesc">${it.desc}</div>
      <div class="cost">${isMax?status:'✦ '+it.cost+(it.max?`  ·  ${status}`:'')}</div>`;
    if(canAfford) el.onclick=()=>{ save.coins-=it.cost; it.buy(); persist(); buildShop(); Audio.sfx.coin(); haptic(30); };
    els.shopGrid.appendChild(el);
  });
}

// ---------- MISSIONS ----------
const MISSION_POOL=[
  { id:'smash40', title:'Exterminator', desc:'Smash 40 bugs total', goal:40, rew:60, stat:'smashRun' },
  { id:'combo8',  title:'Chain Master', desc:'Reach an 8x combo', goal:8, rew:70, stat:'comboRun' },
  { id:'wasp6',   title:'Wasp Hunter', desc:'Smash 6 wasps/hornets', goal:6, rew:80, stat:'waspRun' },
  { id:'boss1',   title:'Giant Slayer', desc:'Defeat a boss', goal:1, rew:100, stat:'bossRun' },
  { id:'noMiss',  title:'Flawless', desc:'Clear a biome without losing a life', goal:1, rew:120, stat:'flawlessRun' },
  { id:'endless10', title:'Survivor', desc:'Reach wave 10 in Endless', goal:10, rew:100, stat:'waveRun' },
  { id:'shards30', title:'Collector', desc:'Grab 30 shard drops', goal:30, rew:50, stat:'shardRun' },
];
function ensureMissions(){
  if(save.missionRerollDate!==todayStr() || !save.missions){
    const sh=[...MISSION_POOL].sort(()=>Math.random()-0.5).slice(0,3);
    save.missions = sh.map(m=>({ id:m.id, progress:0, done:false, claimed:false }));
    save.missionRerollDate=todayStr(); persist();
  }
}
function missionDef(id){ return MISSION_POOL.find(m=>m.id===id); }
async function buildLeaderboard(){
  const list = document.getElementById('lbList');
  if(!list) return;
  list.innerHTML = '<div class="mission"><div class="mtxt"><div class="mtitle">Loading…</div></div></div>';
  let data = { entries: [] };
  try { if(window.BSData && window.BSData.leaderboard) data = await window.BSData.leaderboard(); } catch(e){}
  let me = '';
  try { if(window.BSData && window.BSData.username) me = window.BSData.username(); } catch(e){}
  const rows = (data && data.entries) ? data.entries : [];
  if(!rows.length){
    list.innerHTML = '<div class="mission"><div class="mtxt"><div class="mtitle">No scores yet today</div><div class="mprog">Play a run to claim a spot!</div></div></div>';
    return;
  }
  const medals = ['🥇','🥈','🥉'];
  list.innerHTML = rows.map(function(r,i){
    const rank = medals[i] || ('#'+(i+1));
    const isMe = me && r.name===me;
    const nm = isMe ? 'You' : ('u/'+(r.name||'anon'));
    return '<div class="mission'+(isMe?' done':'')+'"><div class="mcheck">'+rank+'</div>'+
      '<div class="mtxt"><div class="mtitle">'+nm+'</div></div>'+
      '<div class="mrew">'+(r.score||0)+'</div></div>';
  }).join('');
}

function buildMissions(){
  ensureMissions();
  els.missionList.innerHTML='';
  save.missions.forEach(ms=>{
    const d=missionDef(ms.id); if(!d) return;
    const pct=Math.min(100, ms.progress/d.goal*100);
    const el=document.createElement('div');
    el.className='mission'+(ms.done?' done':'');
    el.innerHTML=`<div class="mtxt"><div class="mtitle">${d.title}</div>
      <div class="mprog">${d.desc} — ${Math.min(ms.progress,d.goal)}/${d.goal}</div>
      <div class="mbar"><i style="width:${pct}%"></i></div></div>
      <div class="mrew">${ms.done && !ms.claimed ? 'CLAIM' : (ms.claimed?'✓':'✦'+d.rew)}</div>
      <div class="mcheck">${ms.done?'✅':'🎯'}</div>`;
    if(ms.done && !ms.claimed){
      el.style.cursor='pointer';
      el.onclick=()=>{ ms.claimed=true; save.coins+=d.rew; persist(); Audio.sfx.unlock(); haptic([20,30,20]); buildMissions(); };
    }
    els.missionList.appendChild(el);
  });
  const anyClaim=save.missions.some(m=>m.done&&!m.claimed);
  els.missionSub.textContent = anyClaim ? 'Tap CLAIM to collect your reward' : 'New missions daily · complete for bonus shards';
}
// track a mission stat during a run
function trackMission(stat, val, absolute){
  save.missions.forEach(ms=>{
    const d=missionDef(ms.id); if(!d || d.stat!==stat || ms.done) return;
    ms.progress = absolute ? Math.max(ms.progress,val) : ms.progress+val;
    if(ms.progress>=d.goal){ ms.done=true; toast('MISSION COMPLETE', d.title+' · ✦'+d.rew); Audio.sfx.unlock(); haptic([20,40,20]); }
  });
}

// ---------- lives/power/boss UI ----------
function renderLives(){ els.lives.innerHTML=''; for(let i=0;i<G.maxLives;i++){ const h=document.createElement('div'); h.className='heart'+(i<G.lives?'':' gone'); els.lives.appendChild(h);} }
function renderPowers(){
  els.powerRow.innerHTML='';
  const add=t=>{ const p=document.createElement('div'); p.className='pw'; p.textContent=t; els.powerRow.appendChild(p); };
  if(G.slowmo>0) add('⏱ SLOW '+Math.ceil(G.slowmo)+'s');
  if(G.frenzy>0) add('⚡ FRENZY '+Math.ceil(G.frenzy)+'s');
  if(G.magnet) add('🧲 MAGNET');
}
function showBossBar(show){ els.bossbar.classList.toggle('show', show); }
function updateBossBar(){
  if(!G.boss){ showBossBar(false); return; }
  const bd=BOSSES[G.boss.userData.bossKey];
  els.bossName.textContent=bd.name;
  const pct=Math.max(0,G.boss.userData.hp/G.boss.userData.maxHp*100);
  els.bossHp.style.width=pct+'%';
  els.bossHpTxt.textContent=Math.max(0,G.boss.userData.hp)+' HP';
}

function updateHUD(){
  els.score.textContent=G.score; els.coins.textContent=save.coins;
  if(G.mode==='endless'){ els.scoreLabel.textContent='Score'; els.barLeft.textContent='Wave '+G.endlessWave+' · '+G.lives+' lives';
    els.barRight.textContent=G.smashed+' smashed'; els.progress.style.width=((G.smashed%10)/10*100)+'%'; }
  else { els.barLeft.textContent=G.cfg.name+' · '+Math.max(0,Math.ceil(G.time-G.elapsed))+'s';
    els.barRight.textContent = G.bossPhase?'BOSS':(G.smashed+' / '+G.need);
    els.progress.style.width=(G.bossPhase?100:Math.min(100,G.smashed/G.need*100))+'%'; }
}

// ---------- daily ----------
function ensureDaily(){ if(save.daily.date!==todayStr()){ save.daily={ date:todayStr(), done:false, best:0 }; persist(); } }
function startDaily(){
  ensureDaily();
  RNG = mulberry32(seedFromStr('bugblitz-'+todayStr()));
  G.daily=true;
  // daily uses a fixed mid-tier biome derived from seed
  const idx = Math.floor(RNG()*LEVELS.length);
  startLevel(idx,'campaign', true);
}

// ---------- endless ----------
function startEndless(){
  RNG=Math.random; G.daily=false;
  startRun('endless', 0);
}

// ---------- start helpers ----------
function startLevel(idx, mode, isDaily){
  if(!isDaily){ RNG=Math.random; G.daily=false; }
  startRun('campaign', idx);
}
function resetMissionRun(){ G.missionProgress={ smash:0, wasp:0, shard:0, boss:0, wave:0, combo:0, flawless:true }; }

function startRun(mode, idx){
  Audio.init(); Audio.resume();
  G.mode=mode; G.state='play';
  G.levelIdx=idx; G.cfg=LEVELS[idx];
  G.score=0; G.combo=0; G.comboTimer=0; G.bestComboRun=0;
  G.maxLives=3+(save.upgrades.extraLife?1:0)+(save.upgrades.reinforced?1:0); G.lives=G.maxLives;
  G.smashed=0; G.elapsed=0; G.endlessWave=1;
  G.spawnAcc=0; G.earnedCoins=0; G.slowmo=0; G.magnet=save.upgrades.magnet; G.frenzy=save.upgrades.starterFrenzy?4:0; G.multiTimer=0;
  if(G.boss){ scene.remove(G.boss); G.boss=null; }
  G.bossPhase=false; G.hitStop=0;
  showBossBar(false);
  resetMissionRun();
  // clear active bugs
  G.bugs.forEach(b=>releaseBug(b)); G.bugs=[];
  pickups.forEach(p=>scene.remove(p)); pickups.length=0;

  if(mode==='endless'){ G.need=99999; G.time=99999; G.spawnEvery=1.0; }
  else { G.need=G.cfg.need; G.time=G.cfg.time; G.spawnEvery=G.cfg.spawn; }

  scene.background=new THREE.Color(G.cfg.sky);
  scene.fog=new THREE.Fog(G.cfg.fog,18,46);
  groundMat.color.setHex(G.cfg.ground);
  { const c=new THREE.Color(G.cfg.sky); const hsl={}; c.getHSL(hsl); c.setHSL(hsl.h,Math.min(1,hsl.s+0.4),Math.min(0.7,hsl.l+0.45));
    rimTint.color.copy(c); rimTint.intensity=0.9; }
  buildDecor(G.cfg);
  Audio.startMusic(idx, mode==='endless');
  showOverlay(null);
  els.hud.classList.remove('hide'); els.topBtns.classList.remove('hide');
  showBossBar(false);
  renderLives(); renderPowers(); updateHUD();
  if(G.daily) toast('DAILY RUN', 'Seed '+todayStr());
}

// ---------- boss spawn ----------
function enterBossPhase(){
  G.bossPhase=true;
  const key=G.cfg.boss;
  G.boss=makeBoss(key);
  G.boss.position.set(0, BOSSES[key].fly?3:0.8, -8);
  G.boss.userData.vel=new THREE.Vector3((Math.random()-0.5)*0.05,0,0.02);
  scene.add(G.boss);
  Audio.setIntensity(true);
  updateBossBar(); showBossBar(true);
  toast('⚠ BOSS INCOMING', BOSSES[key].name);
  haptic([60,40,60,40,120]);
}

// ---------- spawning ----------
function chooseType(){
  const base=G.cfg.bugs.slice();
  // inject special bugs progressively / in endless
  const specialChance = G.mode==='endless' ? Math.min(0.45, 0.1+G.endlessWave*0.03) : 0.18;
  const friendlyChance = G.mode==='endless' ? 0.14 : (G.levelIdx>=2?0.12:0.06);
  const r=rand();
  if(r<friendlyChance) return 'ladybug';
  if(r<friendlyChance+specialChance){
    const pool=['splitter','armored'];
    if(G.levelIdx>=3||G.mode==='endless') pool.push('wasp');
    return pool[Math.floor(rand()*pool.length)];
  }
  return base[Math.floor(rand()*base.length)];
}
function spawnBug(forceType, atPos){
  const type=forceType||chooseType();
  const bug=getBug(type);
  const R=12; let x,z;
  if(atPos){ x=atPos.x; z=atPos.z; }
  else { const edge=Math.floor(rand()*4);
    if(edge===0){x=-R;z=(rand()-0.5)*14;} else if(edge===1){x=R;z=(rand()-0.5)*14;}
    else if(edge===2){x=(rand()-0.5)*18;z=-10;} else {x=(rand()-0.5)*18;z=9;} }
  const flying=bug.userData.spec.fly;
  bug.position.set(x, flying?2.2+rand()*1.5:0.5, z);
  const tx=(rand()-0.5)*8, tz=(rand()-0.5)*8;
  const dir=new THREE.Vector3(tx-x,0,tz-z).normalize();
  const speedScale = G.mode==='endless' ? 1+G.endlessWave*0.04 : G.cfg.speed;
  const base=0.020*speedScale*bug.userData.spec.sp;
  bug.userData.vel=dir.multiplyScalar(base);
  bug.userData.baseY=bug.position.y; bug.userData.turnT=1+rand()*2; bug.userData.lifeT=0;
  scene.add(bug); G.bugs.push(bug);
  return bug;
}

// ---------- hit detection ----------
const raycaster=new THREE.Raycaster(); const pointer=new THREE.Vector2();
function findBugFromHit(obj){
  // walk up the parent chain to the bug group that carries spec/hp
  let o=obj;
  while(o){ if(o.userData && (o.userData.spec || o.userData.isBoss)) return o; o=o.parent; }
  return null;
}
function handleTap(cx,cy){
  if(G.state!=='play') return;
  Audio.resume();
  camera.updateMatrixWorld();
  pointer.x=(cx/innerWidth)*2-1; pointer.y=-(cy/innerHeight)*2+1;
  raycaster.setFromCamera(pointer,camera);
  // ensure world matrices are current (pooled bugs may be freshly placed this frame)
  const targets=[];
  if(G.boss&&G.boss.userData.alive){ G.boss.updateMatrixWorld(true); targets.push(G.boss); }
  for(const b of G.bugs){ if(b.userData.alive && b.userData.dying===undefined){ b.updateMatrixWorld(true); targets.push(b); } }
  // recursive raycast against the groups themselves — robust to child structure
  const hits=raycaster.intersectObjects(targets,true);
  if(hits.length){
    const bug=findBugFromHit(hits[0].object);
    if(bug){ smashBug(bug,hits[0].point); return; }
  }
  Audio.sfx.miss(); G.combo=0; els.combo.classList.remove('show');
}

function addScore(n){ G.score+=n; }
function comboMult(){ return 1+Math.floor(G.combo/3); }

function smashBug(bug, point){
  const u=bug.userData;
  // FRIENDLY: penalty
  if(u.spec.friendly){
    Audio.sfx.friendly(); haptic(60);
    G.combo=0; els.combo.classList.remove('show');
    G.score=Math.max(0,G.score-30);
    G.missionProgress.flawless=false;
    spawnBurst(point,0xff5555);
    els.flash.style.background='#ffcc33'; els.flash.style.opacity='0.3'; setTimeout(()=>els.flash.style.opacity='0',80);
    // it flees fast
    u.vel.multiplyScalar(2.4);
    toast('OUCH! Friendly bug', '-30 points');
    updateHUD();
    return;
  }
  // BOSS
  if(u.isBoss){
    const dmg=1+save.upgrades.hammer;
    u.hp-=dmg; Audio.sfx.bossHit(); haptic(25);
    G.hitStop=0.04; camPunch(0.5);
    bug.scale.multiplyScalar(0.985);
    spawnBurst(point, BOSSES[u.bossKey].accent||0xff6644);
    updateBossBar();
    if(u.hp<=0){ defeatBoss(); }
    return;
  }
  // ARMORED: needs a beat / hammer; first hit clanks
  if(u.spec.armored && !u.cracked){
    if(save.upgrades.hammer>0){ u.cracked=true; /* hammer cracks instantly, fall through to kill */ }
    else { u.cracked=true; Audio.sfx.clank(); haptic(15); camPunch(0.2); spawnBurst(point,0x99b0c0); bug.scale.multiplyScalar(0.95); return; }
  }
  const dmg=1+save.upgrades.hammer;
  u.hp-=dmg;
  if(u.hp>0 && !u.spec.armored){ Audio.sfx.tough(); haptic(20); bug.scale.multiplyScalar(0.9); spawnBurst(point,u.spec.accent); return; }

  // KILL
  killBug(bug, point);
}

function killBug(bug, point){
  const u=bug.userData;
  u.alive=false;
  const pts=u.spec.pts;
  G.combo++; G.comboTimer=save.upgrades.comboGuard?2.2:1.6; G.bestComboRun=Math.max(G.bestComboRun,G.combo);
  const mult=comboMult(); const fMult=G.frenzy>0?2:1;
  addScore(pts*mult*fMult);
  G.smashed++; save.stats.totalSmashed++;
  G.missionProgress.smash++;
  if(u.type==='wasp'){ save.stats.wasps++; G.missionProgress.wasp++; }
  G.missionProgress.combo=Math.max(G.missionProgress.combo,G.combo);

  // hit-stop + squash juice
  G.hitStop=0.035; camPunch(0.35);
  spawnBurst(point,u.spec.color); spawnBurst(point,0xffffff);
  Audio.sfx.squish();
  if(G.combo>=3){ Audio.sfx.combo(Math.min(G.combo,8)); els.combo.textContent='COMBO x'+mult; els.combo.classList.add('show'); }
  haptic(G.combo>=5?[15,20,15]:15);

  // SPLITTER: spawn two larvae
  if(u.spec.splits){
    for(let i=0;i<2;i++){ const child=spawnBug('larva', { x:bug.position.x+(i?0.6:-0.6), z:bug.position.z });
      child.userData.vel.set((i?1:-1)*0.06,0,(rand()-0.5)*0.06); }
    toast('IT SPLIT!', 'Get the larvae');
  }

  // drops
  const roll=rand();
  if(roll<0.12) spawnPickup(bug.position.clone(),'shard');
  else if(roll<0.16) spawnPickup(bug.position.clone(),'slowmo');
  else if(roll<0.19) spawnPickup(bug.position.clone(),'frenzy');
  else if(roll<0.215) spawnPickup(bug.position.clone(),'multi');
  else if(roll<0.235 && G.lives<G.maxLives) spawnPickup(bug.position.clone(),'life');

  u.dying=0.12;
  updateHUD();

  // endless wave progression
  if(G.mode==='endless'){
    if(G.smashed % 10 === 0){ G.endlessWave++; G.missionProgress.wave=G.endlessWave;
      toast('WAVE '+G.endlessWave, '+1 life'); if(G.lives<G.maxLives){G.lives++; renderLives();}
      Audio.sfx.unlock(); Audio.setIntensity(G.endlessWave>=4);
    }
  } else {
    // campaign: reaching quota triggers boss phase (not instant win)
    if(!G.bossPhase && G.smashed>=G.need){ enterBossPhase(); }
  }
}

function defeatBoss(){
  const bd=BOSSES[G.boss.userData.bossKey];
  G.boss.userData.alive=false;
  addScore(bd.pts * comboMult());
  save.stats.bosses++; G.missionProgress.boss=1;
  Audio.sfx.bossDie(); camPunch(1.5); G.hitStop=0.12; haptic([40,60,40,60,120]);
  // big particle finale
  for(let i=0;i<6;i++) setTimeout(()=>spawnBurst(G.boss.position.clone().add(new THREE.Vector3((Math.random()-0.5)*3,Math.random()*3,(Math.random()-0.5)*3)), bd.accent||0xff8844), i*60);
  // drop a bounty
  for(let i=0;i<4;i++) spawnPickup(G.boss.position.clone().add(new THREE.Vector3((Math.random()-0.5)*3,0,(Math.random()-0.5)*3)),'shard');
  scene.remove(G.boss); G.boss=null; showBossBar(false); Audio.setIntensity(false);
  setTimeout(()=>endLevel(true), 900);
}

// ---------- pickups POOL ----------
const pickups=[]; const pickupPool=[];
const pickColors={ shard:0xffd76a, slowmo:0x66ccff, frenzy:0xff66cc, multi:0xff9ecb, life:0xff5d73 };
function spawnPickup(pos,kind){
  let g=pickupPool.pop();
  if(!g){ const m=new THREE.Mesh(GEO.octa, new THREE.MeshStandardMaterial({ metalness:0.5, roughness:0.2 }));
    const light=new THREE.PointLight(0xffffff,1.2,5); g=new THREE.Group(); g.add(m); g.add(light); }
  const mesh=g.children[0], light=g.children[1];
  mesh.material.color.setHex(pickColors[kind]); mesh.material.emissive.setHex(pickColors[kind]); mesh.material.emissiveIntensity=0.6;
  light.color.setHex(pickColors[kind]);
  g.position.copy(pos); g.position.y=1.2; g.userData={ kind, t:0 };
  scene.add(g); pickups.push(g);
}
function collectPickup(p){
  const k=p.userData.kind;
  if(k==='shard'){ save.coins+=5; G.missionProgress.shard++; Audio.sfx.coin(); }
  else if(k==='slowmo'){ G.slowmo=save.upgrades.slowmo?9:6; Audio.sfx.power(); }
  else if(k==='frenzy'){ G.frenzy=6; Audio.sfx.power(); }
  else if(k==='multi'){ G.multiTimer=8; els.multiTxt.classList.add('show'); Audio.sfx.power(); toast('MULTI-SMASH','Tap hits nearby bugs'); }
  else if(k==='life'){ if(G.lives<G.maxLives){G.lives++; renderLives();} Audio.sfx.power(); }
  haptic(25);
  scene.remove(p); const i=pickups.indexOf(p); if(i>=0) pickups.splice(i,1);
  if(pickupPool.length<20) pickupPool.push(p);
  renderPowers(); updateHUD();
}

function bugEscaped(bug){
  releaseBug(bug);
  const i=G.bugs.indexOf(bug); if(i>=0) G.bugs.splice(i,1);
  if(bug.userData.alive && !bug.userData.spec.friendly){
    G.lives--; G.combo=0; els.combo.classList.remove('show'); renderLives();
    G.missionProgress.flawless=false;
    Audio.sfx.hurt(); haptic(80);
    els.flash.style.background='#ff3b3b'; els.flash.style.opacity='0.4'; setTimeout(()=>els.flash.style.opacity='0',80);
    if(G.lives<=0) endLevel(false);
  }
}

// ---------- end ----------
function endLevel(win){
  G.state='over'; Audio.stopMusic(); Audio.setIntensity(false);
  showBossBar(false); els.multiTxt.classList.remove('show');
  // commit mission stats
  trackMission('smashRun', G.missionProgress.smash, false);
  trackMission('waspRun', G.missionProgress.wasp, false);
  trackMission('shardRun', G.missionProgress.shard, false);
  trackMission('comboRun', G.missionProgress.combo, true);
  trackMission('bossRun', G.missionProgress.boss, false);
  trackMission('waveRun', G.endlessWave, true);
  if(win && G.missionProgress.flawless && G.mode==='campaign') trackMission('flawlessRun', 1, false);
  save.stats.bestCombo=Math.max(save.stats.bestCombo,G.bestComboRun);

  showOverlay('endScreen');
  let stars=0;
  if(G.mode==='endless'){
    els.endTitle.textContent='SWARMED'; els.endTitle.style.color='#ff8b8b';
    save.endlessBest=Math.max(save.endlessBest,G.endlessWave);
    els.endStars.textContent='Reached Wave '+G.endlessWave+' · '+G.smashed+' bugs';
    G.earnedCoins=Math.floor(G.score/10)+G.endlessWave*10;
    els.nextBtn.style.display='none';
  } else if(win){
    const ratio=G.lives/G.maxLives;
    stars=1; if(G.score>=G.need*20) stars=2; if(ratio===1&&G.score>=G.need*28) stars=3;
    els.endTitle.textContent='BIOME CLEARED'; els.endTitle.style.color='#c9ff9e';
    Audio.sfx.win(); haptic([40,60,40,60,120]);
    if(G.levelIdx+1>=save.unlocked && G.levelIdx+1<LEVELS.length){ save.unlocked=G.levelIdx+2; toast('UNLOCKED', LEVELS[G.levelIdx+1].name); Audio.sfx.unlock(); }
    const prev=save.best[G.levelIdx]?.stars||0;
    save.best[G.levelIdx]={ stars:Math.max(prev,stars), score:Math.max(save.best[G.levelIdx]?.score||0,G.score) };
    els.endStars.textContent='★'.repeat(stars)+'☆'.repeat(3-stars);
    G.earnedCoins=Math.floor(G.score/10)+G.need*2+stars*15;
    els.nextBtn.style.display=(G.levelIdx+1<LEVELS.length)?'':'none';
    if(G.daily){ save.daily.done=true; save.daily.best=Math.max(save.daily.best,G.score); els.nextBtn.style.display='none'; }
  } else {
    els.endTitle.textContent = G.lives<=0?'SWARMED':'TIME!'; els.endTitle.style.color='#ff8b8b';
    els.endStars.textContent='Bugs smashed: '+G.smashed+' / '+G.need;
    G.earnedCoins=Math.floor(G.score/10);
    els.nextBtn.style.display='none';
    if(G.daily){ save.daily.done=true; save.daily.best=Math.max(save.daily.best,G.score); }
  }
  Audio.sfx[win&&G.mode!=='endless'?'win':'lose']();
  if(save.upgrades.coinBoost) G.earnedCoins=Math.round(G.earnedCoins*1.25);
  save.coins+=G.earnedCoins;
  persist();
  submitScore(G.mode, G.score, G.endlessWave); // feeds the daily leaderboard when on Reddit
  els.finalScore.textContent=G.score; els.earnedCoins.textContent=G.earnedCoins; { const db=document.getElementById('doubleBtn'); if(db){ db.disabled=false; db.style.display=window.BSAds?'block':'none'; db.textContent='🎬 Watch → Double Shards'; } }
  RNG=Math.random; // reset seed after run
}

// ---------- camera punch (juice) ----------
let camPunchV=0;
function camPunch(amt){ camPunchV=Math.max(camPunchV,amt); }

// ---------- input ----------
function safeTap(cx,cy){ try { handleTap(cx,cy); } catch(err){ /* never let one bad tap kill input */ } }
// Primary: pointer events (covers mouse + touch on modern browsers)
if(window.PointerEvent){
  canvas.addEventListener('pointerdown', e=>{ safeTap(e.clientX,e.clientY); }, {passive:true});
} else {
  // Fallback for older browsers: mouse + touch
  canvas.addEventListener('mousedown', e=>{ safeTap(e.clientX,e.clientY); }, {passive:true});
  canvas.addEventListener('touchstart', e=>{ const t=e.changedTouches[0]; if(t) safeTap(t.clientX,t.clientY); }, {passive:true});
}
els.muteBtn.onclick=()=>{ const m=!Audio.muted; Audio.setMuted(m); els.muteBtn.textContent=m?'🔇':'🔊'; };
function quitToMenu(){ Audio.stopMusic(); Audio.setIntensity(false); if(G.boss){ scene.remove(G.boss); G.boss=null; } G.bossPhase=false; G.hitStop=0; showBossBar(false); G.bugs.forEach(b=>releaseBug(b)); G.bugs=[]; pickups.forEach(p=>scene.remove(p)); pickups.length=0; G.state='menu'; showOverlay('menu'); }
els.quitBtn.onclick=()=>quitToMenu();
$('shopBtn').onclick=()=>{ buildShop(); showOverlay('shopScreen'); };
$('missionsBtn').onclick=()=>{ buildMissions(); showOverlay('missionScreen'); };
{ const lbBtn=document.getElementById('leaderboardBtn'); if(lbBtn) lbBtn.onclick=()=>{
    ['menu','levelSelect','shopScreen','missionScreen','endScreen'].forEach(id=>{ const e=document.getElementById(id); if(e) e.classList.add('hide'); });
    const ls=document.getElementById('leaderboardScreen'); if(ls) ls.classList.remove('hide');
    buildLeaderboard();
  }; }
{ const bfl=document.getElementById('backFromLeaderboard'); if(bfl) bfl.onclick=()=>{ const ls=document.getElementById('leaderboardScreen'); if(ls) ls.classList.add('hide'); showOverlay('menu'); }; }
$('backFromLevels').onclick=()=>showOverlay('menu');
$('backFromShop').onclick=()=>showOverlay('menu');
$('backFromMissions').onclick=()=>showOverlay('menu');
$('retryBtn').onclick=()=>{ if(G.mode==='endless') startEndless(); else if(G.daily && save.daily.done){ showOverlay('menu'); } else startLevel(G.levelIdx,'campaign', G.daily); };
$('nextBtn').onclick=()=>{ if(window.BSAds){ window.BSAds.midgame(()=>startLevel(Math.min(G.levelIdx+1,LEVELS.length-1),'campaign')); } else { startLevel(Math.min(G.levelIdx+1,LEVELS.length-1),'campaign'); } };
$('menuBtn').onclick=()=>showOverlay('menu');
$('doubleBtn').onclick=()=>{ if(!window.BSAds) return; $('doubleBtn').disabled=true; $('doubleBtn').textContent='Loading ad…'; window.BSAds.rewarded(()=>{ save.coins+=G.earnedCoins; G.earnedCoins*=2; persist(); els.earnedCoins.textContent=G.earnedCoins; $('doubleBtn').textContent='✓ Shards doubled!'; }, ()=>{ $('doubleBtn').disabled=false; $('doubleBtn').textContent='🎬 Watch → Double Shards'; }); };
{ const _hc=document.getElementById('howtoClose'); if(_hc) _hc.onclick=()=>{ const h=document.getElementById('howto'); if(h) h.classList.remove('show'); }; }
addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });

// ---------- multi-smash AoE ----------
function multiSmashAoE(center){
  for(let i=G.bugs.length-1;i>=0;i--){ const b=G.bugs[i]; if(!b.userData.alive||b.userData.spec.friendly) continue;
    if(b.position.distanceTo(center)<3.2){ b.userData.hp=0; killBug(b,b.position.clone()); } }
}

// ---------- adaptive quality ----------
let frameSamples=[], lastQualityCheck=0;
function adaptQuality(dt){
  frameSamples.push(dt); if(frameSamples.length>60) frameSamples.shift();
  const t=performance.now();
  if(t-lastQualityCheck<2000) return; lastQualityCheck=t;
  const avg=frameSamples.reduce((a,b)=>a+b,0)/frameSamples.length;
  const fps=1/avg;
  if(fps<40 && QUALITY>1){ QUALITY=1; renderer.setPixelRatio(1); renderer.shadowMap.enabled=false; renderer.shadowMap.needsUpdate=true; }
  els.fps.textContent=Math.round(fps)+' fps';
}

// ---------- main loop ----------
let last=performance.now();
function tick(nowMs){
  requestAnimationFrame(tick);
  let dt=Math.min((nowMs-last)/1000,0.05); last=nowMs;
  adaptQuality(dt);

  // hit-stop freezes gameplay briefly for impact
  if(G.hitStop>0){ G.hitStop-=dt; updateBursts(dt); doCamera(dt); if(G.state==='play'||G.state==='over') renderer.render(scene,camera); return; }

  const slow=G.slowmo>0?0.45:1; 
  updateBursts(dt);

  if(G.state==='play'){
    G.elapsed+=dt;
    if(G.comboTimer>0){ G.comboTimer-=dt; if(G.comboTimer<=0){ G.combo=0; els.combo.classList.remove('show'); } }
    let pc=false;
    if(G.slowmo>0){ const b=G.slowmo; G.slowmo-=dt; if(Math.ceil(b)!==Math.ceil(G.slowmo)||G.slowmo<=0) pc=true; }
    if(G.frenzy>0){ const b=G.frenzy; G.frenzy-=dt; if(Math.ceil(b)!==Math.ceil(G.frenzy)||G.frenzy<=0) pc=true; }
    if(G.multiTimer>0){ G.multiTimer-=dt; if(G.multiTimer<=0) els.multiTxt.classList.remove('show'); }
    if(pc) renderPowers();

    if(G.mode!=='endless'){
      const rem=G.time-G.elapsed;
      if(rem<=5 && Math.ceil(rem)!==Math.ceil(rem+dt)) Audio.sfx.tick();
      if(rem<=0 && !G.bossPhase){ endLevel(G.smashed>=G.need); }
      if(rem<=0 && G.bossPhase){ /* boss phase ignores timer; must kill boss */ }
    }

    // spawning (pause normal spawns during boss except boss adds)
    if(!G.bossPhase){
      G.spawnAcc+=dt;
      const prog = G.mode==='endless' ? Math.min(0.6, G.endlessWave*0.04) : (1-G.elapsed/G.time);
      const rate=G.spawnEvery*(0.92+0.25*prog);
      if(G.spawnAcc>=rate){ G.spawnAcc=0; spawnBug(); if(prog>0.33 && rand()<0.15) spawnBug(); }
    }

    // boss update
    if(G.boss && G.boss.userData.alive){
      const b=G.boss, u=b.userData; u.t+=dt*4;
      // move slowly, drift, flying bob
      u.vel.x += (Math.sin(u.t*0.5))*0.0006;
      b.position.x+=u.vel.x*slow*60*dt; 
      if(b.position.x>10||b.position.x<-10) u.vel.x*=-1;
      if(BOSSES[u.bossKey].fly){ b.position.y=3+Math.sin(u.t)*0.6; }
      b.rotation.y=Math.atan2(-u.vel.x,-0.3);
      // periodic minion spawns
      u.spawnAcc+=dt;
      if(u.spawnAcc>2.4){ u.spawnAcc=0; spawnBug(BOSSES[u.bossKey].spawns, { x:b.position.x, z:b.position.z }); }
      b.children.forEach(c=>{ if(c.geometry===GEO.wing){} });
      // gentle pulse
      const pulse=1+Math.sin(u.t*3)*0.02; b.scale.setScalar(BOSSES[u.bossKey].scale*pulse);
    }

    // bug update
    for(let i=G.bugs.length-1;i>=0;i--){
      const b=G.bugs[i], u=b.userData;
      u.t+=slow*dt*6; u.lifeT+=dt;
      if(u.dying!==undefined){ u.dying-=dt; b.scale.multiplyScalar(0.72); if(u.dying<=0){ releaseBug(b); G.bugs.splice(i,1);} continue; }
      u.turnT-=dt;
      if(u.turnT<=0){ u.turnT=1+rand()*2; const ang=Math.atan2(u.vel.z,u.vel.x)+(rand()-0.5)*1.2; const spd=u.vel.length(); u.vel.set(Math.cos(ang)*spd,0,Math.sin(ang)*spd); }
      if(u.spec.aggressive){ const toC=new THREE.Vector3(-b.position.x,0,-b.position.z).normalize().multiplyScalar(u.vel.length()*0.4); u.vel.lerp(u.vel.clone().add(toC).setLength(u.vel.length()),0.05); }
      const step=slow*dt*60;
      b.position.x+=u.vel.x*step; b.position.z+=u.vel.z*step;
      b.rotation.y=Math.atan2(-u.vel.x,-u.vel.z);
      if(u.spec.fly){ b.position.y=u.baseY+Math.sin(u.t)*0.35; u.wings.forEach((w,wi)=>{ w.rotation.z=(wi===0?1:-1)*(0.3+Math.sin(u.t*4)*0.9); }); }
      else { b.position.y=0.5+Math.abs(Math.sin(u.t))*0.06; u.legs.forEach(l=>{ l.mesh.rotation.x=0.3+Math.sin(u.t+l.phase)*0.4; }); }
      if(Math.abs(b.position.x)>13||b.position.z<-11||b.position.z>10) bugEscaped(b);
    }

    // pickups
    for(let i=pickups.length-1;i>=0;i--){
      const p=pickups[i]; p.userData.t+=dt;
      p.children[0].rotation.y+=dt*3; p.children[0].rotation.x+=dt*1.5;
      p.position.y=1.2+Math.sin(p.userData.t*3)*0.15;
      if(p.userData.t>7){ scene.remove(p); pickups.splice(i,1); if(pickupPool.length<20) pickupPool.push(p); continue; }
      if(G.magnet && p.userData.t>(save.upgrades.wideMagnet?0.2:0.5)){ collectPickup(p); }
    }

    updateHUD();
  }

  doCamera(dt);
  if(G.state==='play' || G.state==='over'){
    canvas.style.visibility='visible';
    renderer.render(scene,camera);
  } else {
    canvas.style.visibility='hidden';
  }
}

function doCamera(dt){
  // frenzy shake + camera punch decay
  camPunchV*=Math.pow(0.001,dt);
  const shake = (G.frenzy>0?0.12:0) ;
  camera.position.x = CAM_BASE.x + Math.sin(performance.now()*0.03)*shake + (Math.random()-0.5)*camPunchV*0.4;
  camera.position.y = CAM_BASE.y + (Math.random()-0.5)*camPunchV*0.3;
  camera.position.z = CAM_BASE.z - camPunchV*0.2;
  camera.lookAt(0,0,0);
}

// Multi-smash: when the power-up is active, each tap also hits nearby bugs.
// Uses a separate raycaster/pointer so it never disturbs the primary tap handler.
const mPointer=new THREE.Vector2(); const mRay=new THREE.Raycaster();
const mPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-0.5);
function multiSmashHandler(cx,cy){
  if(G.state!=='play' || G.multiTimer<=0) return;
  try {
    mPointer.x=(cx/innerWidth)*2-1; mPointer.y=-(cy/innerHeight)*2+1;
    mRay.setFromCamera(mPointer,camera);
    const groundHit=new THREE.Vector3();
    if(mRay.ray.intersectPlane(mPlane,groundHit)) multiSmashAoE(groundHit);
  } catch(err){}
}
if(window.PointerEvent){
  canvas.addEventListener('pointerdown', e=>multiSmashHandler(e.clientX,e.clientY), {passive:true});
} else {
  canvas.addEventListener('mousedown', e=>multiSmashHandler(e.clientX,e.clientY), {passive:true});
  canvas.addEventListener('touchstart', e=>{ const t=e.changedTouches[0]; if(t) multiSmashHandler(t.clientX,t.clientY); }, {passive:true});
}

// initial scene (safe to build immediately)
scene.background=new THREE.Color(LEVELS[0].sky);
scene.fog=new THREE.Fog(LEVELS[0].fog,18,46);
buildDecor(LEVELS[0]);

// Boot: load saved progress (from Reddit if available, else localStorage),
// then show the menu and start the render loop.
function boot(){
  buildModes();
  showOverlay('menu');
  requestAnimationFrame(tick);
  let menuMusicStarted=false;
  function kickstartAudio(){ if(menuMusicStarted) return; menuMusicStarted=true; Audio.init(); Audio.resume(); if(G.state==='menu') Audio.startMenuMusic(); }
  ['pointerdown','touchstart','keydown','click'].forEach(ev=>document.addEventListener(ev, kickstartAudio, { passive:true }));
}
if (window.BSData) {
  window.BSData.load().then(loaded=>{ if(loaded) save = deepMerge(save, loaded); boot(); })
    .catch(()=>{ try{ const s=JSON.parse(localStorage.getItem(SAVE_KEY)); if(s) save=deepMerge(save,s);}catch(e){} boot(); });
} else {
  try{ const s=JSON.parse(localStorage.getItem(SAVE_KEY)); if(s) save=deepMerge(save,s);}catch(e){}
  boot();
}