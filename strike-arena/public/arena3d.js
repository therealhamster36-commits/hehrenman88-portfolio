/* STRIKE ARENA 3D — render-only view of the authoritative multiplayer state. */
import * as THREE from '/three.module.js';
const SX=.1;
const pitchX=52.8,pitchZ=28.4;
const TEAM_COLORS=[0x227af5,0xeb4054];
const xy=(x,y)=>[(x-600)*SX,(y-360)*SX];
const shadowMat=new THREE.MeshStandardMaterial({color:0x121920,roughness:.88});
const white=new THREE.MeshStandardMaterial({color:0xf8f9f5,roughness:.44,metalness:.04});
function material(color,roughness=.76,metalness=0){return new THREE.MeshStandardMaterial({color,roughness,metalness});}
function cube(w,h,d,mat){return new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);}
function cylinder(radiusTop,radiusBottom,height,mat,n=10){return new THREE.Mesh(new THREE.CylinderGeometry(radiusTop,radiusBottom,height,n),mat);}
function sphere(radius,mat,segments=16){return new THREE.Mesh(new THREE.SphereGeometry(radius,segments,12),mat);}
function ribbon(x1,z1,x2,z2,y,width,color){
 const dx=x2-x1,dz=z2-z1,len=Math.hypot(dx,dz);
 const mesh=cube(len,.035,width,material(color,.9));mesh.position.set((x1+x2)/2,y,(z1+z2)/2);mesh.rotation.y=-Math.atan2(dz,dx);return mesh;
}
function textSprite(label,options={}){
 const c=document.createElement('canvas');c.width=512;c.height=128;
 const ctx=c.getContext('2d');ctx.fillStyle=options.dark?'#15202a':'#0b1620';
 ctx.roundRect(10,10,492,102,21);ctx.fill();ctx.strokeStyle=options.team===0?'#6ac2ff':options.team===1?'#ff8795':'#ffffff90';ctx.lineWidth=5;ctx.stroke();
 ctx.fillStyle='#ffffff';ctx.font='800 42px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label.slice(0,18),256,67,455);
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
 const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));sp.scale.set(3.1,.77,1);return sp;
}
class Footballer {
 constructor(team,slot,isBot,name){
  this.team=team;this.slot=slot;this.name=name;this.group=new THREE.Group();this.group.name='Footballer';
  const kit=material(TEAM_COLORS[team],.7),boots=material(0x111b24,.4),skin=material(team===0?0xcfa277:0xb88469),socks=material(team===0?0xffffff:0xffecee),shorts=material(team===0?0x102f68:0x501c32);
  const shade=cylinder(.45,.48,.14,new THREE.MeshBasicMaterial({color:0x0c1514,transparent:true,opacity:.22}),20);shade.scale.z=1.5;shade.position.y=.05;this.group.add(shade);
  const body=cube(.79,1.02,.43,kit);body.position.y=1.75;body.castShadow=true;this.group.add(body);
  const chest=cube(.68,.14,.45,material(team===0?0xe5f9ff:0xffe0e6));chest.position.y=2.05;this.group.add(chest);
  const pants=cube(.75,.46,.45,shorts);pants.position.y=1.10;pants.castShadow=true;this.group.add(pants);
  this.leftLeg=new THREE.Group();this.rightLeg=new THREE.Group();
  for(const [g,sgn] of [[this.leftLeg,-1],[this.rightLeg,1]]){
   g.position.set(sgn*.23,.9,0);const leg=cylinder(.145,.16,.68,skin);leg.position.y=-.34;leg.castShadow=true;g.add(leg);
   const sock=cylinder(.17,.16,.27,socks);sock.position.y=-.6;g.add(sock);
   const boot=cube(.33,.18,.56,boots);boot.position.set(0,-.82,.15);boot.castShadow=true;g.add(boot);this.group.add(g);
  }
  const neck=cylinder(.16,.17,.16,skin);neck.position.y=2.35;this.group.add(neck);
  const head=sphere(.31,skin);head.position.y=2.64;head.castShadow=true;this.group.add(head);
  const hair=sphere(.322,material(team===0?0x171d2b:0x33251f));hair.scale.set(1,.35,1);hair.position.y=2.83;this.group.add(hair);
  this.leftArm=new THREE.Group();this.rightArm=new THREE.Group();
  for(const [g,sgn] of [[this.leftArm,-1],[this.rightArm,1]]){
    g.position.set(sgn*.54,2.08,0);
    const sleeve=cylinder(.2,.19,.32,kit);sleeve.position.y=-.16;g.add(sleeve);
    const hand=cylinder(.13,.13,.45,skin);hand.position.y=-.5;g.add(hand);this.group.add(g);
  }
  const badge=textSprite(slot===0?'TW · '+name:name,{team});badge.position.set(0,3.56,0);this.group.add(badge);this.badge=badge;
  const halo=new THREE.Mesh(new THREE.RingGeometry(.62,.72,32),new THREE.MeshBasicMaterial({color:0x32f2c0,transparent:true,opacity:.95,side:THREE.DoubleSide}));
  halo.rotation.x=-Math.PI/2;halo.position.y=.07;halo.visible=false;this.group.add(halo);this.halo=halo;
 }
 update(p,dt,isMe,selected){
  const [x,z]=xy(p.x,p.y);const prev=this.group.position.clone();
  if(!this.initial){this.group.position.set(x,0,z);this.initial=true;}
  else if(Math.abs(this.group.position.x-x)+Math.abs(this.group.position.z-z)>18)this.group.position.set(x,0,z);
  else this.group.position.lerp(new THREE.Vector3(x,0,z),Math.min(1,dt*12));
  const facing=p.facing||{x:p.team===0?1:-1,y:0};this.group.rotation.y=Math.atan2(facing.y,facing.x)-Math.PI/2;
  const running=Math.hypot(p.vx||0,p.vy||0)>70;
  this.phase=(this.phase||0)+dt*(running?12:3);
  const swing=running?Math.sin(this.phase)*.58:Math.sin(this.phase)*.035;
  this.leftLeg.rotation.x=swing;this.rightLeg.rotation.x=-swing;
  this.leftArm.rotation.x=-swing*.72;this.rightArm.rotation.x=swing*.72;
  this.halo.visible=isMe||selected;this.halo.material.color.setHex(isMe?0x35f5b7:0xffe194);
 }
 dispose(){this.group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(o.material.map)o.material.map.dispose();o.material.dispose();}});}
}
function makeGrass(){
 const c=document.createElement('canvas');c.width=1024;c.height=640;const ctx=c.getContext('2d');
 let seed=1;function rnd(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
 for(let i=0;i<12;i++){ctx.fillStyle=i%2?'#326e3b':'#3e7946';ctx.fillRect(i*c.width/12,0,c.width/12+1,c.height);}
 for(let i=0;i<18000;i++){const x=rnd()*1024,y=rnd()*640;ctx.fillStyle=rnd()>.5?'#ffffff08':'#071e100c';ctx.fillRect(x,y,1+rnd()*3,1+rnd()*6);}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
}
function makeAd(label,color){const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1024,128);ctx.fillStyle='#fff';ctx.font='bold 68px system-ui';ctx.textAlign='center';ctx.fillText(label,512,91);const tx=new THREE.CanvasTexture(c);tx.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshStandardMaterial({map:tx,emissive:color,emissiveIntensity:.16});}
export class StrikeArena3D {
 constructor(container){
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x0a131c);this.scene.fog=new THREE.FogExp2(0x0a131c,.009);
  this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
  this.renderer.setSize(container.clientWidth||900,container.clientHeight||520);
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.27;
  this.renderer.outputColorSpace=THREE.SRGBColorSpace;
  this.renderer.domElement.className='arena-three-canvas';this.renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:none;touch-action:none;';
  container.insertBefore(this.renderer.domElement,container.firstChild);
  this.camera=new THREE.PerspectiveCamera(56,1,.3,460);this.camera.position.set(-10,22,45);
  this.cameraTarget=new THREE.Vector3(0,0,0);this.players=new Map();
  this.installScene();this.resize();
  if('ResizeObserver'in window){this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);}else window.addEventListener('resize',()=>this.resize());
 }
 resize(){const c=this.renderer.domElement.parentElement;if(!c)return;const w=Math.max(320,c.clientWidth),h=Math.max(210,c.clientHeight);this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 setVisible(v){this.renderer.domElement.style.display=v?'block':'none';}
 installScene(){const s=this.scene;
  s.add(new THREE.HemisphereLight(0xc9eaff,0x172f22,2.4));
  const sunlight=new THREE.DirectionalLight(0xfff7de,3.1);sunlight.position.set(-44,82,53);sunlight.castShadow=true;sunlight.shadow.mapSize.set(2048,2048);sunlight.shadow.camera.left=-80;sunlight.shadow.camera.right=80;sunlight.shadow.camera.top=70;sunlight.shadow.camera.bottom=-70;sunlight.shadow.normalBias=.025;s.add(sunlight);
  const ground=cube(150,1.3,112,material(0x0d2a21));ground.position.y=-1.1;ground.receiveShadow=true;s.add(ground);
  const grass=new THREE.Mesh(new THREE.PlaneGeometry(105.6,56.8),new THREE.MeshStandardMaterial({map:makeGrass(),roughness:1,metalness:0}));grass.rotation.x=-Math.PI/2;grass.receiveShadow=true;grass.position.y=.014;s.add(grass);
  const addLine=(x1,z1,x2,z2,w=.2)=>s.add(ribbon(x1,z1,x2,z2,.046,w,0xf7f9ec));
  addLine(-pitchX,-pitchZ,pitchX,-pitchZ);addLine(-pitchX,pitchZ,pitchX,pitchZ);
  addLine(-pitchX,-pitchZ,-pitchX,pitchZ);addLine(pitchX,-pitchZ,pitchX,pitchZ);addLine(0,-pitchZ,0,pitchZ);
  for(const sign of [-1,1]){
   const near=sign*pitchX,box=near-sign*16.5,small=near-sign*5.8;
   addLine(box,-20.1,box,20.1);addLine(box,-20.1,near,-20.1);addLine(box,20.1,near,20.1);
   addLine(small,-9.1,small,9.1);addLine(small,-9.1,near,-9.1);addLine(small,9.1,near,9.1);
   const dot=new THREE.Mesh(new THREE.CircleGeometry(.38,16),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}));dot.rotation.x=-Math.PI/2;dot.position.set(sign*(pitchX-11),.07,0);s.add(dot);
  }
  const mid=new THREE.Mesh(new THREE.RingGeometry(9.05,9.22,96),new THREE.MeshBasicMaterial({color:0xf6fff3,side:THREE.DoubleSide}));mid.rotation.x=-Math.PI/2;mid.position.y=.07;s.add(mid);
  const dot=new THREE.Mesh(new THREE.CircleGeometry(.43,20),new THREE.MeshBasicMaterial({color:0xf6fff3,side:THREE.DoubleSide}));dot.rotation.x=-Math.PI/2;dot.position.y=.07;s.add(dot);
  this.makeGoal(-1);this.makeGoal(1);this.makeStands();this.makeLights();
  this.ballGroup=new THREE.Group();const b=sphere(.36,white,24);b.castShadow=true;this.ballGroup.add(b);
  for(let i=0;i<12;i++){
   const v=new THREE.Vector3(Math.sin(i*2.39996),Math.cos(i*2.39996)*.8,Math.sin(i*1.376)).normalize();
   const spot=new THREE.Mesh(new THREE.CircleGeometry(.125,5),material(0x202a30,.55));spot.position.copy(v.clone().multiplyScalar(.354));spot.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),v);this.ballGroup.add(spot);
  }
  s.add(this.ballGroup);
 }
 makeGoal(sign){const s=this.scene,xf=sign*54,back=sign*58.8,h=3.8,z=7.0;
  const pole=(a,b,r=.1)=>{const d=new THREE.Vector3().subVectors(b,a),obj=new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),10),white);obj.position.copy(a).add(b).multiplyScalar(.5);obj.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());obj.castShadow=true;s.add(obj);};
  pole(new THREE.Vector3(xf,0,-z),new THREE.Vector3(xf,h,-z));pole(new THREE.Vector3(xf,0,z),new THREE.Vector3(xf,h,z));pole(new THREE.Vector3(xf,h,-z),new THREE.Vector3(xf,h,z));
  pole(new THREE.Vector3(xf,h,-z),new THREE.Vector3(back,h-1,-z),.065);pole(new THREE.Vector3(xf,h,z),new THREE.Vector3(back,h-1,z),.065);
  const netMat=new THREE.LineBasicMaterial({color:0xe7f8f6,transparent:true,opacity:.24});const verts=[];
  for(let i=0;i<=20;i++){let zz=-z+i*(2*z/20);
   for(let j=0;j<=8;j++){let yy=j*h/8;verts.push(xf,yy,zz,back,Math.max(0,yy-1),zz);}
  }
  for(let j=0;j<=14;j++){let yy=j*h/14;for(let i=0;i<=14;i++){let xx=xf+(back-xf)*i/14;verts.push(xx,Math.max(0,yy-(i/14)), -z,xx,Math.max(0,yy-(i/14)),z);}}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));s.add(new THREE.LineSegments(geo,netMat));
 }
 makeStands(){const s=this.scene;
  for(const side of [-1,1]){
   for(let i=0;i<9;i++){
    const w=139,h=.65,z=side*(35+i*2.5),y=i*1.12+.45;
    const step=cube(w,h,2.4,material(i%2?0x162e3e:0x203749));step.position.set(0,y,z);s.add(step);
   }
  }
  for(const side of [-1,1]){
   for(let i=0;i<9;i++){const step=cube(2.4,.65,99,material(i%2?0x162e3e:0x203749));step.position.set(side*(59+i*2),i*1.05+.45,0);s.add(step);}
  }
  const crowdGeometry=new THREE.BoxGeometry(.34,.4,.32),crowdMats=[material(0xbccfdc),material(0x194a7f),material(0x5a8ba2),material(0x9c4d5a),material(0x202934),material(0x32e0ac)];
  let seed=181;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let color=0;color<crowdMats.length;color++){
   const positions=[];
   for(const sign of [-1,1])for(let row=0;row<8;row++)for(let k=-67;k<67;k+=1.4){if(Math.floor(rnd()*crowdMats.length)===color)positions.push([k,row*1.12+1.0,sign*(35+row*2.5)]);}
   const ins=new THREE.InstancedMesh(crowdGeometry,crowdMats[color],positions.length);const dummy=new THREE.Object3D();positions.forEach((p,i)=>{dummy.position.set(...p);dummy.updateMatrix();ins.setMatrixAt(i,dummy.matrix);});s.add(ins);
  }
  for(const sign of [-1,1]){
   const ad=cube(108,1.7,.25,makeAd('STRIKE ARENA  •  MATCH DAY  •  PLAY TO WIN',sign===1?'#0c977f':'#126cb2'));
   ad.position.set(0,1.1,sign*31.3);s.add(ad);
  }
  for(const sign of [-1,1]){
   const ad=cube(.3,1.7,59,makeAd('FOOTBALL CLUB', '#133858'));ad.position.set(sign*55,1.1,0);s.add(ad);
  }
 }
 makeLights(){
  for(const x of [-65,65])for(const z of [-42,42]){
   const tower=cylinder(.33,.55,37,material(0x41515f,.55,.36));tower.position.set(x,18,z);this.scene.add(tower);
   const bar=cube(10,1,1.5,material(0x6b8695,.4,.52));bar.position.set(x,36.2,z);this.scene.add(bar);
   for(let a=-4;a<=4;a+=2){const light=cube(1.3,.7,.2,new THREE.MeshBasicMaterial({color:0xe9ffff}));light.position.set(x+a,36,z);this.scene.add(light);}
   const spot=new THREE.SpotLight(0xccf4ff,900,130,Math.PI/3,.6,1.3);spot.position.set(x,36,z);spot.target.position.set(x*.15,0,z*.1);this.scene.add(spot,spot.target);
  }
 }
 draw(state,meId,dt,{replay=false,now=0}={}){
  if(!state||!state.players||!state.ball)return;
  const used=new Set();let me=null;
  for(const p of state.players){
   used.add(p.id);let f=this.players.get(p.id);
   if(!f){f=new Footballer(p.team,p.slot,p.bot,p.name);this.players.set(p.id,f);this.scene.add(f.group);}
   f.update(p,dt,p.id===meId,p.id===state.ball.ownerId);if(p.id===meId)me=p;
  }
  for(const [id,p]of this.players){if(!used.has(id)){this.scene.remove(p.group);p.dispose();this.players.delete(id);}}
  const ball=xy(state.ball.x,state.ball.y);this.ballGroup.position.lerp(new THREE.Vector3(ball[0],.37,ball[1]),Math.min(1,dt*22));
  this.ballGroup.rotation.z+=(Math.hypot(state.ball.vx||0,state.ball.vy||0)/140)*dt;
  const bx=this.ballGroup.position.x,bz=this.ballGroup.position.z;
  const subject=me?xy(me.x,me.y):ball;
  const team=me?.team??0,sign=team===0?1:-1;
  const focus=replay?new THREE.Vector3(bx,1.3,bz):new THREE.Vector3(subject[0]+sign*11,1.4,subject[1]*.7);
  let destination;
  if(replay){const t=now*.0005;destination=new THREE.Vector3(bx+Math.cos(t)*22,12+Math.sin(t*.3)*3,bz+Math.sin(t)*20);}
  else if(state.penalty){const at=state.penalty.turn,sgn=at===0?1:-1;destination=new THREE.Vector3(subject[0]-sgn*16,8.7,subject[1]+12);}
  else{destination=new THREE.Vector3(subject[0]-sign*19,15,subject[1]+19);}
  this.camera.position.lerp(destination,Math.min(1,dt*(replay?2:3.2)));
  this.cameraTarget.lerp(focus,Math.min(1,dt*5));this.camera.lookAt(this.cameraTarget);
  this.renderer.render(this.scene,this.camera);
 }
}
