/**
 * Xuất cookie phẳng từ profile trình duyệt (sau khi login.js)
 * hoặc copy file JSON từ extension trình duyệt vào cookies/accountA.json
 *
 * Cách dùng: node export-cookies.js accountA
 */
const { chromium } = require('playwright');
const fs = require('fs');
const { profileDir } = require('./paths');
const { saveCookies } = require('./cookies');
const { getContextOptions } = require('./browser-config');

async function exportFromProfile(profile) {
  const dir = profileDir(profile);

  if (!fs.existsSync(dir)) {
    console.error('Không có profiles/' + profile + ' — chạy: node login.js', profile);
    process.exit(1);
  }

  const context = await chromium.launchPersistentContext(
    dir,
    getContextOptions(true),
  );

  const cookies = await context.cookies(['https://www.facebook.com', 'https://facebook.com']);

  await context.close();

  if (!cookies.length) {
    console.error('Không lấy được cookie Facebook từ profile.');
    process.exit(1);
  }

  saveCookies(profile, cookies);
  console.log('Số cookie:', cookies.length);
  console.log('\nUpload cookies/' + profile + '.json lên VPS (cùng thư mục project).');
}

const profile = process.argv[2];

if (!profile) {
  console.error('Cách dùng: node export-cookies.js accountA');
  process.exit(1);
}

exportFromProfile(profile).catch((err) => {
  console.error(err);
  process.exit(1);
});
