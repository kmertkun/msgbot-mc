# MsgBot-MC (Minecraft Message Bot)

[English](#english) | [Türkçe](#türkçe)

---

## English

A powerful and realistic Minecraft message bot built with Mineflayer. It supports multiple bots, automatic authentication, realistic movements (anti-bot bypass), and remote control via chat commands.

### 🚀 Features

- **Multi-Bot Support:** Run multiple bots simultaneously.
- **Realistic Behavior:** Random head movements, walking, and arm swinging to bypass anti-bot systems.
- **Auto Auth:** Automatically handles `/login` and `/register` commands.
- **Chat Bombing:** 
  - `!!!msgbomm [players]`: Send random messages to specific players.
  - `!!!bomb`: Send random messages to global chat.
- **Remote Control:** Admin system to control bots via in-game chat.
- **Auto Reconnect:** Automatically reconnects after being kicked or disconnected.

### 🛠️ Setup

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configuration:**
   - Rename `config.example.json` to `config.json` and fill in your server details.
   - Rename `msgbotmesaj.example.json` to `msgbotmesaj.json` and add the messages you want the bot to send.

3. **Run:**
   ```bash
   node yeni_bot.js
   ```

### 🎮 Commands (In-game)
*Prefix: `!!!` (Only admins defined in `config.json` can use these)*

- `!!!ownertpa`: Bot sends a TPA request to you.
- `!!!tpakabul`: Bot accepts your TPA request.
- `!!!kill`: Bot runs `/kill`.
- `!!!msgbomm player1 player2`: Starts messaging the listed players.
- `!!!durmsg`: Stops messaging players.
- `!!!bomb`: Starts global chat bombing.
- `!!!bombdur`: Stops global chat bombing.

---

## Türkçe

Mineflayer ile geliştirilmiş, güçlü ve gerçekçi bir Minecraft mesaj botu. Birden fazla bot desteği, otomatik kayıt/giriş, gerçekçi hareketler (anti-bot atlatma) ve oyun içi komutlarla uzaktan kontrol özelliklerine sahiptir.

### 🚀 Özellikler

- **Çoklu Bot Desteği:** Aynı anda birden fazla bot çalıştırabilir.
- **Gerçekçi Davranışlar:** Anti-bot sistemlerine yakalanmamak için rastgele kafa hareketleri, yürüme ve el sallama.
- **Otomatik Giriş:** `/login` ve `/register` komutlarını otomatik olarak algılar ve uygular.
- **Mesaj Bombası:**
  - `!!!msgbomm [oyuncular]`: Belirlenen oyunculara sırayla özel mesaj atar.
  - `!!!bomb`: Genel sohbete rastgele mesajlar atar.
- **Uzaktan Kontrol:** `config.json` dosyasında tanımlı adminler tarafından oyun içinden yönetilebilir.
- **Otomatik Yeniden Bağlanma:** Bağlantı koptuğunda 30 saniye sonra otomatik olarak tekrar bağlanır.

### 🛠️ Kurulum

1. **Bağımlılıkları Yükleyin:**
   ```bash
   npm install
   ```

2. **Yapılandırma:**
   - `config.example.json` dosyasını `config.json` olarak değiştirin ve sunucu bilgilerinizi girin.
   - `msgbotmesaj.example.json` dosyasını `msgbotmesaj.json` olarak değiştirin ve botun atmasını istediğiniz mesajları ekleyin.

3. **Çalıştır:**
   ```bash
   node yeni_bot.js
   ```

### 🎮 Komutlar (Oyun İçi)
*Ön ek: `!!!` (Sadece `config.json`'da ekli adminler kullanabilir)*

- `!!!ownertpa`: Bot size TPA isteği atar.
- `!!!tpakabul`: Attığınız TPA isteğini kabul eder.
- `!!!kill`: Bot `/kill` çeker.
- `!!!msgbomm oyuncu1 oyuncu2`: Belirtilen oyunculara mesaj atmaya başlar.
- `!!!durmsg`: Özel mesaj atmayı durdurur.
- `!!!bomb`: Genel sohbet bombasını başlatır.
- `!!!bombdur`: Genel sohbet bombasını durdurur.

---

### ⚠️ Disclaimer / Uyarı
This tool is for educational purposes only. Use it responsibly. / Bu araç sadece eğitim amaçlıdır. Sorumlu bir şekilde kullanın.
