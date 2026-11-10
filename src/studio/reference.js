import { DEFAULT_SETTINGS } from '../../studio/shared.mjs';

export const referenceBlueprint = {
  title: 'Emberfall: The Last Beacon', pitch: 'Restore three forest beacons, collect ember shards and defeat the guardian of the hollow.',
  artDirection: 'Atmospheric illustrated forest, deep teal shadows, warm amber fireflies, layered silhouettes.',
  story: 'The forest has forgotten the sunrise. Carry the last ember through its ruins and awaken the old beacons.',
  mechanics: ['Run and double jump', 'Attack with an ember blade', 'Collect shards to upgrade damage', 'Defeat the final guardian', 'Checkpoint progress between levels'],
  controls: ['A/D or arrows: move', 'Space / W: jump', 'J: attack', 'P: pause', 'R: restart level'],
  player: { speed: 240, jump: 430, health: 5, damage: 1 },
  levels: ['The Sleeping Grove', 'Ruins of the Watch', 'The Hollow Guardian'].map((name, i) => ({
    id: `level_${i + 1}`, name, objective: i === 2 ? 'Defeat the guardian and ignite the final beacon.' : 'Gather shards, cross the ruins and reach the beacon.', width: 2400, height: 540, background: 'forest',
    entities: [
      { id: 'spawn', type: 'spawn', x: 90, y: 400, width: 32, height: 46, assetId: 'hero' },
      { id: 'ground', type: 'platform', x: 1200, y: 520, width: 2400, height: 40, assetId: 'stone' },
      ...[400, 850, 1300, 1770].map((x, n) => ({ id: `platform_${n}`, type: 'platform', x, y: 390 - n % 2 * 65, width: 180, height: 22, assetId: 'stone' })),
      ...[470, 1000, 1490].map((x, n) => ({ id: `enemy_${n}`, type: 'enemy', x, y: 465, width: 40, height: 36, assetId: 'crawler' })),
      ...[250, 400, 700, 850, 1150, 1300, 1630, 1770, 1920].map((x, n) => ({ id: `shard_${n}`, type: 'coin', x, y: n % 3 === 1 ? 280 : 450, width: 18, height: 24, assetId: '' })),
      ...(i === 2 ? [{ id: 'guardian', type: 'boss', x: 2070, y: 440, width: 88, height: 104, assetId: 'guardian' }] : []),
      { id: 'beacon', type: 'exit', x: 2300, y: 440, width: 44, height: 105, assetId: '' },
    ],
  })),
  assets: [
    { id: 'hero', name: 'Ember keeper', kind: 'image', role: 'player', prompt: 'Single full-body 2D side-view young cloaked ember keeper, amber scarf, teal cloak, isolated on transparent background. Illustrated atmospheric fantasy.', duration: 0 },
    { id: 'forest', name: 'Sleeping forest', kind: 'image', role: 'background', prompt: 'Layered atmospheric illustrated forest background, deep teal woodland silhouettes and amber fireflies, side-view game environment, no text or characters.', duration: 0 },
    { id: 'stone', name: 'Ancient stone', kind: 'image', role: 'platform', prompt: 'Single wide mossy ancient stone platform, side view, isolated transparent background, illustrated teal and amber fantasy.', duration: 0 },
    { id: 'crawler', name: 'Hollow crawler', kind: 'image', role: 'enemy', prompt: 'Single small shadow creature with orange eyes, full body side view, transparent background, illustrated teal fantasy.', duration: 0 },
    { id: 'guardian', name: 'Hollow guardian', kind: 'image', role: 'boss', prompt: 'Single imposing ancient woodland stone guardian, glowing amber core, full body side view, transparent background, illustrated dark teal fantasy.', duration: 0 },
    { id: 'theme', name: 'Forest theme', kind: 'music', role: 'music', prompt: 'Atmospheric instrumental fantasy game exploration, soft marimba, warm pads, forest mystery, restrained percussion, no vocals.', duration: 30 },
    { id: 'collect', name: 'Ember pickup', kind: 'sfx', role: 'collect', prompt: 'Short warm magical crystalline pickup chime, clean game sound, no speech.', duration: 1 },
    { id: 'hit', name: 'Ember strike', kind: 'sfx', role: 'attack', prompt: 'Short fantasy sword swoosh and magical ember impact, clean game sound.', duration: 1 },
  ],
};

