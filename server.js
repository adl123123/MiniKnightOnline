const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');
const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*'},transports:['websocket'],pingInterval:10000,pingTimeout:10000});
app.use(express.static(path.join(__dirname,'public')));

const PORT=process.env.PORT||3000;
const rooms=new Map();
const perf={ticks:0,snaps:0,tickHz:0,snapshotHz:0,lastCalc:Date.now()};
const DIRS={u:[0,-1],d:[0,1],l:[-1,0],r:[1,0]},OP={u:'d',d:'u',l:'r',r:'l'};
const WP={
 pistol:{name:'Пистолет',cool:.28,damage:2,pellets:1,spread:.04,speed:420,price:6},
 shotgun:{name:'Дробовик',cool:.7,damage:.7,pellets:5,spread:.45,speed:380,price:10},
 smg:{name:'ПП',cool:.1,damage:2,pellets:1,spread:.18,speed:450,price:12},
 rifle:{name:'Винтовка',cool:.2,damage:5,pellets:1,spread:.02,speed:560,price:15}
};
const SHOP=[{kind:'heart',name:'Сердце +2 HP',price:5},{kind:'weapon',weapon:'pistol',name:'Пистолет',price:6},{kind:'weapon',weapon:'shotgun',name:'Дробовик',price:10},{kind:'weapon',weapon:'smg',name:'ПП',price:12},{kind:'weapon',weapon:'rifle',name:'Винтовка',price:15}];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
function code(){let s='';const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';do{s='';for(let i=0;i<4;i++)s+=chars[Math.floor(Math.random()*chars.length)]}while(rooms.has(s));return s}
function key(x,y){return x+','+y}
function genDungeon(){
 const map={};const mk=(x,y,d)=>map[key(x,y)]={x,y,dist:d,doors:{},type:'fight',done:false,obs:[],items:[]};
 const start=mk(0,0,0);start.type='start';start.done=true;const L=[start];
 while(L.length<7){const a=L[Math.floor(Math.random()*L.length)],ds=Object.keys(DIRS),d=ds[Math.floor(Math.random()*4)],[dx,dy]=DIRS[d];if(map[key(a.x+dx,a.y+dy)])continue;const n=mk(a.x+dx,a.y+dy,a.dist+1);a.doors[d]=key(n.x,n.y);n.doors[OP[d]]=key(a.x,a.y);L.push(n)}
 const leaves=L.filter(r=>r!==start&&Object.keys(r.doors).length===1).sort((a,b)=>b.dist-a.dist);const boss=leaves[0]||L[L.length-1];boss.type='boss';
 const opts=L.filter(r=>r!==start&&r!==boss);if(opts.length){const shop=opts[Math.floor(Math.random()*opts.length)];shop.type='shop';shop.done=true}
 for(const r of L)layout(r);
 return {map,start:key(0,0)};
}
function layout(r){if(r.type==='start'||r.type==='shop')return;const n=r.type==='fight'?10+Math.floor(Math.random()*4):3;for(let i=0;i<n;i++){const w=20,h=20,x=40+Math.floor(Math.random()*14)*20,y=100+Math.floor(Math.random()*20)*20;if(Math.hypot(x+10-180,y+10-300)<85)continue;r.obs.push({x,y,w,h})}}
function makeRoom(){const d=genDungeon();return {code:code(),players:new Map(),dungeon:d.map,current:d.start,enemies:[],bullets:[],enemyBullets:[],started:false,last:Date.now(),kills:0,portal:false,snapshotSeq:0};}
function spawnEnemies(room){const r=room.dungeon[room.current];room.enemies=[];room.bullets=[];room.enemyBullets=[];room.portal=false;if(r.type==='boss'){room.enemies.push(enemy('king',180,200));return}if(r.type!=='fight')return;const count=4+r.dist;for(let i=0;i<count;i++){let x,y,t=0;do{x=rnd(45,315);y=rnd(110,490);t++}while(t<30&&(hitObs(r,x,y,14)||Math.hypot(x-180,y-300)<110));room.enemies.push(enemy(Math.random()<.35?'blue':'green',x,y))}}
function enemy(type,x,y){const hp=type==='king'?100:type==='blue'?12:10;return{id:Math.random().toString(36).slice(2),type,x,y,hp,maxHp:hp,r:type==='king'?22:11,cd:rnd(.5,1.8),phase:rnd(0,6),half:false}}
function hitObs(r,x,y,rad){return r.obs.some(q=>x+rad>q.x&&x-rad<q.x+q.w&&y+rad>q.y&&y-rad<q.y+q.h)}
function moveEntity(r,o,dx,dy,rad){if(!hitObs(r,o.x+dx,o.y,rad))o.x+=dx;if(!hitObs(r,o.x,o.y+dy,rad))o.y+=dy;o.x=clamp(o.x,28,332);o.y=clamp(o.y,88,512)}
function spawnPlayer(id,name,index){return{id,name:name||('Игрок '+(index+1)),x:index?210:150,y:300,hp:6,maxHp:6,coins:0,weps:['pistol',null,null],slot:0,w:'pistol',face:0,cd:0,inv:0,roll:0,rollCd:0,input:{x:0,y:0,aimX:180,aimY:300,fire:false},dead:false,deadUntil:0}}
function publicState(room){const r=room.dungeon[room.current],now=Date.now();return{serverTime:now,seq:++room.snapshotSeq,serverPerf:{tickHz:perf.tickHz,snapshotHz:perf.snapshotHz,players:room.players.size,enemies:room.enemies.length,bullets:room.bullets.length+room.enemyBullets.length},code:room.code,current:room.current,room:{x:r.x,y:r.y,type:r.type,done:r.done,doors:r.doors,obs:r.obs,items:r.items},players:[...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,coins:p.coins,weps:p.weps,slot:p.slot,w:p.w,face:p.face,inv:p.inv,roll:p.roll,dead:p.dead,respawn:p.dead?Math.max(0,(p.deadUntil-now)/1000):0})),enemies:room.enemies.map(e=>({id:e.id,type:e.type,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,r:e.r})),bullets:room.bullets.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy})),enemyBullets:room.enemyBullets.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy})),kills:room.kills,portal:room.portal,shop:SHOP}}
function roomOf(socket){const c=socket.data.room;return c&&rooms.get(c)}
function safeDrop(r,x,y){for(let rad=0;rad<=140;rad+=20)for(let i=0;i<16;i++){const a=i*Math.PI/8,nx=clamp(x+Math.cos(a)*rad,45,315),ny=clamp(y+Math.sin(a)*rad,105,495);if(!hitObs(r,nx,ny,12))return[nx,ny]}return[180,300]}
function transition(room,dir){const r=room.dungeon[room.current],next=r.doors[dir];if(!next||!r.done)return;room.current=next;const nr=room.dungeon[next];for(const p of room.players.values()){if(dir==='u'){p.x=180;p.y=490}else if(dir==='d'){p.x=180;p.y=110}else if(dir==='l'){p.x=320;p.y=300}else{p.x=40;p.y=300}}if(!nr.done&&room.enemies.length===0)spawnEnemies(room);else{room.enemies=[];room.bullets=[];room.enemyBullets=[]}}
function damagePlayer(p){if(p.inv>0||p.dead)return;p.hp--;p.inv=1;if(p.hp<=0){p.hp=0;p.dead=true;p.deadUntil=Date.now()+3000;p.input.x=0;p.input.y=0;p.input.fire=false;p.roll=0}}
function respawnPlayer(room,p){const r=room.dungeon[room.current];let baseX=180,baseY=300;const mate=[...room.players.values()].find(q=>q.id!==p.id&&!q.dead);if(mate){baseX=mate.x;baseY=mate.y}const [x,y]=safeDrop(r,baseX,baseY);p.x=x;p.y=y;p.hp=Math.max(3,Math.ceil(p.maxHp/2));p.dead=false;p.deadUntil=0;p.inv=2;p.cd=.25;p.roll=0;p.input.x=0;p.input.y=0;p.input.fire=false}
function tick(room,dt){const r=room.dungeon[room.current],now=Date.now();
 for(const p of room.players.values()){
  p.cd-=dt;p.inv-=dt;p.rollCd-=dt;
  if(p.dead){if(now>=p.deadUntil)respawnPlayer(room,p);else continue;}
  let ax=p.input.x,ay=p.input.y,l=Math.hypot(ax,ay);if(l>1){ax/=l;ay/=l}
  if(p.roll>0){p.roll-=dt;moveEntity(r,p,p.rollX*330*dt,p.rollY*330*dt,8)}else moveEntity(r,p,ax*140*dt,ay*140*dt,8);
  if(p.input.aimX!=null){p.face=Math.atan2(p.input.aimY-p.y,p.input.aimX-p.x)}
  if(p.input.fire&&p.cd<=0){const w=WP[p.w];p.cd=w.cool;for(let i=0;i<w.pellets;i++){const a=p.face+(Math.random()-.5)*2*w.spread;room.bullets.push({x:p.x,y:p.y,vx:Math.cos(a)*w.speed,vy:Math.sin(a)*w.speed,d:w.damage,life:.9,owner:p.id})}}
  const doorMargin=13;if(r.done){if(p.y<=89&&Math.abs(p.x-180)<22&&r.doors.u)transition(room,'u');else if(p.y>=511&&Math.abs(p.x-180)<22&&r.doors.d)transition(room,'d');else if(p.x<=29&&Math.abs(p.y-300)<22&&r.doors.l)transition(room,'l');else if(p.x>=331&&Math.abs(p.y-300)<22&&r.doors.r)transition(room,'r')}
 }
 for(const b of room.bullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(hitObs(r,b.x,b.y,2)||b.x<20||b.x>340||b.y<80||b.y>520)b.life=0;for(const e of room.enemies){if(b.life>0&&Math.hypot(e.x-b.x,e.y-b.y)<e.r+3){e.hp-=b.d;e.lastHitOwner=b.owner;b.life=0}}}
 room.bullets=room.bullets.filter(b=>b.life>0);
 const anyAlive=[...room.players.values()].some(p=>!p.dead);
 if(anyAlive)for(const e of room.enemies){e.cd-=dt;let target=null,bd=1e9;for(const p of room.players.values())if(!p.dead){const d=Math.hypot(p.x-e.x,p.y-e.y);if(d<bd){bd=d;target=p}}if(!target)continue;const dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy)||1,pulse=Math.max(0,Math.sin(Date.now()/200+e.phase));if(e.type==='green')moveEntity(r,e,dx/d*(20+70*pulse)*dt,dy/d*(20+70*pulse)*dt,e.r);else if(e.type==='blue'){const s=d<110?-1:d>180?1:0;moveEntity(r,e,dx/d*s*(15+60*pulse)*dt,dy/d*s*(15+60*pulse)*dt,e.r);if(e.cd<=0){e.cd=2;room.enemyBullets.push({x:e.x,y:e.y,vx:dx/d*120,vy:dy/d*120,life:5})}}else{moveEntity(r,e,dx/d*(10+30*pulse)*dt,dy/d*(10+30*pulse)*dt,e.r);if(e.cd<=0){e.cd=e.half?1.5:2.2;for(let i=0;i<12;i++){const a=i*Math.PI/6+Date.now()/1800;room.enemyBullets.push({x:e.x,y:e.y,vx:Math.cos(a)*105,vy:Math.sin(a)*105,life:5})}}if(!e.half&&e.hp<e.maxHp/2){e.half=true;room.enemies.push(enemy('green',e.x-40,e.y+30),enemy('green',e.x+40,e.y+30))}}if(d<e.r+8)damagePlayer(target)}
 const dead=room.enemies.filter(e=>e.hp<=0);for(const e of dead){room.kills++;const [x,y]=safeDrop(r,e.x,e.y);r.items.push({id:Math.random().toString(36).slice(2),kind:'coin',x,y})}
 room.enemies=room.enemies.filter(e=>e.hp>0);
 // Coin drops are visual, then picked up by the nearest player on contact.
 for(const p of room.players.values()){if(p.dead)continue;for(let i=r.items.length-1;i>=0;i--){const it=r.items[i];if(it.kind==='coin'&&Math.hypot(it.x-p.x,it.y-p.y)<18){p.coins++;r.items.splice(i,1)}}}
 if(dead.length&&room.enemies.length===0&&!r.done){r.done=true;if(r.type==='boss')room.portal=true;else if(Math.random()<.72){const ws=['shotgun','smg','rifle'],w=ws[Math.floor(Math.random()*ws.length)],[x,y]=safeDrop(r,180,300);r.items.push({id:Math.random().toString(36).slice(2),kind:'weapon',weapon:w,x,y})}}
 for(const b of room.enemyBullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(hitObs(r,b.x,b.y,3)||b.x<20||b.x>340||b.y<80||b.y>520)b.life=0;for(const p of room.players.values())if(b.life>0&&!p.dead&&Math.hypot(b.x-p.x,b.y-p.y)<10){b.life=0;damagePlayer(p)}}room.enemyBullets=room.enemyBullets.filter(b=>b.life>0);
}

