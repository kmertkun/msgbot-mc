const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mineflayer = require('mineflayer');
const { mineflayer: viewer } = require('prismarine-viewer');
const AutoAuth = require('mineflayer-auto-auth');
const Vec3 = require('vec3');
const config = require('./config.json');
const fs = require('fs');

function saveConfig() {
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
  io.emit('admins', { admins: config.admins || [] });
}

// ─── Web Server ───
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;

// ─── Bot State ───
let bot = null;
let botOnline = false;

const dupeConfig = {
  enabled: false, range: 5, maxFrames: 10, maxPlacements: 7,
  maxSwaps: 15, maxInventoryMoves: 15, tickInterval: 25,
  attackDelay: 75, frameCheckInterval: 5000,
  dupeItems: [
    'shulker_box', 'white_shulker_box', 'orange_shulker_box', 'magenta_shulker_box',
    'light_blue_shulker_box', 'yellow_shulker_box', 'lime_shulker_box',
    'pink_shulker_box', 'gray_shulker_box', 'light_gray_shulker_box',
    'cyan_shulker_box', 'purple_shulker_box', 'blue_shulker_box',
    'brown_shulker_box', 'green_shulker_box', 'red_shulker_box', 'black_shulker_box'
  ]
};

let dupeStats = { totalDuped: 0, placements: 0, swaps: 0, moves: 0, sessionStart: null };
const dontHit = new Set();
let dupeInterval = null, frameCheckInterval = null, pingInterval = null, statsInterval = null;

// ─── Helpers ───
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isDupeItem = name => name && dupeConfig.dupeItems.some(d => name.includes(d));

function log(msg, type = '') {
  if (!msg) return;
  console.log(msg);
  io.emit('log', { message: msg, type });
}

let lastKnownPosition = null;

function getBotPosition() {
  // Try bot.entity.position first
  if (bot?.entity?.position) {
    const p = bot.entity.position;
    if (!isNaN(p.x) && !isNaN(p.y) && !isNaN(p.z)) {
      lastKnownPosition = p;
      return p;
    }
  }
  return lastKnownPosition;
}

function getFramesInRange() {
  if (!bot || !bot.entity) return [];
  const pos = getBotPosition();
  if (!pos) return [];

  const rangeSq = dupeConfig.range * dupeConfig.range;
  const frames = [];

  for (const entity of Object.values(bot.entities)) {
    if (entity.name === 'item_frame' || entity.name === 'glow_item_frame') {
      if (!entity.position || isNaN(entity.position.x)) continue;
      const distSq = pos.distanceSquared(entity.position);
      if (distSq <= rangeSq) {
        frames.push({ entity, distSq });
      }
    }
  }

  frames.sort((a, b) => a.distSq - b.distSq);
  return frames.slice(0, dupeConfig.maxFrames).map(f => f.entity);
}

function isFrameEmpty(frame) {
  const item = frame.metadata?.[8];
  return !item || !item.present;
}

function frameHasDupeItem(frame) {
  const item = frame.metadata?.[8];
  if (!item || !item.present) return false;
  const itemId = item.itemId;
  const itemName = bot.registry?.items?.[itemId]?.name;
  return isDupeItem(itemName);
}

function findDupeItemInHotbar() {
  const inv = bot.inventory;
  for (let s = 0; s < 9; s++) { const it = inv.slots[inv.hotbarStart + s]; if (it && isDupeItem(it.name)) return s; }
  return -1;
}

function findDupeItemInInventory() {
  for (const it of bot.inventory.items()) {
    if (it && isDupeItem(it.name) && it.slot >= bot.inventory.inventoryStart && it.slot < bot.inventory.hotbarStart) return it.slot;
  }
  return -1;
}

