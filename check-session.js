const { chromium } = require('playwright');
const { ROOT_DIR } = require('./paths');
const { loadCookies } = require('./cookies');
const { getContextOptions } = require('./browser-config');

async function check(profile) {
  if (!profile) {
    console.error('Cách dùng: node check-session.js accountA');
    process.exit(1);
  }

  console.log('Project:', ROOT_DIR);

  const cookies = loadCookies(profile);
  const launchOpts = getContextOptions(true);

  const browser = await chromium.launch({
    headless: true,
    args: launchOpts.args,
  });

  const context = await browser.newContext({
    viewport: launchOpts.viewport,
    locale: launchOpts.locale,
  });

  await context.addCookies(cookies);

  const page = await context.newPage();

  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForTimeout(3000);

  const url = page.url();
  const loginBar = await page
    .getByPlaceholder(/email|điện thoại|phone/i)
    .isVisible()
    .catch(() => false);

  await browser.close();

  if (/facebook\.com\/login/i.test(url) || loginBar) {
    console.log('\nKết quả: CHƯA đăng nhập (cookie hết hạn hoặc sai)');
    console.log('Trên PC: node login.js', profile, '→ upload cookies/' + profile + '.json');
    process.exit(1);
  }

  console.log('\nKết quả: ĐÃ đăng nhập OK (', cookies.length, 'cookie )');
  console.log('URL:', url);
}

check(process.argv[2]).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
