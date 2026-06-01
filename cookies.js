const fs = require('fs');
const path = require('path');
const { ROOT_DIR, COOKIES_DIR, cookieFile } = require('./paths');

function normalizeCookie(raw) {
  const cookie = {
    name: raw.name,
    value: raw.value,
    domain: raw.domain,
    path: raw.path || '/',
  };

  if (raw.expires && raw.expires > 0) {
    cookie.expires = Math.floor(raw.expires);
  }

  if (raw.httpOnly) {
    cookie.httpOnly = true;
  }

  if (raw.secure) {
    cookie.secure = true;
  }

  if (raw.sameSite) {
    cookie.sameSite = raw.sameSite;
  }

  return cookie;
}

function parseCookieFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.cookies;

  if (!Array.isArray(list) || !list.length) {
    throw new Error(`File cookie rỗng hoặc sai định dạng: ${filePath}`);
  }

  return list
    .filter((c) => c.name && c.domain)
    .map(normalizeCookie);
}

/**
 * Đọc cookie phẳng (mảng JSON) cho Playwright addCookies.
 * Tìm theo thứ tự: cookies/accountA.json → accountA.json (gốc project)
 */
function loadCookies(profile) {
  const candidates = [
    cookieFile(profile),
    path.join(ROOT_DIR, `${profile}.json`),
    path.join(ROOT_DIR, 'cookies.json'),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      console.log('Nạp cookie từ:', filePath);

      return parseCookieFile(filePath);
    }
  }

  throw new Error(
    `Không có cookie cho "${profile}".\n` +
      `  - Đặt file: cookies/${profile}.json (mảng cookie)\n` +
      `  - Hoặc chạy: node login.js ${profile}  → node export-cookies.js ${profile}`,
  );
}

function saveCookies(profile, cookies) {
  fs.mkdirSync(COOKIES_DIR, { recursive: true });

  const filePath = cookieFile(profile);

  fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2), 'utf8');

  console.log('Đã lưu cookie phẳng:', filePath);

  return filePath;
}

module.exports = {
  loadCookies,
  saveCookies,
  parseCookieFile,
};
