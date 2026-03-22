// Flying TECH placer — bot hovers outside tower using /tp, places gold blocks by hand
// Bot stays visible, flies to each position, looks at wall, places block
const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const vec3 = require('vec3');

const bot = mineflayer.createBot({host:'localhost',port:25566,username:'BuilderBot',auth:'offline',version:'1.21.11'});
bot.loadPlugin(pathfinder);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let started = false;
bot.on('spawn', async () => {
  if (started) return; started = true;
  await sleep(3000);
  bot.chat('/gamemode creative'); await sleep(1000);
  const mcData = require('minecraft-data')(bot.version);
  const PI = require('prismarine-item')(bot.version);
  const goldItem = mcData.itemsByName['gold_block'];
  
  const ntx=529, ntz=-444, NTW=17, NTD=17, LY=-11;

  // TECH letter pixel map — H C E T order (reads as TECH from outside south face)
  function makeTECH(startPos) {
    const blocks = [];
    let p = startPos;
    // H
    for(let y=0;y<5;y++) blocks.push([p,y]);
    for(let y=0;y<5;y++) blocks.push([p+3,y]);
    for(let d=0;d<=3;d++) blocks.push([p+d,2]);
    p+=5;
    // C
    for(let y=0;y<5;y++) blocks.push([p+2,y]);
    blocks.push([p,4],[p+1,4],[p+2,4]);
    blocks.push([p,0],[p+1,0],[p+2,0]);
    p+=4;
    // E
    for(let y=0;y<5;y++) blocks.push([p+2,y]);
    blocks.push([p,4],[p+1,4],[p+2,4]);
    blocks.push([p+1,2],[p+2,2]);
    blocks.push([p,0],[p+1,0],[p+2,0]);
    p+=4;
    // T
    blocks.push([p,4],[p+1,4],[p+2,4]);
    for(let y=0;y<5;y++) blocks.push([p+1,y]);
    // Dedupe
    const seen = new Set(), out = [];
    for(const [pos,dy] of blocks) {
      const k = pos+','+dy;
      if(!seen.has(k)){seen.add(k);out.push([pos,dy]);}
    }
    return out;
  }

  // Place one block by flying to position and using placeBlock
  async function flyAndPlace(botX, botY, botZ, targetX, targetY, targetZ, refX, refY, refZ) {
    // Fly bot to hovering position (3 blocks from wall)
    bot.chat('/tp BuilderBot '+botX+' '+botY+' '+botZ);
    await sleep(350);
    
    // Ensure ref block is solid
    const ref = bot.blockAt(vec3(refX,refY,refZ));
    if(!ref || ref.name==='air') {
      bot.chat('/setblock '+refX+' '+refY+' '+refZ+' bricks');
      await sleep(80);
    }
    
    // Equip gold
    await bot.creative.setInventorySlot(36, new PI(goldItem.id, 64));
    await sleep(30);
    const g = bot.inventory.items().find(i=>i.name==='gold_block');
    if(g) await bot.equip(g,'hand');
    
    // Look at ref and place
    const refBlock = bot.blockAt(vec3(refX,refY,refZ));
    if(refBlock && refBlock.name !== 'air') {
      const face = vec3(targetX-refX, targetY-refY, targetZ-refZ);
      try {
        await bot.lookAt(refBlock.position.offset(0.5,0.5,0.5));
        await sleep(200);
        await bot.placeBlock(refBlock, face);
        return true;
      } catch(e) {
        bot.chat('/setblock '+targetX+' '+targetY+' '+targetZ+' gold_block');
        return true;
      }
    }
    bot.chat('/setblock '+targetX+' '+targetY+' '+targetZ+' gold_block');
    return true;
  }

  bot.chat('Starting TECH placement — watch me fly around the tower!');
  
  // === SOUTH FACE (z=ntz, protrude to z=ntz-1, bot hovers at z=ntz-4) ===
  bot.chat('Flying to south face...');
  const southTech = makeTECH(1); // starts at offset 1
  let placed = 0;
  for(const [px,dy] of southTech) {
    const tx=ntx+px, ty=LY+dy, tz=ntz-1; // target (protruding)
    const rx=tx, ry=ty, rz=ntz; // ref (brick wall)
    await flyAndPlace(tx, ty, tz-3, tx, ty, tz, rx, ry, rz);
    placed++;
    if(placed%8===0) bot.chat('South: '+placed+'/'+southTech.length);
  }
  bot.chat('South face done! '+placed+' blocks');
  await sleep(1000);

  // === NORTH FACE (z=ntz+NTD, protrude to z=ntz+NTD+1, bot at z=ntz+NTD+4) ===
  bot.chat('Flying to north face...');
  const northTech = makeTECH(1);
  placed = 0;
  for(const [px,dy] of northTech) {
    const tx=ntx+px, ty=LY+dy, tz=ntz+NTD+1;
    const rx=tx, ry=ty, rz=ntz+NTD;
    await flyAndPlace(tx, ty, tz+3, tx, ty, tz, rx, ry, rz);
    placed++;
    if(placed%8===0) bot.chat('North: '+placed+'/'+northTech.length);
  }
  bot.chat('North face done!');
  await sleep(1000);

  // === WEST FACE (x=ntx, protrude to x=ntx-1, bot at x=ntx-4) ===
  bot.chat('Flying to west face...');
  const westTech = makeTECH(1);
  placed = 0;
  for(const [pz,dy] of westTech) {
    const tx=ntx-1, ty=LY+dy, tz=ntz+pz;
    const rx=ntx, ry=ty, rz=tz;
    await flyAndPlace(tx-3, ty, tz, tx, ty, tz, rx, ry, rz);
    placed++;
    if(placed%8===0) bot.chat('West: '+placed+'/'+westTech.length);
  }
  bot.chat('West face done!');
  await sleep(1000);

  // === EAST FACE (x=ntx+NTW, protrude to x=ntx+NTW+1, bot at x=ntx+NTW+4) ===
  bot.chat('Flying to east face...');
  const eastTech = makeTECH(1);
  placed = 0;
  for(const [pz,dy] of eastTech) {
    const tx=ntx+NTW+1, ty=LY+dy, tz=ntz+pz;
    const rx=ntx+NTW, ry=ty, rz=tz;
    await flyAndPlace(tx+3, ty, tz, tx, ty, tz, rx, ry, rz);
    placed++;
    if(placed%8===0) bot.chat('East: '+placed+'/'+eastTech.length);
  }
  bot.chat('East face done!');
  
  bot.chat('ALL 4 FACES COMPLETE! Convex TECH on every side.');
  bot.chat('/tp alphasuperduper 537 -8 -458 0 -5');
  console.log('ALL DONE');
  // Stay connected
});
bot.on('error', e => console.log('Err:', e.message));
bot.on('kicked', r => { console.log('Kicked:', JSON.stringify(r)); process.exit(1); });
bot.on('end', () => process.exit(0));
