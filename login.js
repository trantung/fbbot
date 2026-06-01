const { spawn } = require('child_process');
const { chromium } = require('playwright');
const fs = require('fs');
const readline = require('readline');
const { ROOT_DIR, profileDir, PROFILES_DIR, cookieFile } = require('./paths');
const { getContextOptions } = require('./browser-config');
const { saveCookies } = require('./cookies');

const DEBUG_PORT = process.env.LOGIN_DEBUG_PORT || '9222';

function reexecWithXvfbIfNeeded() {
  if (process.env.FB_LOGIN_XVFB === '1') {
    return false;
  }

  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return false;
  }

  console.log('VPS không có màn hình — tự chạy lại qua xvfb-run...\n');

  const child = spawn(
    'xvfb-run',
    ['-a', process.execPath, __filename, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: { ...process.env, FB_LOGIN_XVFB: '1' },
      cwd: ROOT_DIR,
    },
  );

  child.on('error', () => {
    console.error('Cài xvfb: sudo apt install -y xvfb');
    process.exit(1);
  });

  child.on('exit', (code) => process.exit(code ?? 1));

  return true;
}

function printSyncHelp(profile) {
  const file = cookieFile(profile);

  console.log(`
════════════════════════════════════════════════════════════
  Cookie phẳng đã lưu (dùng cho bot trên VPS):

    ${file}

  Upload lên server:

    scp "${file}" USER@IP:/đường/dẫn/fb-agent/cookies/

  Trên VPS:

    node check-session.js ${profile}
    pm2 restart fbbot

  (Hoặc: node export-cookies.js ${profile} nếu chỉ cần xuất lại cookie)
════════════════════════════════════════════════════════════
`);
}

function printRemoteLoginHelp() {
  console.log(`
Đăng nhập từ máy Windows (terminal mới):
  ssh -L ${DEBUG_PORT}:127.0.0.1:${DEBUG_PORT} USER@IP_VPS
Chrome: http://localhost:${DEBUG_PORT} → Enter khi xong
`);
}

async function waitForEnter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise((resolve) => {
    rl.question(
      '\n>>> Đã vào trang chủ Facebook (lướt vài giây), nhấn Enter để lưu profile...\n',
      () => {
        rl.close();
        resolve();
      },
    );
  });
}

async function isLoggedIn(page) {
  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForTimeout(3000);

  if (/facebook\.com\/login/i.test(page.url())) {
    return false;
  }

  const loginBar = page.getByPlaceholder(/email|điện thoại|phone/i);

  return !(await loginBar.isVisible({ timeout: 2000 }).catch(() => false));
}

async function login(profile) {
  if (!profile) {
    console.error('Cách dùng: node login.js accountA');
    process.exit(1);
  }

  const userDataDir = profileDir(profile);

  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log('Project:', ROOT_DIR);
  console.log('User Data Dir:', userDataDir);
  console.log('Đang mở Chromium (launchPersistentContext)...');

  const options = getContextOptions(false);
  const args = [...options.args];

  if (process.env.FB_LOGIN_XVFB === '1') {
    args.push(`--remote-debugging-port=${DEBUG_PORT}`);
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    ...options,
    args,
  });

  const page = context.pages()[0] || (await context.newPage());

  console.log(`\nĐăng nhập Facebook: ${profile}`);
  console.log('Đăng nhập + SMS/2FA → vào trang chủ → lướt vài giây.\n');

  if (process.env.FB_LOGIN_XVFB === '1') {
    printRemoteLoginHelp();
  }

  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('URL:', page.url());

  await waitForEnter();

  if (!(await isLoggedIn(page))) {
    console.error('Chưa đăng nhập thành công.');
    await context.close();
    process.exit(1);
  }

  const fbCookies = await context.cookies([
    'https://www.facebook.com',
    'https://facebook.com',
  ]);

  await context.close();

  saveCookies(profile, fbCookies);

  console.log(`\nOK — profile trình duyệt: ${userDataDir}`);
  printSyncHelp(profile);
  console.log('Kiểm tra: node check-session.js', profile);
}

if (reexecWithXvfbIfNeeded()) {
  // xvfb child
} else {
  login(process.argv[2]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
