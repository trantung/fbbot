# FB Agent — Hướng dẫn logic & lệnh chạy

Bot tự động đăng bài lên **Facebook group** từ:
- Nội dung **Google Docs** (text)
- Ảnh trong **Google Drive folder**

Hỗ trợ **nhiều tài khoản**, **nhiều group**, chạy qua **CLI** hoặc **Telegram**.

---

## 1. Logic tổng quan

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Google Doc  │────▶│  post-core   │◀────│ Drive folder    │
│  (text)     │     │  (Playwright)│     │  (ảnh .jpg)     │
└─────────────┘     └──────┬───────┘     └─────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        cookies/      pages.json    .env HEADLESS
        accountA.json  (group URL)
              │
              ▼
        Chromium sạch + addCookies
              │
              ▼
        Mở group → Soạn bài → Upload ảnh → Nhập text → Đăng
```

### Luồng chi tiết mỗi lần post

1. **Đọc cấu hình** `pages.json` — chọn tài khoản & group cần đăng.
2. **Đọc Google Doc** — export sang `.txt` lấy nội dung bài viết.
3. **Tải ảnh** — quét folder Drive, tải về `temp/img_0.jpg`, ...
4. **Mở Chromium** — trình duyệt sạch (không dùng profile folder khi chạy bot).
5. **Nạp cookie** — `cookies/<tài khoản>.json` (mảng JSON phẳng).
6. **Vào từng group** — tab Thảo luận → mở composer → upload ảnh → gõ text → bấm **Đăng**.
7. **Báo kết quả** — thành công / lỗi từng `account/group`.

### Cấu trúc thư mục

```
fb-agent/
├── bot.js              # Telegram bot
├── post.js             # CLI đăng bài
├── post-core.js        # Logic đăng bài (dùng chung)
├── login.js            # Đăng nhập FB, lưu cookie
├── export-cookies.js   # Xuất cookie từ profiles/
├── check-session.js    # Kiểm tra cookie còn sống
├── cookies.js          # Đọc/ghi file cookie
├── browser-config.js   # Cấu hình Chromium
├── paths.js            # Đường dẫn project
├── pages.json          # Tài khoản + URL group
├── cookies/
│   ├── accountA.json
│   ├── accountB.json
│   └── ...
├── profiles/           # Chỉ dùng khi login (tùy chọn)
│   └── accountA/
├── temp/               # Ảnh tải tạm, screenshot lỗi
├── .env
└── HUONG-DAN.md
```

---

## 2. Cài đặt ban đầu

```bash
cd fb-agent
npm install
npx playwright install chromium
```

### File `.env`

```env
TELEGRAM_BOT_TOKEN=xxx    # Chỉ cần nếu chạy bot Telegram
HEADLESS=true             # true = chạy ẩn (VPS), false = có cửa sổ
```

### File `pages.json`

```json
{
  "accountA": {
    "groups": {
      "afkvn": "https://www.facebook.com/groups/ten-group-1",
      "group2": "https://www.facebook.com/groups/ten-group-2"
    }
  },
  "accountB": {
    "groups": {
      "afkvn": "https://www.facebook.com/groups/..."
    }
  }
}
```

- Key ngoài (`accountA`) = tên tài khoản, trùng tên file cookie.
- Key trong `groups` (`afkvn`) = tên gọi tắt để chọn group khi post.

---

## 3. Cookie Facebook (bắt buộc)

Bot dùng **cookie JSON phẳng**, không copy folder `profiles/` lên VPS.

### Cách 1 — Login và tự lưu (khuyên dùng)

**Trên máy cá nhân (Windows, có màn hình):**

```bash
node login.js accountA
```

1. Cửa sổ Chrome mở → đăng nhập Facebook (+ SMS/2FA nếu có).
2. Vào **trang chủ** Facebook, lướt vài giây.
3. Quay terminal → **Enter**.

→ Tạo file `cookies/accountA.json`.

### Cách 2 — Xuất lại từ profile cũ

Nếu đã có `profiles/accountA/` (đã login trước đó):

```bash
node export-cookies.js accountA
```

→ Ghi đè / tạo `cookies/accountA.json`.

### Kiểm tra cookie

```bash
node check-session.js accountA
```

| Kết quả | Ý nghĩa |
|---------|---------|
| `ĐÃ đăng nhập OK` | Cookie dùng được |
| `CHƯA đăng nhập` | Cookie hết hạn → login lại |

### Upload lên VPS

```bash
scp cookies/accountA.json user@IP:/đường/dẫn/fb-agent/cookies/
```

**Lưu ý:** Cookie copy từ PC sang VPS đôi khi vẫn bị FB hỏi login (đổi IP). Khi đó chạy `login.js` trực tiếp trên VPS (cần `xvfb` — xem mục 7).

---

## 4. Lệnh CLI (`post.js`)

### Xem danh sách tài khoản & group

```bash
node post.js list
# hoặc
npm run list
```

### Đăng bài

```bash
node post.js <tài khoản> <googleDocId> <driveFolderId>
```

| Lệnh | Ý nghĩa |
|------|---------|
| `node post.js accountA DOC FOLDER` | accountA → **tất cả** group |
| `node post.js accountA:afkvn DOC FOLDER` | Chỉ group tên `afkvn` |
| `node post.js accountA:afkvn,group2 DOC FOLDER` | Nhiều group cụ thể |
| `node post.js accountA,accountB DOC FOLDER` | Nhiều tài khoản |
| `node post.js all DOC FOLDER` | Mọi tài khoản, mọi group |
| `node post.js postAll DOC FOLDER` | Giống `all` |

**Ví dụ:**

```bash
node post.js accountA 1tOC7uzpjbZxRJxDGzlUj-z9YYje2eZccjrarGickrLU 1RQIqIC9a2hMaRfRoZvtb6oRx__brQTGI
```

**Lấy ID:**
- Google Doc: `https://docs.google.com/document/d/`**`DOC_ID`**`/edit`
- Drive folder: `https://drive.google.com/drive/folders/`**`FOLDER_ID`**

