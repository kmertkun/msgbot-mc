use std::fs::OpenOptions;
use std::io::Write;
use std::time::Duration;

use azalea::prelude::*;
use azalea::pathfinder::goals::BlockPosGoal;
use parking_lot::Mutex;
use chrono::Local;

// ========== BOT İSMİNİ BURADAN DEĞİŞTİR ==========
const BOT_NAME: &str = "tetsbotzp2";
// ===================================================

// Global state
static LOG_FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);
static MESSAGES_RECEIVED: Mutex<usize> = Mutex::new(0);
static BOT_CLIENT: Mutex<Option<Client>> = Mutex::new(None);
static SHOULD_RECONNECT: Mutex<bool> = Mutex::new(true);
static IS_BOMBING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static IS_MSG_SPAMMING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static MSG_SPAM_TARGETS: Mutex<Vec<String>> = Mutex::new(Vec::new());
static HAS_MOVED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static IS_FOLLOWING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static FOLLOW_TARGET: Mutex<String> = Mutex::new(String::new());

pub struct AutoReconnectDelay {
    pub delay: Duration,
}

#[derive(Component, Default, Clone)]
struct State;

#[tokio::main]
async fn main() -> AppExit {
    // Config dosyasını oku
    let config_data = std::fs::read_to_string("../config.json").expect("config.json okunamadı!");
    let config_json: serde_json::Value = serde_json::from_str(&config_data).expect("Hatalı JSON!");
    let server_ip = config_json["serverIP"].as_str().unwrap_or("yapsavun.com").to_string();
    println!("Bot ismi: {}", BOT_NAME);

    let account = Account::offline(BOT_NAME);

    *LOG_FILE.lock() = Some(
        OpenOptions::new()
            .create(true)
            .append(true)
            .open("chat_log.txt")
            .expect("Log dosyası açılamadı")
    );

    tokio::spawn(async move {
        let stdin = tokio::io::stdin();
        let reader = tokio::io::BufReader::new(stdin);
        use tokio::io::AsyncBufReadExt;
        
        let mut lines = reader.lines();
        
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                if let Some(bot) = BOT_CLIENT.lock().as_ref() {
                    let text = line.trim();
                    if text == "/jump" {
                        bot.jump();
                    } else if text == "!!!bomb dur" {
                        IS_BOMBING.store(false, std::sync::atomic::Ordering::Relaxed);
                        println!("Terminalden Mesaj bombası durduruldu.");
                    } else if text == "!!!bomb" {
                        if !IS_BOMBING.load(std::sync::atomic::Ordering::Relaxed) {
                            IS_BOMBING.store(true, std::sync::atomic::Ordering::Relaxed);
                            println!("Terminalden Mesaj bombası başlatıldı.");
                            let bot_clone = bot.clone();
                            tokio::spawn(async move {
                                static MSG_INDEX: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
                                while IS_BOMBING.load(std::sync::atomic::Ordering::Relaxed) {
                                    if let Ok(data) = std::fs::read_to_string("../msgbotmesaj.json") {
                                        if let Ok(messages) = serde_json::from_str::<Vec<String>>(&data) {
                                            if !messages.is_empty() {
                                                let idx = MSG_INDEX.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                                let msg = &messages[idx % messages.len()];
                                                let _ = bot_clone.chat(msg);
                                            }
                                        }
                                    }
                                    tokio::time::sleep(Duration::from_millis(2500)).await;
                                }
                            });
                        }
                    } else if text == "!!!msgspam dur" {
                        IS_MSG_SPAMMING.store(false, std::sync::atomic::Ordering::Relaxed);
                        println!("Terminalden Özel Mesaj bombası durduruldu.");
                    } else if text.starts_with("!!!msgspam ") {
                        let targets_str = text.trim_start_matches("!!!msgspam ").trim();
                        let targets: Vec<String> = targets_str.split_whitespace().map(|s| s.to_string()).collect();
                        if !IS_MSG_SPAMMING.load(std::sync::atomic::Ordering::Relaxed) && !targets.is_empty() {
                            *MSG_SPAM_TARGETS.lock() = targets.clone();
                            IS_MSG_SPAMMING.store(true, std::sync::atomic::Ordering::Relaxed);
                            println!("Terminalden Özel Mesaj bombası başlatıldı. Hedefler: {:?}", targets);
                            let bot_clone = bot.clone();
                            tokio::spawn(async move {
                                static MSG_INDEX: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
                                static TARGET_INDEX: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
                                while IS_MSG_SPAMMING.load(std::sync::atomic::Ordering::Relaxed) {
                                    let current_targets = MSG_SPAM_TARGETS.lock().clone();
                                    if !current_targets.is_empty() {
                                        let delay_ms = 1000 / current_targets.len().max(1);
                                        if let Ok(data) = std::fs::read_to_string("../msgbotmesaj.json") {
                                            if let Ok(messages) = serde_json::from_str::<Vec<String>>(&data) {
                                                if !messages.is_empty() {
                                                    let t_idx = TARGET_INDEX.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                                    let current_target = &current_targets[t_idx % current_targets.len()];
                                                    
                                                    let m_idx = MSG_INDEX.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                                    let msg = &messages[m_idx % messages.len()];
                                                    let _ = bot_clone.chat(&format!("/msg {} {}", current_target, msg));
                                                }
                                            }
                                        }
                                        tokio::time::sleep(Duration::from_millis(delay_ms as u64)).await;
                                    } else {
                                        tokio::time::sleep(Duration::from_millis(1000)).await;
                                    }
                                }
                            });
                        }
                    } else {
                        bot.chat(text);
                    }
                }
            }
        }
    });

    ClientBuilder::new()
        .set_handler(handle)
        .start(account, server_ip)
        .await
}