// Hand-authored reference project, explicitly labelled in the UI; never represented as AI output.
export const referenceCode = String.raw`
const S = window.STUDIO;
class Emberfall extends Phaser.Scene {
  constructor() { super('Emberfall'); }
  preload() {
    for (const def of S.blueprint.assets) if (S.assets[def.id]) {
      if (def.kind === 'image') this.load.image(def.id, S.assets[def.id]);
      else this.load.audio(def.id, S.assets[def.id]);
    }
  }
  create() {
    this.sound.stopAll(); this.started = false; this.ended = false; this.paused = false;
    this.index = Math.min(S.initialLevel || 0, S.blueprint.levels.length - 1);
    this.shards = 0; this.hp = S.blueprint.player.health; this.lastHit = -2000; this.lastAttack = -1000; this.jumps = 0;
    this.touch = { left: false, right: false }; this.level = S.blueprint.levels[this.index];
    this.makeTextures(); this.makeWorld();
    this.keys = this.input.keyboard.addKeys('A,D,W,SPACE,J,P,R,LEFT,RIGHT,UP');
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    this.input.keyboard.on('keydown-R', () => this.restart());
    this.input.keyboard.on('keydown-SPACE', () => this.jump());
    this.input.keyboard.on('keydown-W', () => this.jump());
    this.input.keyboard.on('keydown-UP', () => this.jump());
    this.input.keyboard.on('keydown-J', () => this.attack());
    this.hud = this.add.text(24, 20, '', { fontFamily: 'sans-serif', fontSize: '18px', color: '#ffdda2', backgroundColor: '#102328', padding: {x:14,y:10} }).setScrollFactor(0).setDepth(30);
    this.hint = this.add.text(936, 24, 'A/D move · Space jump · J attack · P pause', {fontFamily:'sans-serif',fontSize:'13px',color:'#b0c9c7'}).setOrigin(1,0).setScrollFactor(0).setDepth(30);
    this.showMenu();
  }
  makeTextures() {
    const defs = { hero:[0xffd18c,32,46], enemy:[0x5c7e83,40,36], boss:[0x537775,88,104], stone:[0x29484c,64,24], coin:[0xffbd62,18,24], exit:[0xefa957,44,105] };
    for (const [id,[color,w,h]] of Object.entries(defs)) {
      const key = '_'+id; if(this.textures.exists(key)) continue;
      const g=this.make.graphics({x:0,y:0,add:false});
      g.fillStyle(color); g.fillRoundedRect(0,0,w,h,Math.min(8,w/3));
      g.fillStyle(0xffffff,0.18);g.fillRect(4,3,w-8,4);
      if(id==='hero'){g.fillStyle(0x17353a);g.fillRect(5,9,22,12);g.fillStyle(0xffe4a0);g.fillRect(18,12,4,3);}
      if(id==='enemy'||id==='boss'){g.fillStyle(0xffc57a);g.fillCircle(w*.3,h*.32,3);g.fillCircle(w*.7,h*.32,3);}
      g.generateTexture(key,w,h);g.destroy();
    }
  }
  texture(e,fallback){ return e.assetId && this.textures.exists(e.assetId) ? e.assetId : '_'+fallback; }
  makeWorld() {
    const l=this.level; this.physics.world.setBounds(0,0,l.width,l.height+200);this.cameras.main.setBounds(0,0,l.width,l.height);
    this.cameras.main.setBackgroundColor('#0b2028');
    if(l.background && this.textures.exists(l.background)) this.add.image(480,270,l.background).setDisplaySize(960,540).setScrollFactor(0).setAlpha(.7);
    else {
      for(let i=0;i<22;i++){const x=i*145;this.add.rectangle(x,300,50+(i%3)*20,440,0x16363d).setScrollFactor(.4);this.add.triangle(x,130,0,120,85,0,170,120,0x1b4245).setScrollFactor(.4);}
      for(let i=0;i<40;i++){let dot=this.add.circle((i*127)%960,(i*73)%460,1+i%2,0xffc876,.4).setScrollFactor(.15);this.tweens.add({targets:dot,alpha:.1,y:'-=15',duration:1700+i*40,yoyo:true,repeat:-1});}
    }
    this.ground=this.physics.add.staticGroup();this.enemies=this.physics.add.group();this.coins=this.physics.add.staticGroup();this.exit=null;
    const spawn=l.entities.find(e=>e.type==='spawn');
    this.player=this.physics.add.sprite(spawn.x,spawn.y,this.texture(spawn,'hero')).setDisplaySize(spawn.width,spawn.height);
    this.player.body.setSize(this.player.width*.75,this.player.height*.9).setOffset(this.player.width*.125,this.player.height*.1);this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);this.cameras.main.startFollow(this.player,true,.09,.09);
    for(const e of l.entities){
      if(e.type==='platform'){const p=this.ground.create(e.x,e.y,this.texture(e,'stone')).setDisplaySize(e.width,e.height);p.refreshBody();}
      if(e.type==='enemy'||e.type==='boss'){
        if(e.type==='boss'&&!S.settings.bosses)continue;
        const n=this.enemies.create(e.x,e.y,this.texture(e,e.type==='boss'?'boss':'enemy')).setDisplaySize(e.width,e.height);
        n.body.setSize(n.width*.85,n.height*.85);n.setCollideWorldBounds(true);n.home=e.x;n.boss=e.type==='boss';n.hp=n.boss?10+this.index*2:2;n.setVelocityX(-55-this.index*8);n.lastTurn=0;
      }
      if(e.type==='coin'){const c=this.coins.create(e.x,e.y,'_coin').setDisplaySize(e.width,e.height);c.refreshBody();this.tweens.add({targets:c,alpha:.45,duration:800,yoyo:true,repeat:-1});}
      if(e.type==='exit'){this.exit=this.physics.add.staticSprite(e.x,e.y,this.texture(e,'exit')).setDisplaySize(e.width,e.height);this.exit.refreshBody();this.tweens.add({targets:this.exit,alpha:.5,duration:1100,yoyo:true,repeat:-1});}
      if(e.type==='decoration'&&e.assetId&&this.textures.exists(e.assetId))this.add.image(e.x,e.y,e.assetId).setDisplaySize(e.width,e.height);
    }
    this.physics.add.collider(this.player,this.ground);this.physics.add.collider(this.enemies,this.ground);
    this.physics.add.overlap(this.player,this.coins,(_,coin)=>{if(!this.started||this.ended)return;coin.destroy();this.shards++;this.playSound('collect');});
    this.physics.add.overlap(this.player,this.enemies,()=>this.damage());
    if(this.exit)this.physics.add.overlap(this.player,this.exit,()=>this.finish());
  }
  playSound(role){const a=S.blueprint.assets.find(a=>a.role===role&&a.kind!=='image'&&this.cache.audio.exists(a.id));if(a)this.sound.play(a.id,{volume:.4});}
  panel(title,subtitle,buttons){
    const list=[];const add=o=>{o.setScrollFactor(0).setDepth(100);list.push(o);return o;};
    add(this.add.rectangle(480,270,960,540,0x07191e,.94));
    add(this.add.text(480,120,'E M B E R F A L L',{fontFamily:'sans-serif',fontSize:'13px',color:'#eabb78'}).setOrigin(.5));
    add(this.add.text(480,185,title,{fontFamily:'Georgia',fontSize:'38px',color:'#fff0d2',align:'center',wordWrap:{width:800}}).setOrigin(.5));
    add(this.add.text(480,260,subtitle,{fontFamily:'sans-serif',fontSize:'16px',color:'#a9c4c2',align:'center',wordWrap:{width:650}}).setOrigin(.5));
    buttons.forEach(([label,fn],i)=>{const text=add(this.add.text(480,335+i*54,label,{fontFamily:'sans-serif',fontSize:'17px',color:'#142729',backgroundColor:'#edbd7b',padding:{x:28,y:12}}).setOrigin(.5).setInteractive({useHandCursor:true}));text.on('pointerdown',()=>{list.forEach(o=>o.destroy());fn();});});
  }
  showMenu(){
    this.physics.pause();const saved=S.load();
    const start=()=>{this.started=true;this.physics.resume();const theme=S.blueprint.assets.find(a=>a.kind==='music'&&this.cache.audio.exists(a.id));if(theme)this.sound.play(theme.id,{loop:true,volume:.25});if(S.settings.controls.includes('touch'))this.touchUI();};
    const buttons=[['Begin · '+this.level.name,start]];
    if(saved&&Number.isInteger(saved.level)&&saved.level>=0&&saved.level<S.blueprint.levels.length&&saved.level!==this.index)buttons.push(['Continue saved journey',()=>{S.initialLevel=saved.level;this.scene.restart();}]);
    this.panel(S.blueprint.title,S.settings.story?S.blueprint.story:this.level.objective,buttons);
  }
  touchUI(){
    [['◀',55,465,'left'],['▶',140,465,'right'],['JUMP',790,465,'jump'],['HIT',900,465,'attack']].forEach(([label,x,y,key])=>{
      const b=this.add.text(x,y,label,{fontSize:'18px',color:'#ffe2ac',backgroundColor:'#254247',padding:{x:15,y:15}}).setOrigin(.5).setScrollFactor(0).setDepth(40).setInteractive();
      b.on('pointerdown',()=>{if(key==='jump')this.jump();else if(key==='attack')this.attack();else this.touch[key]=true;});
      b.on('pointerup',()=>{this.touch[key]=false;});b.on('pointerout',()=>{this.touch[key]=false;});
    });this.input.addPointer(2);
  }
  restart(){this.sound.stopAll();S.initialLevel=this.index;this.scene.restart();}
  togglePause(){if(!this.started||this.ended)return;this.paused=!this.paused;this.paused?this.physics.pause():this.physics.resume();}
  jump(){if(!this.started||this.ended||this.paused)return;if(this.player.body.blocked.down)this.jumps=0;if(this.jumps<2){this.player.setVelocityY(-S.blueprint.player.jump);this.jumps++;}}
  attack(){
    if(!this.started||this.ended||this.paused||this.time.now-this.lastAttack<320)return;this.lastAttack=this.time.now;this.playSound('attack');
    const facing=this.player.flipX?-1:1;const fx=this.add.rectangle(this.player.x+facing*48,this.player.y,76,52,0xffc778,.5).setDepth(12);this.tweens.add({targets:fx,alpha:0,scaleX:1.5,duration:180,onComplete:()=>fx.destroy()});
    for(const e of [...this.enemies.getChildren()])if(Math.abs(e.x-this.player.x)<(e.boss?130:105)&&Math.abs(e.y-this.player.y)<100){e.hp-=S.blueprint.player.damage+(S.settings.upgrades?Math.floor(this.shards/5):0);e.setTint(0xffc778);this.time.delayedCall(120,()=>{if(e.active)e.clearTint();});if(e.hp<=0){this.shards+=e.boss?5:1;e.destroy();}}
  }
  damage(){if(!this.started||this.ended||this.paused||this.time.now-this.lastHit<1100)return;this.lastHit=this.time.now;this.hp--;this.cameras.main.shake(100,.005);this.player.setTint(0xff7777);this.time.delayedCall(500,()=>this.player.clearTint());if(this.hp<=0){this.ended=true;this.physics.pause();this.panel('The ember still glows','Your journey is not over. Try a different approach.',[['Try again',()=>this.restart()]]);}}
  finish(){
    if(!this.started||this.ended||this.enemies.getChildren().some(e=>e.boss))return;this.ended=true;this.physics.pause();
    const next=this.index+1;
    if(next<S.blueprint.levels.length){S.save({level:next});this.panel('Beacon restored',this.shards+' shards collected · '+this.level.name,[['Continue journey',()=>{S.initialLevel=next;this.scene.restart();}]]);}
    else{S.save({level:0,completed:true});this.panel('The forest remembers','All beacons are burning. A new dawn begins.',[['Play again',()=>{S.initialLevel=0;this.scene.restart();}]]);}
  }
  update(){
    if(!this.player||!this.hud)return;
    this.hud.setText('♥ '+this.hp+'   ◈ '+this.shards+'   /   '+this.level.name+(this.paused?'   PAUSED':''));
    if(!this.started||this.ended||this.paused)return;
    const left=this.keys.A.isDown||this.keys.LEFT.isDown||this.touch.left,right=this.keys.D.isDown||this.keys.RIGHT.isDown||this.touch.right;
    this.player.setVelocityX(left?-S.blueprint.player.speed:right?S.blueprint.player.speed:0);if(left||right)this.player.setFlipX(left);
    if(this.player.body.blocked.down)this.jumps=0;
    for(const e of this.enemies.getChildren()){
      if((e.body.blocked.left||e.body.blocked.right||Math.abs(e.x-e.home)>150)&&this.time.now-e.lastTurn>400){e.setVelocityX(-e.body.velocity.x||60);e.lastTurn=this.time.now;}
      if(e.boss&&Math.abs(this.player.x-e.x)<350){e.setVelocityX(this.player.x<e.x?-80:80);}
      e.setFlipX(e.body.velocity.x>0);
    }
    if(this.player.y>this.level.height+80){this.hp=1;this.damage();}
  }
}
window.referenceGame = new Phaser.Game({type:Phaser.AUTO,parent:'game',width:960,height:540,backgroundColor:'#0b2028',scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},physics:{default:'arcade',arcade:{gravity:{y:980},debug:false}},scene:Emberfall});
`;
export const referenceSettings = { ...DEFAULT_SETTINGS };