async function ensureHoldingDupeItem() {
  if (bot.heldItem && isDupeItem(bot.heldItem.name)) return true;

  if (dupeStats.swaps < dupeConfig.maxSwaps) {
    const hotbarSlot = findDupeItemInHotbar();
    if (hotbarSlot !== -1) {
      bot.setQuickBarSlot(hotbarSlot);
      dupeStats.swaps++;
      return bot.heldItem && isDupeItem(bot.heldItem.name);
    }
  }

  if (dupeStats.moves < dupeConfig.maxInventoryMoves && dupeStats.swaps === 0) {
    const invSlot = findDupeItemInInventory();
    if (invSlot !== -1) {
      try {
        await bot.clickWindow(invSlot, 0, 0);
        await bot.clickWindow(bot.inventory.hotbarStart + bot.quickBarSlot, 0, 0);
        if (bot.inventory.selectedItem) await bot.clickWindow(invSlot, 0, 0);
        dupeStats.moves++;
        return bot.heldItem && isDupeItem(bot.heldItem.name);
      } catch (e) { log(`[Frame] Move error: ${e.message}`, 'error'); }
    }
  }
  return false;
}

async function placeItemInFrame(frame) {
  try {
    await bot.activateEntity(frame);
    dontHit.delete(frame.id);
    dupeStats.placements++;
    return true;
  } catch (e) {
    log(`[Frame] Place error: ${e.message}`, 'error');
    return false;
  }
}

function attackFrame(frame) {
  try {
    bot.attack(frame);
    dupeStats.totalDuped++;
    dontHit.add(frame.id);
    if (dupeStats.totalDuped % 50 === 0) log(`[Dupe] Toplam: ${dupeStats.totalDuped}`, 'system');
    return true;
  } catch (e) {
    log(`[Frame] Attack error: ${e.message}`, 'error');
    return false;
  }
}

async function handleNormalMode() {
  if (!dupeConfig.enabled || !bot || !bot.entity) return;

  dupeStats.placements = 0;
  dupeStats.swaps = 0;
  dupeStats.moves = 0;

  const frames = getFramesInRange();
  if (frames.length === 0) return;

  const emptyFrames = [];
  const filledFrames = [];

  for (const frame of frames) {
    if (isFrameEmpty(frame)) {
      emptyFrames.push(frame);
    } else if (frameHasDupeItem(frame)) {
      filledFrames.push(frame);
    }
  }

  for (const emptyFrame of emptyFrames) {
    if (dupeStats.placements >= dupeConfig.maxPlacements) break;
    const hasItem = await ensureHoldingDupeItem();
    if (!hasItem) break;
    await placeItemInFrame(emptyFrame);
  }

  for (const filledFrame of filledFrames) {
    if (!dontHit.has(filledFrame.id)) {
      attackFrame(filledFrame);
    }
  }
}

function startDupe() {
  if (dupeInterval) return;

  dupeConfig.enabled = true;
  dupeStats.sessionStart = Date.now();
  dontHit.clear();
  log('[Frame] Dupe başlatıldı!', 'system');

  const shulker = bot.inventory.items().find(item => isDupeItem(item.name));
  if (shulker) {
    bot.equip(shulker, 'hand');
    log(`[Frame] Equipping: ${shulker.name}`, 'system');
  } else {
    log('[Frame] UYARI: Envanterde shulker yok!', 'error');
  }

  dupeInterval = setInterval(async () => {
    if (!dupeConfig.enabled) return;
    await handleNormalMode();
  }, dupeConfig.tickInterval);

  frameCheckInterval = setInterval(async () => { if (dupeConfig.enabled) await checkAndReplaceFrames(); }, dupeConfig.frameCheckInterval);
  if (!pingInterval) pingInterval = setInterval(updatePing, 1000);

  // Auto chest storage check every 10 seconds
  if (!chestCheckInterval) chestCheckInterval = setInterval(autoChestCheck, 10000);
}