### Trợ giúp

```bash
node post.js --help
```

### npm scripts

```bash
npm run post -- accountA DOC_ID FOLDER_ID
npm run list
npm run bot          # Telegram bot
npm run login -- accountA
npm run check -- accountA
```

---

## 5. Telegram bot

### Chạy bot

```bash
node bot.js
# hoặc
npm run bot

# VPS với pm2
pm2 start bot.js --name fbbot --cwd /đường/dẫn/fb-agent
pm2 logs fbbot
pm2 restart fbbot
```

### Lệnh Telegram (= CLI)

| Telegram | CLI tương đương |
|----------|-----------------|
| `/list` | `node post.js list` |
| `/post accountA DOC FOLDER` | `node post.js accountA DOC FOLDER` |
| `/post accountA:afkvn DOC FOLDER` | `node post.js accountA:afkvn DOC FOLDER` |
| `/post accountA,accountB DOC FOLDER` | `node post.js accountA,accountB DOC FOLDER` |
| `/post all DOC FOLDER` | `node post.js all DOC FOLDER` |
| `/help` | `node post.js --help` |

**Ví dụ Telegram (thay DOC_ID, FOLDER_ID thật):**

```
/post accountA 1tOC7uzpjbZxRJxDGzlUj-z9YYje2eZccjrarGickrLU 1RQIqIC9a2hMaRfRoZvtb6oRx__brQTGI
/post accountA:afkvn DOC_ID FOLDER_ID
/post accountA,accountB DOC_ID FOLDER_ID
/post all DOC_ID FOLDER_ID
```

### Bảo mật bot (tuỳ chọn)

Trong `.env`, chỉ cho phép chat ID của bạn (lấy từ @userinfobot):

