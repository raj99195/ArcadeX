// Optional browser QA. Uses Playwright from STUDIO_PLAYWRIGHT_PATH or a local install.
const { chromium } = require(process.env.STUDIO_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless:true, ...(process.env.STUDIO_CHROME_PATH ? {executablePath:process.env.STUDIO_CHROME_PATH} : {}) });
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STUDIO_TEST_URL || 'http://127.0.0.1:5173/studio');
  await page.getByRole('heading',{name:'An idea. An entire game world.'}).waitFor({timeout:60000});
  assert.equal(await page.locator('.gs-app').count(),1);
  assert.equal(await page.locator('.gs-toggle-card input:checked').count(),5);
  await fs.mkdir('.studio-data/qa',{recursive:true});
  await page.screenshot({path:'.studio-data/qa/studio-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page overflows horizontally');
  await page.screenshot({path:'.studio-data/qa/studio-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:/Explore a complete project/}).click();
  const frame=page.frameLocator('iframe[title="Sandboxed game preview"]');
  await frame.locator('canvas').waitFor({timeout:30000});
  const gameFrame=page.frames().find(f=>f.parentFrame()===page.mainFrame());
  assert.ok(await gameFrame.evaluate(()=>!!window.referenceGame));
  await gameFrame.waitForFunction(()=>window.referenceGame.scene.getScene('Emberfall').player?.body);
  await page.waitForTimeout(300);
  assert.equal(await gameFrame.evaluate(()=>document.getElementById('failure').textContent),'');
  await page.screenshot({path:'.studio-data/qa/reference-title.png'});
  // Start through the actual canvas menu using its text object bounds.
  async function clickGameText(pattern){
    const coords=await gameFrame.evaluate(pattern=>{const scene=window.referenceGame.scene.getScene('Emberfall');const text=scene.children.list.find(o=>o.type==='Text'&&o.text.includes(pattern));if(!text)throw new Error('Missing game button '+pattern);return{x:text.x,y:text.y};},pattern);
    const box=await frame.locator('canvas').boundingBox();await page.mouse.click(box.x+coords.x/960*box.width,box.y+coords.y/540*box.height);
  }
  await clickGameText('Begin');
  assert.equal(await gameFrame.evaluate(()=>window.referenceGame.scene.getScene('Emberfall').started),true);
  const startX=await gameFrame.evaluate(()=>window.referenceGame.scene.getScene('Emberfall').player.x);
  await page.keyboard.down('ArrowRight');await page.waitForTimeout(350);await page.keyboard.up('ArrowRight');
  assert.ok(await gameFrame.evaluate(()=>window.referenceGame.scene.getScene('Emberfall').player.x)>startX,'Player movement failed');
  await page.keyboard.press('Space');
  assert.ok(await gameFrame.evaluate(()=>window.referenceGame.scene.getScene('Emberfall').player.body.velocity.y)<0,'Jump failed');
  await page.keyboard.press('p');assert.equal(await gameFrame.evaluate(()=>window.referenceGame.scene.getScene('Emberfall').paused),true);await page.keyboard.press('p');
  // Deterministically exercise world collisions, exit transitions and boss gating.
  await gameFrame.evaluate(()=>{const s=window.referenceGame.scene.getScene('Emberfall');s.player.setPosition(s.exit.x,s.exit.y);});
  await gameFrame.waitForFunction(()=>window.referenceGame.scene.getScene('Emberfall').ended);
  await clickGameText('Continue journey');
  await gameFrame.waitForFunction(()=>window.referenceGame.scene.getScene('Emberfall').index===1);
  await clickGameText('Begin');
  await gameFrame.evaluate(()=>{const s=window.referenceGame.scene.getScene('Emberfall');s.player.setPosition(s.exit.x,s.exit.y);});
  await gameFrame.waitForFunction(()=>window.referenceGame.scene.getScene('Emberfall').ended);
  await clickGameText('Continue journey');await gameFrame.waitForFunction(()=>window.referenceGame.scene.getScene('Emberfall').index===2);await clickGameText('Begin');
  const bossGate=await gameFrame.evaluate(()=>{const s=window.referenceGame.scene.getScene('Emberfall');s.finish();return s.ended;});assert.equal(bossGate,false);
  await gameFrame.evaluate(()=>{const s=window.referenceGame.scene.getScene('Emberfall');for(const e of [...s.enemies.getChildren()])if(e.boss)e.destroy();s.finish();});
  assert.equal(await gameFrame.evaluate(()=>window.referenceGame.scene.getScene('Emberfall').ended),true);
  await page.waitForTimeout(300);
  await page.screenshot({path:'.studio-data/qa/reference-victory.png'});
  await page.getByRole('button',{name:'Levels',exact:true}).click();
  await page.locator('.gs-map-object').first().click();
  await page.getByLabel('X',{exact:true}).fill('125');
  await page.getByRole('button',{name:'● Save changes',exact:true}).click();
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.frameLocator('iframe').locator('canvas').waitFor();
  const nextFrame=page.frames().find(f=>f.parentFrame()===page.mainFrame());
  await nextFrame.waitForFunction(()=>window.referenceGame?.scene.getScene('Emberfall').player?.body);
  assert.equal(await nextFrame.evaluate(()=>window.STUDIO.blueprint.levels[0].entities.find(e=>e.type==='spawn').x),125);
  // The sandbox must deny parent access and block resource fetches.
  assert.equal(await nextFrame.evaluate(()=>{try{parent.document;return false}catch{return true}}),true);
  assert.equal(await nextFrame.evaluate(async()=>{try{await fetch('https://example.com');return false}catch{return true}}),true);
  assert.equal(await nextFrame.evaluate(()=>document.getElementById('failure').textContent),'');
  const studioErrors=errors.filter(e=>!/WalletConnect|privy|Reown|Failed to fetch|WebSocket/i.test(e));
  assert.deepEqual(studioErrors,[]);
  console.log(JSON.stringify({passed:true,checks:['desktop/mobile layout','reference menu','movement/jump/pause','level transitions','boss gating/victory','editable spawn roundtrip','sandbox isolation'],screenshots:path.resolve('.studio-data/qa')},null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