async fn handle(bot: Client, event: Event, _state: State) -> eyre::Result<()> {
    // İlk bağlantıda bot client'ı kaydet
    if BOT_CLIENT.lock().is_none() {
        *BOT_CLIENT.lock() = Some(bot.clone());
        println!("Sunucuya bağlanıldı!");
    }

    match event {
        Event::Init => {
            HAS_MOVED.store(false, std::sync::atomic::Ordering::Relaxed);
            println!("Oyuna girildi! Fake lobide login gönderiliyor...");

            // Fake lobide login veya register gönder
            let bot_clone = bot.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if let Ok(config_data) = std::fs::read_to_string("../config.json") {
                    if let Ok(config_json) = serde_json::from_str::<serde_json::Value>(&config_data) {
                        if let Some(pass) = config_json["dupeBotPassword"].as_str() {
                            // Önce login dene
                            let _ = bot_clone.chat(&format!("/login {}", pass));
                            println!("Giriş (Login) komutu otomatik gönderildi.");
                        }
                    }
                }
            });
        }
        Event::Chat(m) => {
            let mut messages_received = MESSAGES_RECEIVED.lock();
            *messages_received += 1;
            
            let message = m.message().to_ansi();
            let raw_msg = m.message().to_string().to_lowercase();
            let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
            let log_entry = format!("[{}] #{}: {}\n", timestamp, messages_received, message);
            
            println!("#{}: {}", messages_received, message);
            
            // Log dosyasına yaz
            if let Some(ref mut file) = *LOG_FILE.lock() {
                let _ = file.write_all(log_entry.as_bytes());
                let _ = file.flush();
            }

            // Login başarılı veya oturum bulundu → ana sunucuya geçti, rastgele mesaj gönder
            if (raw_msg.contains("başarıyla giriş") || raw_msg.contains("oturum bulundu") || raw_msg.contains("successfully logged in"))
                && !HAS_MOVED.load(std::sync::atomic::Ordering::Relaxed)
            {
                let bot_clone = bot.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    let _ = bot_clone.chat(".");
                    println!("Hareket tetiklemesi için rastgele mesaj gönderildi.");
                });
            }

            // "You cannot talk until you move" algılanırsa otomatik hareket et + Anti-AFK + Takip başlat
            if raw_msg.contains("you cannot talk until you move") || raw_msg.contains("hareket etmelisiniz") {
                if !HAS_MOVED.load(std::sync::atomic::Ordering::Relaxed) {
                    println!("Hareket gerekli mesajı algılandı! Otomatik hareket başlatılıyor...");
                    let bot_clone = bot.clone();
                    tokio::spawn(async move {
                        // Zıpla + yürü (3-4 blok)
                        bot_clone.jump();
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        bot_clone.sprint(azalea::SprintDirection::Forward);
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        bot_clone.jump();
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        bot_clone.jump();
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        bot_clone.jump();
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        bot_clone.walk(azalea::WalkDirection::None);

                        HAS_MOVED.store(true, std::sync::atomic::Ordering::Relaxed);
                        println!("Hareket tamamlandı! Artık chat kullanılabilir.");

                        // Oyuncu Takip + Anti-AFK döngüsü
                        loop {
                            tokio::time::sleep(Duration::from_secs(3)).await;

                            // Yakındaki oyuncuyu bul ve takip et
                            use azalea::entity::metadata::Player;
                            use azalea::entity::LocalEntity;
                            use bevy_ecs::query::{With, Without};

                            let nearest = bot_clone.nearest_entity_by::<&azalea::player::GameProfileComponent, (With<Player>, Without<LocalEntity>)>(
                                |_: &azalea::player::GameProfileComponent| true,
                            );

                            if let Some(entity_ref) = nearest {
                                let target_pos = entity_ref.position();
                                let bot_pos = {
                                    let pos = bot_clone.component::<azalea::entity::Position>();
                                    **pos
                                };

                                let distance = bot_pos.distance_to(target_pos);
                                let target_name = entity_ref.get_component::<azalea::player::GameProfileComponent>()
                                    .map(|p| p.name.clone())
                                    .unwrap_or_default();

                                if distance <= 20.0 {
                                    // Yakında - pathfinder ile takip et
                                    if !IS_FOLLOWING.load(std::sync::atomic::Ordering::Relaxed) || *FOLLOW_TARGET.lock() != target_name {
                                        *FOLLOW_TARGET.lock() = target_name.clone();
                                        IS_FOLLOWING.store(true, std::sync::atomic::Ordering::Relaxed);
                                        println!("[Takip] {} takip ediliyor (mesafe: {:.1})", target_name, distance);
                                    }
                                    let goal = BlockPosGoal(azalea::BlockPos::from(target_pos.up(0.5)));
                                    bot_clone.start_goto(goal);
                                } else if distance > 50.0 && IS_FOLLOWING.load(std::sync::atomic::Ordering::Relaxed) {
                                    // Çok uzak - tpa at
                                    let target = FOLLOW_TARGET.lock().clone();
                                    if !target.is_empty() {
                                        bot_clone.stop_pathfinding();
                                        let _ = bot_clone.chat(&format!("/tpa {}", target));
                                        println!("[Takip] {} çok uzakta (mesafe: {:.1}), /tpa gönderildi!", target, distance);
                                    }
                                }
                            } else {
                                // Yakında oyuncu yok
                                if IS_FOLLOWING.load(std::sync::atomic::Ordering::Relaxed) {
                                    let target = FOLLOW_TARGET.lock().clone();
                                    bot_clone.stop_pathfinding();
                                    IS_FOLLOWING.store(false, std::sync::atomic::Ordering::Relaxed);
                                    println!("[Takip] {} kayboldu/öldü, takip bırakıldı.", target);
                                }

                                // Anti-AFK zıplama
                                bot_clone.jump();
                            }
                        }
                    });
                }
            }

            // Sohbet üzerinden /login veya /register uyarısı gelirse otomatik yap
            if raw_msg.contains("/login") || raw_msg.contains("/register") || raw_msg.contains("kayıtlı değil") {
                if let Ok(config_data) = std::fs::read_to_string("../config.json") {
                    if let Ok(config_json) = serde_json::from_str::<serde_json::Value>(&config_data) {
                        if let Some(pass) = config_json["dupeBotPassword"].as_str() {
                            if raw_msg.contains("/register") || raw_msg.contains("kayıtlı değil") {
                                let _ = bot.chat(&format!("/register {} {}", pass, pass));
                                println!("Otomatik kayıt (Register) komutu gönderildi.");
                            } else {
                                let _ = bot.chat(&format!("/login {}", pass));
                                println!("Otomatik giriş (Login) komutu gönderildi.");
                            }
                        }
                    }
                }
            }

            // Oyun içi sohbetten veya komuttan mesaj bombasını tetikleme
            if raw_msg.contains("!!!bomb dur") {
                IS_BOMBING.store(false, std::sync::atomic::Ordering::Relaxed);
                println!("Oyun içinden Mesaj bombası durduruldu.");
            } else if raw_msg.contains("!!!bomb") && !IS_BOMBING.load(std::sync::atomic::Ordering::Relaxed) {
                IS_BOMBING.store(true, std::sync::atomic::Ordering::Relaxed);
                println!("Oyun içinden Mesaj bombası başlatıldı.");
                
                let bot_clone = bot.clone();
                tokio::spawn(async move {
                    static MSG_INDEX: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
                    while IS_BOMBING.load(std::sync::atomic::Ordering::Relaxed) {
                        if let Ok(data) = std::fs::read_to_string("../msgbotmesaj.json") {
                            if let Ok(messages) = serde_json::from_str::<Vec<String>>(&data) {
                                if !messages.is_empty() {
                                    let idx = MSG_INDEX.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                    let msg = &messages[idx % messages.len()];
                                    let _ = bot_clone.chat(msg);
                                }
                            }
                        }
                        tokio::time::sleep(Duration::from_millis(2500)).await;
                    }
                });
            } else if raw_msg.contains("!!!msgspam dur") {
                IS_MSG_SPAMMING.store(false, std::sync::atomic::Ordering::Relaxed);
                println!("Oyun içinden Özel Mesaj bombası durduruldu.");
            } else if raw_msg.contains("!!!msgspam ") && !IS_MSG_SPAMMING.load(std::sync::atomic::Ordering::Relaxed) {
                if let Some(idx) = raw_msg.find("!!!msgspam ") {
                    let parts: Vec<&str> = raw_msg[idx..].split_whitespace().collect();
                    if parts.len() >= 2 {
                        let targets: Vec<String> = parts[1..].iter().map(|s| s.to_string()).collect();
                        *MSG_SPAM_TARGETS.lock() = targets.clone();
                        IS_MSG_SPAMMING.store(true, std::sync::atomic::Ordering::Relaxed);
                        println!("Oyun içinden Özel Mesaj bombası başlatıldı. Hedefler: {:?}", targets);
                        
                        let bot_clone = bot.clone();
                        tokio::spawn(async move {
                            static MSG_INDEX: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
                            static TARGET_INDEX: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
                            while IS_MSG_SPAMMING.load(std::sync::atomic::Ordering::Relaxed) {
                                let current_targets = MSG_SPAM_TARGETS.lock().clone();
                                if !current_targets.is_empty() {
                                    let delay_ms = 1000 / current_targets.len().max(1);
                                    if let Ok(data) = std::fs::read_to_string("../msgbotmesaj.json") {
                                        if let Ok(messages) = serde_json::from_str::<Vec<String>>(&data) {
                                            if !messages.is_empty() {
                                                let t_idx = TARGET_INDEX.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                                let current_target = &current_targets[t_idx % current_targets.len()];
                                                
                                                let m_idx = MSG_INDEX.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                                let msg = &messages[m_idx % messages.len()];
                                                let _ = bot_clone.chat(&format!("/msg {} {}", current_target, msg));
                                            }
                                        }
                                    }
                                    tokio::time::sleep(Duration::from_millis(delay_ms as u64)).await;
                                } else {
                                    tokio::time::sleep(Duration::from_millis(1000)).await;
                                }
                            }
                        });
                    }
                }
            }
        }
        Event::Disconnect(_) => {
            println!("Bağlantı koptu! Yeniden bağlanılıyor...");
            *BOT_CLIENT.lock() = None;
            
            if *SHOULD_RECONNECT.lock() {
                let reconnect_delay = AutoReconnectDelay {
                    delay: Duration::from_secs(5),
                };
                
                tokio::time::sleep(reconnect_delay.delay).await;
                println!("Yeniden bağlanılıyor...");
            }
        }
        _ => {}
    }

    Ok(())
}
