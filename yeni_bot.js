const mineflayer = require('mineflayer');
const AutoAuth = require('mineflayer-auto-auth');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const GoalNear = goals.GoalNear;
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const msgPath = path.join(__dirname, 'msgbotmesaj.json');

// --- AYARLAR ---
const BOT_COUNT = 3; // İstediğiniz bot sayısını buraya yazın

const MESSAGE_DELAY = 1000; // Mesaj bombası atma süresi (milisaniye cinsinden). 1000 = 1 saniye
const PUBLIC_BOMB_DELAY = 2500; // Normal sohbet bombası atma süresi (milisaniye cinsinden). 2500 = 2.5 saniye
// ---------------

function startBot(botUsername) {
    let msgBombInterval = null;
    let publicBombInterval = null;
    let randomLookInterval = null;
    let randomMoveInterval = null;
    let randomSwingInterval = null;

    // Config dosyasını her başlatmada güncel olarak oku
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
        console.error('[Hata] config.json okunamadı!', err);
        return;
    }

    console.log(`[Sistem] Yeni bot başlatılıyor: ${botUsername}`);

    const bot = mineflayer.createBot({
        username: botUsername,
        version: '1.20',
        host: config.serverIP,
        port: 25565,
        auth: 'offline',
        plugins: [AutoAuth],
        AutoAuth: config.dupeBotPassword || ''
    });

    bot.loadPlugin(pathfinder);

    bot.on('spawn', () => {
        console.log(`[Sistem] ${bot.username} başarıyla sunucuya (veya yeni bir dünyaya) bağlandı.`);

        // Önceki hareket döngülerini temizle (Auth ve Ana sunucu geçişinde üst üste binmesin)
        if (randomLookInterval) clearInterval(randomLookInterval);
        if (randomMoveInterval) clearInterval(randomMoveInterval);
        if (randomSwingInterval) clearInterval(randomSwingInterval);

        // Oyuna girince 1 kere zıplar
        setTimeout(() => {
            if (bot && bot.entity) {
                try {
                    bot.setControlState('jump', true);
                    setTimeout(() => {
                        if (bot) bot.setControlState('jump', false);
                    }, 300);
                } catch (e) {
                    console.log('Jump error:', e);
                }
            }
        }, 1000);

        // Config.json üzerinden Auto Login / Register ve Kendi TPA
        setTimeout(() => {
            if (config.autoRegisterCommand) {
                bot.chat(config.autoRegisterCommand);
                console.log('[Sistem] Kayıt (Register) komutu gönderildi.');
            }

            setTimeout(() => {
                if (config.autoLoginCommand) {
                    bot.chat(config.autoLoginCommand);
                    console.log('[Sistem] Giriş (Login) komutu gönderildi.');
                }

                // Kendi (Owner) TPA
                setTimeout(() => {
                    if (config.autoTpaOnSpawn && config.owner) {
                        bot.chat(`/tpa ${config.owner}`);
                        console.log(`[Sistem] Kendi TPA: ${config.owner} kişisine istek gönderildi.`);
                    }
                }, 2000);
            }, 1000);
        }, 1000);

        // Anti-Bot atlatmak için rastgele hareket (NPC değilmiş gibi davranma)
        randomLookInterval = setInterval(() => {
            if (bot && bot.entity) {
                const yaw = (Math.random() * Math.PI * 2) - Math.PI; // -180 ile 180 derece
                const pitch = (Math.random() * Math.PI) - (Math.PI / 2); // Aşağı ve yukarı
                bot.look(yaw, pitch, true).catch(() => { });
            }
        }, 3500); // 3.5 saniyede bir kafa çevirir

        randomMoveInterval = setInterval(() => {
            if (bot && bot.entity && bot.entity.position) {
                // Sadece güvenli bir şekilde yere bastığında ve bir yere gitmiyorsa hareket et
                if (!bot.pathfinder.isMoving()) {
                    try {
                        const defaultMove = new Movements(bot);
                        defaultMove.allowFreeClearance = true;
                        bot.pathfinder.setMovements(defaultMove);

                        // Olduğu konumdan rastgele X ve Z yönlerinde 2-4 blok uzağa gitmeyi dene
                        const randomX = bot.entity.position.x + (Math.random() * 8 - 4);
                        const randomZ = bot.entity.position.z + (Math.random() * 8 - 4);
                        const goal = new GoalNear(randomX, bot.entity.position.y, randomZ, 1);
                        bot.pathfinder.setGoal(goal);
                    } catch (e) {
                        // Yol bulamazsa sessiz kal
                    }
                }
            }
        }, 6000); // 6 saniyede bir yeni bir hedefe gerçekçi bir şekilde yürür

        randomSwingInterval = setInterval(() => {
            if (bot && bot.entity) bot.swingArm('right');
        }, 2500); // 2.5 saniyede bir yumruk atar
    });

    bot.on('message', (jsonMsg) => {
        const msg = jsonMsg.toString();
        if (msg.trim()) {
            console.log(`[Sohbet] ${msg}`);

            const lowerMsg = msg.toLowerCase();
            // Chat üzerinden gelen giriş/kayıt uyarılarına karşı otomatik komutlar
            if (lowerMsg.includes('/login') && config.autoLoginCommand) {
                bot.chat(config.autoLoginCommand);
            }
            if (lowerMsg.includes('/register') && config.autoRegisterCommand) {
                bot.chat(config.autoRegisterCommand);
            }
        }
    });

    // Basit Chat Komutları
    const prefix = '!!!';
    bot.on('chat', (username, message) => {
        // Sadece adminler komut kullanabilir
        if (!config.admins || !config.admins.includes(username)) return;

        if (message.startsWith(`${prefix}ownertpa`)) {
            bot.chat(`/tpa ${username}`);
            console.log(`[Komut] ${username} kişisine TPA atıldı.`);
        }
        else if (message.startsWith(`${prefix}tpakabul`)) {
            bot.chat(`/tpaccept ${username}`);
            console.log(`[Komut] ${username} kişisinin TPA isteği kabul edildi.`);
        }
        else if (message.startsWith(`${prefix}kill`)) {
            bot.chat('/kill');
        }
        else if (message.startsWith(`${prefix}msgbomm `)) {
            const parts = message.trim().split(/\s+/);
            if (parts.length >= 2) {
                const targetPlayers = parts.slice(1);
                if (msgBombInterval) clearInterval(msgBombInterval);

                let count = 0;
                let currentPlayerIndex = 0; // Sırayla atmak için indeks

                // Ayarlanan süreye göre mesaj gönderir
                msgBombInterval = setInterval(() => {
                    count++;

                    let mesajlar = ["selam"];
                    try {
                        mesajlar = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
                    } catch (e) { }

                    const rastgeleMesaj = mesajlar[Math.floor(Math.random() * mesajlar.length)];

                    // Sırada hangi oyuncu varsa onu seçer
                    const player = targetPlayers[currentPlayerIndex];
                    bot.chat(`/msg ${player} ${rastgeleMesaj}`);

                    // Bir sonraki oyuncuya geç, listenin sonuna geldiyse başa dön
                    currentPlayerIndex++;
                    if (currentPlayerIndex >= targetPlayers.length) {
                        currentPlayerIndex = 0;
                    }
                }, MESSAGE_DELAY);
                console.log(`[Komut] ${targetPlayers.join(', ')} oyuncularına sırayla mesaj bombası başlatıldı.`);
            }
        }
        else if (message === `${prefix}durmsg`) {
            if (msgBombInterval) {
                clearInterval(msgBombInterval);
                msgBombInterval = null;
                console.log(`[Komut] Mesaj bombası durduruldu.`);
            }
        }
        else if (message === `${prefix}bomb`) {
            if (publicBombInterval) clearInterval(publicBombInterval);

            publicBombInterval = setInterval(() => {
                let mesajlar = ["selam"];
                try {
                    mesajlar = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
                } catch (e) { }

                const rastgeleMesaj = mesajlar[Math.floor(Math.random() * mesajlar.length)];

                // Normal sohbete rastgele mesaj atar
                bot.chat(rastgeleMesaj);
            }, PUBLIC_BOMB_DELAY);

            console.log(`[Komut] Normal sohbet bombası başlatıldı.`);
        }
        else if (message === `${prefix}bombdur` || message === `${prefix}bomb dur`) {
            if (publicBombInterval) {
                clearInterval(publicBombInterval);
                publicBombInterval = null;
                console.log(`[Komut] Normal sohbet bombası durduruldu.`);
            }
        }
    });

    bot.on('end', () => {
        if (msgBombInterval) clearInterval(msgBombInterval);
        if (publicBombInterval) clearInterval(publicBombInterval);
        if (randomLookInterval) clearInterval(randomLookInterval);
        if (randomMoveInterval) clearInterval(randomMoveInterval);
        if (randomSwingInterval) clearInterval(randomSwingInterval);
        console.log(`[Sistem] ${botUsername} bağlantısı koptu. 30 saniye sonra yeniden bağlanılıyor...`);
        setTimeout(() => startBot(botUsername), 30000);
    });

    bot.on('error', (err) => {
        console.log(`[Hata] ${err.message}`);
    });

    bot.on('kicked', (reason) => {
        console.log(`[Kick] Sunucudan atıldı: ${reason}`);
    });
}

// Config oku ve botları başlat
function startAllBots() {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
        console.error('[Hata] config.json okunamadı!', err);
        return;
    }

    let names = [];
    for (let i = 1; i <= BOT_COUNT; i++) {
        names.push(`msgbotzPeaw${i}`);
    }

    console.log(`[Sistem] Toplam ${names.length} bot başlatılacak...`);
    names.forEach((name, index) => {
        // Sunucuya aynı anda çok yüklenmemek için her bota 10 saniye gecikme verelim
        setTimeout(() => {
            startBot(name);
        }, index * 10000);
    });
}

startAllBots();