io.on('connection',socket=>{
 socket.on('netProbe',(clientStamp,cb=()=>{})=>cb({serverTime:Date.now(),echo:clientStamp}));
 socket.on('createLobby',({name}={},cb=()=>{})=>{const room=makeRoom();rooms.set(room.code,room);room.players.set(socket.id,spawnPlayer(socket.id,name,0));socket.join(room.code);socket.data.room=room.code;room.started=true;cb({ok:true,code:room.code,id:socket.id});io.to(room.code).emit('state',publicState(room))});
 socket.on('joinLobby',({code:raw,name}={},cb=()=>{})=>{const c=String(raw||'').toUpperCase().trim(),room=rooms.get(c);if(!room)return cb({ok:false,error:'Лобби не найдено'});if(room.players.size>=2)return cb({ok:false,error:'Лобби уже заполнено'});room.players.set(socket.id,spawnPlayer(socket.id,name,room.players.size));socket.join(c);socket.data.room=c;cb({ok:true,code:c,id:socket.id});io.to(c).emit('state',publicState(room))});
 socket.on('input',data=>{const room=roomOf(socket),p=room&&room.players.get(socket.id);if(!p||p.dead)return;const x=Number(data?.x)||0,y=Number(data?.y)||0,aimX=Number(data?.aimX),aimY=Number(data?.aimY);p.input.x=clamp(x,-1,1);p.input.y=clamp(y,-1,1);if(Number.isFinite(aimX))p.input.aimX=clamp(aimX,0,360);if(Number.isFinite(aimY))p.input.aimY=clamp(aimY,0,640);p.input.fire=!!data?.fire});
 socket.on('roll',()=>{const room=roomOf(socket),p=room&&room.players.get(socket.id);if(!p||p.dead||p.rollCd>0||p.roll>0)return;let ax=p.input.x,ay=p.input.y,l=Math.hypot(ax,ay);if(l<.2){ax=Math.cos(p.face);ay=Math.sin(p.face)}else{ax/=l;ay/=l}p.rollX=ax;p.rollY=ay;p.roll=.28;p.rollCd=.75;p.inv=Math.max(p.inv,.34)});
 socket.on('slot',i=>{const room=roomOf(socket),p=room&&room.players.get(socket.id);i=Number(i);if(p&&i>=0&&i<3&&p.weps[i]){p.slot=i;p.w=p.weps[i]}});
 socket.on('interact',()=>{const room=roomOf(socket),p=room&&room.players.get(socket.id);if(!p)return;const r=room.dungeon[room.current];let best=null,bd=32;for(const it of r.items){if(it.kind!=='weapon')continue;const d=Math.hypot(it.x-p.x,it.y-p.y);if(d<bd){bd=d;best=it}}if(!best)return;if(p.weps.includes(best.weapon))return;const empty=p.weps.indexOf(null);if(empty>=0){p.weps[empty]=best.weapon;p.slot=empty;p.w=best.weapon;r.items.splice(r.items.indexOf(best),1)}else{const old=p.weps[p.slot];p.weps[p.slot]=best.weapon;p.w=best.weapon;best.weapon=old;const [x,y]=safeDrop(r,p.x-30*Math.cos(p.face),p.y-30*Math.sin(p.face));best.x=x;best.y=y}});
 socket.on('buy',idx=>{const room=roomOf(socket),p=room&&room.players.get(socket.id);if(!p)return;const r=room.dungeon[room.current],it=SHOP[Number(idx)];if(r.type!=='shop'||!it||p.coins<it.price)return;if(it.kind==='heart'){if(p.hp>=p.maxHp)return;p.coins-=it.price;p.hp=Math.min(p.maxHp,p.hp+2);return}if(p.weps.includes(it.weapon))return;p.coins-=it.price;const empty=p.weps.indexOf(null);if(empty>=0){p.weps[empty]=it.weapon;p.slot=empty;p.w=it.weapon}else{const [x,y]=safeDrop(r,180,390);r.items.push({id:Math.random().toString(36).slice(2),kind:'weapon',weapon:it.weapon,x,y})}});
 socket.on('disconnect',()=>{const room=roomOf(socket);if(!room)return;room.players.delete(socket.id);if(room.players.size===0)rooms.delete(room.code);else io.to(room.code).emit('state',publicState(room))});
});
setInterval(()=>{perf.ticks++;const now=Date.now();for(const room of rooms.values()){const dt=Math.min(.05,(now-room.last)/1000);room.last=now;tick(room,dt)}},1000/30);
setInterval(()=>{perf.snaps++;for(const room of rooms.values())io.to(room.code).volatile.emit('state',publicState(room))},1000/20);
setInterval(()=>{const now=Date.now(),sec=Math.max(.001,(now-perf.lastCalc)/1000);perf.tickHz=+(perf.ticks/sec).toFixed(1);perf.snapshotHz=+(perf.snaps/sec).toFixed(1);perf.ticks=0;perf.snaps=0;perf.lastCalc=now},1000);
setInterval(()=>{const cutoff=Date.now()-1000*60*30;for(const [c,room] of rooms)if(room.players.size===0||room.last<cutoff)rooms.delete(c)},1000*60*5);
server.listen(PORT,()=>console.log(`Mini Knight Online: http://localhost:${PORT}`));