```env
TELEGRAM_ALLOWED_CHAT_IDS=123456789
```

Nhiều người: `123456789,987654321`. Để trống = ai cũng gọi được bot.

---

## 6. Triển khai VPS (Linux)

### Bước 1 — Clone / upload code

```bash
cd /opt/fb-agent
npm install
npx playwright install chromium
```

### Bước 2 — Cấu hình

- Sửa `pages.json`
- Tạo `.env` (`TELEGRAM_BOT_TOKEN`, `HEADLESS=true`)
- Upload `cookies/accountA.json` (và B, C nếu có)

### Bước 3 — Kiểm tra

```bash
node check-session.js accountA
```

### Bước 4 — Chạy

```bash
# Test 1 lần
node post.js accountA DOC_ID FOLDER_ID

# Bot Telegram
pm2 start bot.js --name fbbot --cwd /opt/fb-agent
```

### `HEADLESS` trên VPS

| Giá trị | Khi nào dùng |
|--------|----------------|
| `HEADLESS=true` | **Mặc định** — VPS không cần màn hình |
| `HEADLESS=false` | Chỉ khi debug, cần xvfb/VNC |

---

## 7. Login trên VPS (không có màn hình)

```bash
sudo apt update && sudo apt install -y xvfb
cd /opt/fb-agent
xvfb-run -a node login.js accountA
```

Hoặc `node login.js accountA` (script tự thử `xvfb-run` nếu không có `DISPLAY`).

**Đăng nhập từ máy Windows qua SSH tunnel:**

1. Terminal 1 (VPS): `node login.js accountA` (chờ Enter)
2. Terminal 2 (PC): `ssh -L 9222:127.0.0.1:9222 user@IP_VPS`
3. Chrome PC: `http://localhost:9222` → chọn tab Facebook → đăng nhập
4. Terminal 1 → **Enter**

```bash
node export-cookies.js accountA   # nếu cần xuất lại
node check-session.js accountA
```

---

## 8. Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|-----|-------------|------------|
| `Chưa đăng nhập` / `Cookie hết hạn` | Cookie hết hạn hoặc sai IP | `node login.js accountA` → upload `cookies/` lại |
| `Không có cookie cho accountA` | Thiếu file | Tạo `cookies/accountA.json` |
| `Không tìm thấy ô soạn bài` | Chưa join group / sai URL | Join group thủ công, kiểm tra `pages.json` |
| `Tham gia nhóm` | Tài khoản chưa member | Join group trên FB |
| `Không thể upload ảnh` | UI Facebook đổi | Xem `temp/debug/*.png` |
| `Timeout` nút Đăng | Nút Đăng không khớp selector | Xem screenshot debug |

Screenshot lỗi: `temp/debug/accountA_<group>_error_*.png`

---

## 9. Tóm tắt lệnh nhanh

```bash
# === LẦN ĐẦU ===
npm install
npx playwright install chromium
# Sửa pages.json, .env

# === COOKIE ===
node login.js accountA
node check-session.js accountA
scp cookies/accountA.json user@vps:/opt/fb-agent/cookies/

# === ĐĂNG BÀI ===
node post.js list
node post.js accountA DOC_ID FOLDER_ID

# === TELEGRAM ===
pm2 start bot.js --name fbbot
# /list  /post accountA DOC FOLDER

# === BẢO TRÌ ===
node export-cookies.js accountA    # xuất lại cookie
node check-session.js accountA    # kiểm tra
pm2 restart fbbot
```

---

## 10. Yêu cầu trước khi post

- [ ] Tài khoản FB đã **join** group trong `pages.json`
- [ ] File `cookies/<tài khoản>.json` còn hiệu lực (`check-session` OK)
- [ ] Google Doc **public** hoặc share được (export txt)
- [ ] Folder Drive **public** hoặc link xem được
- [ ] Trên VPS: Playwright Chromium đã cài (`npx playwright install chromium`)