function stopDupe() {
  dupeConfig.enabled = false;
  if (dupeInterval) { clearInterval(dupeInterval); dupeInterval = null; }
  if (frameCheckInterval) { clearInterval(frameCheckInterval); frameCheckInterval = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (chestCheckInterval) { clearInterval(chestCheckInterval); chestCheckInterval = null; }
  dontHit.clear();
  log(`[Frame] Dupe durduruldu. Toplam: ${dupeStats.totalDuped}`, 'system');
}

async function checkAndReplaceFrames() {
  if (!dupeConfig.enabled || !bot?.entity) return;
  const frames = getFramesInRange();
  if (frames.length > 0) return;
  const frameItem = bot.inventory.items().find(i => i.name === 'item_frame');
  if (!frameItem) {
    if (debugCounter % 200 === 0) log('[Frame] UYARI: Envanterde item_frame yok!', 'error');
    return;
  }
  try {
    await bot.equip(frameItem, 'hand');
    const pos = bot.entity.position;
    for (const d of [new Vec3(-1, 1, 0), new Vec3(1, 1, 0), new Vec3(0, 1, -1), new Vec3(0, 1, 1)]) {
      const block = bot.blockAt(pos.offset(d.x, d.y, d.z));
      if (block && block.name !== 'air') {
        await bot.placeBlock(block, new Vec3(-d.x, 0, -d.z).normalize());
        log('[Frame] Yeni frame yerleştirildi', 'system');
        const s = bot.inventory.items().find(i => isDupeItem(i.name));
        if (s) await bot.equip(s, 'hand');
        break;
      }
    }
  } catch (e) { log(`[Frame] Frame yerleştirme hatası: ${e.message}`, 'error'); }
}

// ─── Chest Storage ───
let isStoringItems = false;
let chestCheckInterval = null;

function findNearbyChests() {
  if (!bot?.entity) { log('[Sandık-Debug] bot.entity yok', 'error'); return []; }
  const pos = getBotPosition();
  if (!pos) { log('[Sandık-Debug] pozisyon alınamadı', 'error'); return []; }

  const chestNames = ['chest', 'trapped_chest', 'ender_chest', 'barrel'];
  const basePos = pos.floored();
  const chests = [];

  const r = 4;
  for (let x = -r; x <= r; x++) {
    for (let y = -r; y <= r; y++) {
      for (let z = -r; z <= r; z++) {
        const blockPos = basePos.offset(x, y, z);
        const block = bot.blockAt(blockPos);
        if (block && chestNames.includes(block.name)) {
          chests.push(block);
        }
      }
    }
  }

  // En yakın olanları önce denemek için sıralayalım
  chests.sort((a, b) => pos.distanceTo(a.position) - pos.distanceTo(b.position));

  if (chests.length === 0) {
    log(`[Sandık-Debug] ${r} blok etrafta chest/barrel bulunamadı.`, 'error');
  } else {
    log(`[Sandık-Debug] Etrafta ${chests.length} adet sandık bulundu.`, 'info');
  }

  return chests;
}

async function storeItemsInChest(keepCount = 1) {
  if (isStoringItems) { log('[Sandık-Debug] Zaten bir işlem sürüyor (isStoringItems=true)', 'error'); return false; }
  if (!bot?.entity) { log('[Sandık-Debug] Bot entity hazır değil', 'error'); return false; }

  const chests = findNearbyChests();
  if (chests.length === 0) {
    return false;
  }

  const shulkers = bot.inventory.items().filter(i => isDupeItem(i.name));
  if (shulkers.length <= keepCount) {
    log(`[Sandık] Envanterde sandığa koyacak kadar shulker yok (Var: ${shulkers.length}, En az gereken: ${keepCount + 1})`, 'error');
    return false; // Already at or below keep count
  }

  isStoringItems = true;
  const toStore = shulkers.length - keepCount;
  log(`[Sandık] Toplam ${toStore} shulker sandıklara yerleştirilecek.`, 'system');

  let stored = 0;

  try {
    for (const chestBlock of chests) {
      if (stored >= toStore) break;

      try {
        log(`[Sandık-Debug] Sandık deneniyor: ${chestBlock.position}`, 'info');
        await bot.lookAt(chestBlock.position.offset(0.5, 0.5, 0.5), true);
        await sleep(200);

        log(`[Sandık-Debug] Sandık açılıyor...`, 'info');
        const chest = await Promise.race([
          bot.openContainer(chestBlock),
          sleep(3000).then(() => { throw new Error('openContainer zaman aşımı'); })
        ]);
        await sleep(300);

        log(`[Sandık-Debug] Sandık açıldı. Eşyalar konuluyor...`, 'info');

        // Yeniden envanteri kontrol et çünkü her sandıkta eşya sayısı değişti
        const itemsToStore = bot.inventory.items().filter(i => isDupeItem(i.name));

        for (let idx = 0; idx < itemsToStore.length && stored < toStore; idx++) {
          const item = itemsToStore[idx];
          try {
            log(`[Sandık-Debug] ${item.name} deposit ediliyor...`, 'info');
            await chest.deposit(item.type, null, item.count);
            stored++;
            log(`[Sandık] ${item.name} konuldu (${stored}/${toStore})`, 'system');
            await sleep(200);
          } catch (e) {
            log(`[Sandık] Bu sandık dolu veya hata oluştu, diğer sandığa geçiliyor...`, 'error');
            break; // İç döngüyü kır, sandığı kapat ve diğer sandığa geç
          }
        }

        chest.close();
        await sleep(200);

      } catch (e) {
        log(`[Sandık-Debug] Bu sandık açılamadı (${e.message}). Sonrakine geçiliyor...`, 'error');
        continue; // Hata olsa da diğer sandıklara bakmaya devam et
      }
    }

    log(`[Sandık] İşlem tamamlandı! Toplam ${stored} shulker yerleştirildi.`, 'system');

    // Re-equip a shulker after storing
    await sleep(200);
    const remaining = bot.inventory.items().find(i => isDupeItem(i.name));
    if (remaining) {
      bot.equip(remaining, 'hand');
    }

    return stored > 0;
  } catch (e) {
    log(`[Sandık] Genel hata: ${e.message}`, 'error');
    return false;
  } finally {
    isStoringItems = false;
  }
}

async function autoChestCheck() {
  if (!dupeConfig.enabled || !bot?.entity || isStoringItems) return;

  const shulkers = bot.inventory.items().filter(i => isDupeItem(i.name));
  // If we have 5 or more shulkers, try to store excess
  if (shulkers.length >= 5) {
    const chests = findNearbyChests();
    if (chests.length > 0) {
      log(`[Sandık] Envanter doluyor (${shulkers.length} shulker), sandıklara aktarılıyor...`, 'system');
      // Temporarily pause dupe
      const wasDuping = dupeConfig.enabled;
      isRunning = true;
      await storeItemsInChest(10);
      isRunning = false;
    }
  }
}

function updatePing() {
  if (!bot?.player) return;
  const ping = bot.player.ping;
  if (ping <= 0) return;
  let m = ping <= 70 ? 1.5 : ping <= 100 ? 2 : ping <= 150 ? 2.5 : ping <= 200 ? 3 : ping <= 300 ? 4 : ping <= 450 ? 5 : ping <= 600 ? 6 : 7;
  dupeConfig.tickInterval = Math.round(35 * m);
  dupeConfig.attackDelay = Math.round(15 * m);
  if (ping > 800 && dupeConfig.enabled) { log('[Frame] Ping çok yüksek, dupe duraklatıldı', 'error'); dupeConfig.enabled = false; }
}

function formatUptime() {
  if (!dupeStats.sessionStart) return '--';
  const s = Math.floor((Date.now() - dupeStats.sessionStart) / 1000);
  return `${Math.floor(s / 3600)}s ${Math.floor((s % 3600) / 60)}d ${s % 60}s`;
}

function sendStats() {
  const frames = bot?.entity ? getFramesInRange().length : 0;
  io.emit('stats', {
    totalDuped: dupeStats.totalDuped,
    sessionDuped: dupeStats.totalDuped, // Assuming totalDuped is session-based here, or add a session counter
    frames,
    placements: dupeStats.placements,
    swaps: dupeStats.swaps,
    moves: dupeStats.moves,
    ping: bot?.player?.ping || 0,
    health: bot?.health || 0,
    food: bot?.food || 0,
    pos: (() => {
      const p = getBotPosition();
      return p ? `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}` : '--';
    })(),
    dupeEnabled: dupeConfig.enabled,
    uptime: dupeConfig.enabled ? formatUptime() : '--'
  });
}

function sendInventory() {
  if (!bot) return;
  const grouped = {};
  for (const i of bot.inventory.items()) {
    if (!isDupeItem(i.name)) continue;
    const name = i.displayName || i.name;
    grouped[name] = (grouped[name] || 0) + i.count;
  }
  const items = Object.entries(grouped).map(([name, count]) => ({ name, count }));
  io.emit('inventory', { items });
}

// ─── Bot Creation ───
function startBot() {
  bot = mineflayer.createBot({
    username: config.username || 'DupeBotzp62', version: '1.20',
    host: config.serverIP, port: 25565, auth: 'offline',
    plugins: [AutoAuth], AutoAuth: config.dupeBotPassword
  });

  let spawnCount = 0;
  bot.on('spawn', () => {
    spawnCount++;
    botOnline = true;
    const pos = bot.entity?.position;
    log(`[Bot] Spawn #${spawnCount} | Pos: ${pos ? pos.toString() : 'unknown'}`, 'system');
    io.emit('bot_status', { online: true, username: bot.username, server: config.serverIP });

    // Track position
    if (pos && !isNaN(pos.x)) lastKnownPosition = pos;

    // Wait for position to stabilize, then check again
    setTimeout(() => {
      const p = getBotPosition();
      log(`[Bot] Position check: ${p ? p.toString() : 'still NaN'}`, 'info');
      sendInventory();
    }, 3000);

    if (!statsInterval) statsInterval = setInterval(() => { sendStats(); sendInventory(); }, 1000);

    // Live View
    try {
      viewer(bot, { port: 3007, firstPerson: true });
      log('[Sistem] Canlı görüntü 3007 portunda başlatıldı.', 'system');
    } catch (e) {
      log(`[Hata] Canlı görüntü başlatılamadı: ${e.message}`, 'error');
    }
  });

  // Track position via physicsTick
  bot.on('physicsTick', () => {
    if (bot?.entity?.position) {
      const p = bot.entity.position;
      if (!isNaN(p.x) && !isNaN(p.y) && !isNaN(p.z)) {
        lastKnownPosition = p;
      }
    }
  });

  bot.on('message', (jsonMsg) => {
    const msg = jsonMsg.toString();
    if (msg.trim()) {
      log(msg);

      // Auto-move if server restricts chat
      const restrictMsgs = ['talk until you move', 'konuşabilmek için hareket', 'hareket etmelisin'];
      if (restrictMsgs.some(m => msg.toLowerCase().includes(m))) {
        log('[Bot] Sohbet kısıtlaması algılandı, otomatik hareket ediliyor...', 'system');
        bot.setControlState('jump', true);
        bot.setControlState('right', true);
        setTimeout(() => {
          bot.setControlState('jump', false);
          bot.setControlState('right', false);
        }, 500);
      }
    }
  });

  const prefix = '!!!';
  bot.on('chat', (username, message) => {
    // We don't emit chat_message anymore as bot.on('message') handles all logging
    if (!config.admins.includes(username)) return;

    if (message.startsWith(`${prefix}dupe`)) { startDupe(); bot.chat(`${username} Frame Dupe başladı.`); }
    else if (message.startsWith(`${prefix}dur`)) { stopDupe(); bot.chat(`${username} Dupe durduruldu.`); }
    else if (message.startsWith(`${prefix}kill`)) bot.chat('/kill');
    else if (message.startsWith(`${prefix}item`)) { const s = bot.inventory.items().find(i => isDupeItem(i.name)); if (s) bot.equip(s, 'hand'); }
    else if (message.startsWith(`${prefix}stats`)) bot.chat(`Duped: ${dupeStats.totalDuped}`);
    else if (message.startsWith(`${prefix}boşal`) || message.startsWith(`${prefix}bosal`)) {
      bot.look(-Math.PI / 2, -Math.PI / 4, true);
      const di = setInterval(async () => {
        const s = bot.inventory.items().find(i => i.name.includes('shulker_box'));
        if (s) { try { await bot.tossStack(s); } catch (e) { } } else { clearInterval(di); log('[Frame] Tüm shulkerlar atıldı', 'system'); }
      }, 500);
    }
    else if (message.startsWith(`${prefix}yat`)) {
      const beds = ['white_bed', 'orange_bed', 'magenta_bed', 'light_blue_bed', 'yellow_bed', 'lime_bed', 'pink_bed', 'gray_bed', 'light_gray_bed', 'cyan_bed', 'purple_bed', 'blue_bed', 'brown_bed', 'green_bed', 'red_bed', 'black_bed'];
      const bed = bot.findBlock({ matching: b => beds.includes(b.name), maxDistance: 3 });
      if (bed) bot.sleep(bed).then(() => bot.chat('Yatağa yattım!')).catch(e => log(`[Frame] Yatak: ${e.message}`, 'error'));
      else bot.chat('Yakında yatak yok!');
    }
    else if (message.startsWith(`${prefix}tpakabul`)) bot.chat(`/tpaccept ${username}`);
    else if (message.startsWith(`${prefix}ownertpa`)) bot.chat(`/tpa ${username}`);
    else if (message.startsWith(`${prefix}sandik`) || message.startsWith(`${prefix}sandık`)) {
      storeItemsInChest(1).then(ok => {
        if (ok) bot.chat('Shulkerlar sandığa konuldu!');
        else bot.chat('Yakında sandık yok veya envanter zaten uygun.');
      });
    }
    else if (message.startsWith(`${prefix}debug`)) {
      const near = Object.values(bot.entities).filter(e => bot.entity.position.distanceTo(e.position) < 10);
      bot.chat(`Etrafımda ${near.length} entity var. Yakındakiler: ${near.map(e => e.name).slice(0, 5).join(', ')}`);
      log(`[Debug] Yakındaki entityler: ${near.map(e => `${e.name}(${Math.round(bot.entity.position.distanceTo(e.position))}m)`).join(', ')}`, 'info');
    }
    else if (message.startsWith(`${prefix}admin ekle`) && username === 'zPeaw') {
      const target = message.split(' ')[2];
      if (target && !config.admins.includes(target)) {
        config.admins.push(target);
        saveConfig();
        bot.chat(`${target} admin olarak eklendi.`);
      }
    }
    else if (message.startsWith(`${prefix}admin cikar`) && username === 'zPeaw') {
      const target = message.split(' ')[2];
      if (target && config.admins.includes(target)) {
        config.admins = config.admins.filter(a => a !== target);
        saveConfig();
        bot.chat(`${target} adminlikten cikarildi.`);
      }
    }
  });

  bot.on('kicked', reason => { log(`[Bot] Kicked: ${reason}`, 'error'); botOnline = false; io.emit('bot_status', { online: false, message: 'Kicklendi' }); stopDupe(); });
  bot.on('error', err => { log(`[Bot] Error: ${err.message}`, 'error'); });
  bot.on('end', () => {
    botOnline = false;
    io.emit('bot_status', { online: false, message: 'Bağlantı kesildi, 30s sonra tekrar...' });
    log('[Bot] Bağlantı kesildi, 30s sonra tekrar deneniyor...', 'error');
    stopDupe();
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
    setTimeout(startBot, 30000);
  });
}

// ─── Socket.IO Events ───
io.on('connection', socket => {
  log('[GUI] Kullanıcı bağlandı', 'system');
  socket.emit('bot_status', { online: botOnline, username: bot?.username, server: config.serverIP });
  socket.emit('admins', { admins: config.admins || [] });
  sendStats(); sendInventory();

  socket.on('command', cmd => {
    if (!bot) return;

    // Handle object commands (TPA)
    if (typeof cmd === 'object' && cmd.action === 'tpa') {
      if (cmd.type === 'send') {
        bot.chat(`/tpa ${cmd.username}`);
        log(`[TPA] /tpa ${cmd.username} gönderildi`, 'system');
      } else if (cmd.type === 'accept') {
        bot.chat(`/tpaccept ${cmd.username}`);
        log(`[TPA] /tpaccept ${cmd.username} kabul edildi`, 'system');
      }
      return;
    }

    // String commands
    if (cmd === 'start') startDupe();
    else if (cmd === 'stop') stopDupe();
    else if (cmd === 'kill') bot.chat('/kill');
    else if (cmd === 'item') { const s = bot.inventory.items().find(i => isDupeItem(i.name)); if (s) bot.equip(s, 'hand'); }
    else if (cmd === 'stats') bot.chat(`Duped: ${dupeStats.totalDuped}`);
    else if (cmd === 'bosal') {
      bot.look(-Math.PI / 2, -Math.PI / 4, true);
      const di = setInterval(async () => {
        const s = bot.inventory.items().find(i => i.name.includes('shulker_box'));
        if (s) { try { await bot.tossStack(s); } catch (e) { } } else { clearInterval(di); log('[Frame] Tüm shulkerlar atıldı', 'system'); }
      }, 500);
    }
    else if (cmd === 'dropall') {
      log('[Bot] Tüm envanter atılıyor...', 'system');
      const di = setInterval(async () => {
        const items = bot.inventory.items();
        if (items.length > 0) {
          try { await bot.tossStack(items[0]); } catch (e) { }
        } else {
          clearInterval(di);
          log('[Bot] Tüm envanter atıldı!', 'system');
        }
      }, 300);
    }
    else if (cmd === 'dropshulkers') {
      log('[Bot] Shulkerlar atılıyor...', 'system');
      bot.look(-Math.PI / 2, -Math.PI / 4, true);
      const di = setInterval(async () => {
        const s = bot.inventory.items().find(i => i.name.includes('shulker_box'));
        if (s) { try { await bot.tossStack(s); } catch (e) { } } else { clearInterval(di); log('[Bot] Tüm shulkerlar atıldı!', 'system'); }
      }, 400);
    }
    else if (cmd === 'yat') {
      const beds = ['white_bed', 'orange_bed', 'magenta_bed', 'light_blue_bed', 'yellow_bed', 'lime_bed', 'pink_bed', 'gray_bed', 'light_gray_bed', 'cyan_bed', 'purple_bed', 'blue_bed', 'brown_bed', 'green_bed', 'red_bed', 'black_bed'];
      const bed = bot.findBlock({ matching: b => beds.includes(b.name), maxDistance: 3 });
      if (bed) bot.sleep(bed).catch(e => log(`Yatak: ${e.message}`, 'error'));
    }
    else if (cmd === 'tpaccept') {
      bot.chat('/tpaccept');
      log('[TPA] /tpaccept gönderildi', 'system');
    }
    else if (cmd === 'storeChest') {
      storeItemsInChest(1).then(ok => {
        if (!ok) log('[Sandık] Yakında sandık yok veya envanterde yeterli shulker yok.', 'error');
      });
    }
    else if (cmd === 'reconnect') { bot.end(); }
    else if (cmd === 'jump') {
      if (!bot) return;
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 200);
      log('[Bot] Zıpladı', 'info');
    }
    else if (cmd === 'move_side') {
      if (!bot) return;
      bot.setControlState('right', true);
      setTimeout(() => bot.setControlState('right', false), 500);
      log('[Bot] Yana hareket etti', 'info');
    }
  });

  socket.on('update_config', data => {
    if (data.serverIP) config.serverIP = data.serverIP;
    if (data.botName) config.username = data.botName; // Note: We use username in createBot
    saveConfig();
    log(`[Sistem] Konfigürasyon güncellendi: ${config.serverIP}`, 'system');
  });

  socket.on('update_settings', data => {
    if (data.range) dupeConfig.range = parseInt(data.range);
    if (data.maxFrames) dupeConfig.maxFrames = parseInt(data.maxFrames);
    if (data.maxPlacements) dupeConfig.maxPlacements = parseInt(data.maxPlacements);
    if (data.tickInterval) dupeConfig.tickInterval = parseInt(data.tickInterval);
    if (data.autoFrame !== undefined) dupeConfig.autoFrame = data.autoFrame;
    log('[Sistem] Ayarlar güncellendi.', 'system');
  });

  socket.on('chat', msg => { if (bot) bot.chat(msg); });
});

// ─── Start ───
process.on('uncaughtException', e => { log(`[Error] ${e.message}`, 'error'); });
process.on('unhandledRejection', r => { log(`[Error] ${r}`, 'error'); });

server.listen(PORT, () => {
  console.log(`\n  ⛏️  MC Dupe Bot GUI`);
  console.log(`  ➜  http://localhost:${PORT}\n`);
  startBot();
});
