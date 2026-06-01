require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT_DIR } = require('./paths');
const { getContextOptions } = require('./browser-config');
const { loadCookies } = require('./cookies');
const {
  bulkEntryDir,
  singleEntryDir,
  readSubfoldersIndex,
  readSubfoldersIndexRaw,
  saveSubfoldersIndex,
  getOrFetchEntry,
  requireCachedEntry,
  parentCacheDir,
  todayKey,
} = require('./cache-store');

const TEMP_DIR = path.join(ROOT_DIR, 'temp');
const DEBUG_DIR = path.join(TEMP_DIR, 'debug');
const HEADLESS = process.env.HEADLESS !== 'false';

function loadConfig() {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'pages.json'), 'utf8'),
  );
}

/** @returns {Record<string, string>} */
function getGroupsForAccount(accountConfig) {
  if (typeof accountConfig === 'string') {
    return { default: accountConfig };
  }

  if (Array.isArray(accountConfig)) {
    return Object.fromEntries(
      accountConfig.map((url, i) => [`group${i + 1}`, url]),
    );
  }

  if (accountConfig.groups && typeof accountConfig.groups === 'object') {
    return accountConfig.groups;
  }

  if (typeof accountConfig === 'object') {
    const { groups, ...rest } = accountConfig;

    if (groups) {
      return groups;
    }

    return rest;
  }

  throw new Error('Cấu hình tài khoản trong pages.json không hợp lệ');
}

function listAccountsText(config) {
  const lines = ['Danh sách tài khoản & group:\n'];

  for (const [profile, accountConfig] of Object.entries(config)) {
    const groups = getGroupsForAccount(accountConfig);
    const names = Object.keys(groups);

    lines.push(`• ${profile} (${names.length} group)`);

    for (const [name, url] of Object.entries(groups)) {
      lines.push(`  - ${name}: ${url}`);
    }

    lines.push('');
  }

  lines.push(
    'Cookie: cookies/<tài khoản>.json\n\n' +
      'CLI — 1 bài:\n' +
      '  node post.js <tài khoản> <docId> <folderId>\n\n' +
      'CLI — nhiều bài (folder cha Drive, mỗi folder con = 1 doc + ảnh):\n' +
      '  node post.js bulk <tài khoản> <parentFolderId>\n' +
      '  node post.js list\n\n' +
      'Telegram — 1 bài:\n' +
      '  /post <tài khoản> <docId> <folderId>\n\n' +
      'Telegram — nhiều bài:\n' +
      '  /bulk <tài khoản> <parentFolderId>\n\n' +
      'Cache theo ngày: cache/Ymd/... (lần 2 trong ngày không tải Google)\n' +
      'Bỏ cache: CACHE_REFRESH=true',
  );

  return lines.join('\n');
}

/**
 * @returns {{ profile: string, groups: { name: string, url: string }[] }[]}
 */
function resolvePostJobs(target, config) {
  const trimmed = target.trim();

  if (trimmed === 'all' || trimmed === 'postAll') {
    return Object.keys(config).map((profile) => ({
      profile,
      groups: Object.entries(getGroupsForAccount(config[profile])).map(
        ([name, url]) => ({ name, url }),
      ),
    }));
  }

  const jobs = [];

  for (const part of trimmed.split(',').map((s) => s.trim()).filter(Boolean)) {
    const colon = part.indexOf(':');
    const profile = colon === -1 ? part : part.slice(0, colon);
    const groupsSpec = colon === -1 ? null : part.slice(colon + 1);

    if (!config[profile]) {
      throw new Error(
        `Không có tài khoản "${profile}". Xem /list để biết tên tài khoản.`,
      );
    }

    const allGroups = getGroupsForAccount(config[profile]);

    let selected;

    if (!groupsSpec) {
      selected = Object.entries(allGroups);
    } else {
      selected = [];

      for (const name of groupsSpec.split(',').map((s) => s.trim())) {
        if (!allGroups[name]) {
          throw new Error(
            `Group "${name}" không tồn tại trong ${profile}. Có: ${Object.keys(allGroups).join(', ')}`,
          );
        }

        selected.push([name, allGroups[name]]);
      }
    }

    jobs.push({
      profile,
      groups: selected.map(([name, url]) => ({ name, url })),
    });
  }

  return jobs;
}

async function getGoogleDoc(url) {
  const exportUrl = url.replace('/edit', '/export?format=txt');

  console.log('Đọc Google Doc:', exportUrl);

  const res = await axios.get(exportUrl, {
    timeout: 15000,
  });

  return res.data.trim();
}

function extractFolderId(urlOrId) {
  if (!urlOrId.includes('/')) {
    return urlOrId.trim();
  }

  const m = urlOrId.match(/folders\/([^?/]+)/i);

  if (!m) {
    throw new Error('Folder Google Drive không hợp lệ');
  }

  return m[1];
}

async function fetchDriveFolderHtml(folderId) {
  const res = await axios.get(
    `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`,
    { timeout: 20000 },
  );

  return res.data;
}

/** @returns {{ id: string, name: string }[]} */
async function listDriveSubfolders(parentFolderId) {
  const parentId = extractFolderId(parentFolderId);
  const html = await fetchDriveFolderHtml(parentId);

  const seen = new Set();
  const subfolders = [];

  for (const m of html.matchAll(/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/g)) {
    const id = m[1];

    if (id === parentId || seen.has(id)) {
      continue;
    }

    seen.add(id);
    subfolders.push({ id, name: id });
  }

  for (const m of html.matchAll(/data-tooltip="([^"]+)"[^>]*data-id="([a-zA-Z0-9_-]+)"/g)) {
    const name = m[1];
    const id = m[2];

    if (seen.has(id) || id === parentId) {
      continue;
    }

    if (html.includes(`/drive/folders/${id}`)) {
      seen.add(id);
      subfolders.push({ id, name });
    }
  }

  return subfolders;
}

async function parseDriveFolderPost(folderId) {
  const id = extractFolderId(folderId);
  const html = await fetchDriveFolderHtml(id);

  const docIds = [
    ...new Set(
      [...html.matchAll(/document\/d\/([a-zA-Z0-9_-]+)/g)].map((m) => m[1]),
    ),
  ];

  const fileIds = [
    ...new Set(
      [...html.matchAll(/file\/d\/([a-zA-Z0-9_-]+)/g)].map((m) => m[1]),
    ),
  ];

  let docId = docIds[0];

  if (!docId && fileIds.length) {
    docId = fileIds[0];
  }

  if (!docId) {
    throw new Error(`Folder ${id}: không tìm thấy Google Doc`);
  }

  const imageIds = fileIds.filter((fid) => fid !== docId);

  return { folderId: id, docId, imageIds };
}

async function getGoogleDocById(docId) {
  return getGoogleDoc(
    `https://docs.google.com/document/d/${docId}/edit`,
  );
}

async function downloadDriveImagesToDir(imageIds, destDir) {
  if (!imageIds.length) {
    return [];
  }

  fs.mkdirSync(destDir, { recursive: true });

  const files = [];

  for (let i = 0; i < imageIds.length; i++) {
    const fileId = imageIds[i];
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const file = path.join(destDir, `img_${i}.jpg`);

    console.log('Tải:', downloadUrl);

    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 60000,
    });

    const writer = fs.createWriteStream(file);

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    files.push(file);
  }

  return files;
}

async function downloadDriveImages(imageIds, batchKey) {
  return downloadDriveImagesToDir(imageIds, path.join(TEMP_DIR, batchKey));
}

async function fetchBulkPostData(subFolderId, subFolderName) {
  const { docId, imageIds, folderId } = await parseDriveFolderPost(subFolderId);
  const content = await getGoogleDocById(docId);
  const tempDir = path.join(TEMP_DIR, `fetch_${folderId}_${Date.now()}`);
  const files = await downloadDriveImagesToDir(imageIds, tempDir);

  return {
    content,
    files,
    meta: {
      docId,
      folderId,
      subFolderName,
      imageIds,
    },
  };
}

async function fetchSinglePostData(docId, folderId) {
  const content = await getGoogleDocById(docId);
  const { imageIds } = await parseDriveFolderPost(folderId);
  const tempDir = path.join(TEMP_DIR, `fetch_single_${folderId}_${Date.now()}`);
  const files = await downloadDriveImagesToDir(imageIds, tempDir);

  return {
    content,
    files,
    meta: { docId, folderId },
  };
}

function cleanupTempDir(batchKey) {
  const destDir = path.join(TEMP_DIR, batchKey);

  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
}

async function getDriveImages(folderUrl) {
  const folderId = extractFolderId(folderUrl);
  const { imageIds } = await parseDriveFolderPost(folderId);

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  return downloadDriveImages(imageIds, `single_${folderId}_${Date.now()}`);
}

async function waitForImagesInDialog(page, dialog, minCount) {
  const previews = dialog.locator(
    'img[src*="blob:"], img[src*="scontent"], div[aria-label*="Remove" i], div[aria-label*="Xóa" i]',
  );

  try {
    await previews.first().waitFor({ state: 'visible', timeout: 90000 });
  } catch {}

  const visible = await previews.count();

  console.log('Ảnh preview trong dialog:', visible, '/', minCount);
  await page.waitForTimeout(3000);
}

async function trySetFilesOnInputs(scope, files) {
  const inputs = scope.locator('input[type="file"]');
  const count = await inputs.count();

  for (let i = 0; i < count; i++) {
    try {
      await inputs.nth(i).setInputFiles(files, { timeout: 5000 });
      console.log('Upload qua input[type=file] index', i);
      return true;
    } catch (e) {
      console.log('Input file #' + i + ' lỗi:', e.message.split('\n')[0]);
    }
  }

  return false;
}

async function clickPhotoButtonWithFileChooser(page, dialog, files) {
  const triggers = [
    dialog.getByLabel(/^Ảnh\/video$/i),
    dialog.getByLabel(/^Photo\/video$/i),
    dialog.getByLabel(/ảnh|photo|video/i),
    dialog.locator('[aria-label*="Ảnh" i], [aria-label*="Photo" i]').first(),
    dialog
      .locator('div')
      .filter({ hasText: /Thêm vào bài viết|Add to your post/i })
      .locator('[role="button"]')
      .first(),
  ];

  for (const trigger of triggers) {
    try {
      if (!(await trigger.isVisible({ timeout: 2000 }))) {
        continue;
      }

      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }),
        trigger.click({ timeout: 10000 }),
      ]);

      await fileChooser.setFiles(files);
      console.log('Upload qua filechooser');
      return true;
    } catch (e) {
      console.log('Filechooser thất bại:', e.message.split('\n')[0]);
    }
  }

  return false;
}

async function uploadImages(page, files) {
  if (!files.length) return;

  console.log('Có', files.length, 'ảnh');

  const dialog = await waitForPostDialog(page);

  if (await trySetFilesOnInputs(dialog, files)) {
    await waitForImagesInDialog(page, dialog, files.length);
    return;
  }

  if (await trySetFilesOnInputs(page, files)) {
    await waitForImagesInDialog(page, dialog, files.length);
    return;
  }

  console.log('Thử click icon Ảnh/video trong dialog...');

  if (!(await clickPhotoButtonWithFileChooser(page, dialog, files))) {
    throw new Error(
      'Không thể mở hộp chọn ảnh. Kiểm tra nút Ảnh/video trong dialog Tạo bài viết.',
    );
  }

  await waitForImagesInDialog(page, dialog, files.length);
}

async function saveDebugScreenshot(page, profile, step, groupName) {
  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
  }

  const suffix = groupName ? `_${groupName}` : '';
  const file = path.join(
    DEBUG_DIR,
    `${profile}${suffix}_${step}_${Date.now()}.png`,
  );

  await page.screenshot({ path: file, fullPage: true });
  console.log('Screenshot:', file);

  return file;
}

async function dismissOverlays(page) {
  const patterns = [
    /Cho phép tất cả cookie|Allow all cookies/i,
    /Chấp nhận tất cả|Accept all/i,
    /Đóng|Close/i,
    /Không phải lúc này|Not now/i,
  ];

  for (const pattern of patterns) {
    try {
      const btn = page.getByRole('button', { name: pattern }).first();

      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
      }
    } catch {}
  }
}

async function ensureLoggedIn(page, profile) {
  const url = page.url();

  if (/facebook\.com\/login/i.test(url)) {
    throw new Error(
      `Cookie hết hạn (${profile}). Xuất lại: node export-cookies.js ${profile} → upload cookies/${profile}.json lên VPS`,
    );
  }

  const loginBar = page.getByPlaceholder(/email|điện thoại|phone/i);
  const loginPrompt = page.getByText(/hãy đăng nhập hoặc đăng ký/i);

  if (await loginBar.isVisible({ timeout: 2000 }).catch(() => false)) {
    throw new Error(
      `Cookie không hợp lệ (${profile}). Cập nhật cookies/${profile}.json`,
    );
  }

  if (await loginPrompt.isVisible({ timeout: 2000 }).catch(() => false)) {
    throw new Error(
      `Cookie không hợp lệ (${profile}). Cập nhật cookies/${profile}.json`,
    );
  }
}

async function ensureGroupMember(page) {
  const joinBtn = page.getByRole('button', {
    name: /tham gia nhóm|join group/i,
  });

  if (await joinBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    throw new Error(
      'Tài khoản chưa tham gia group (nút "Tham gia nhóm"). Hãy join group thủ công trước.',
    );
  }
}

async function switchToDiscussionTab(page) {
  const tabPatterns = [/Thảo luận/i, /Discussion/i];

  for (const pattern of tabPatterns) {
    try {
      const tab = page
        .getByRole('tab', { name: pattern })
        .or(page.getByRole('link', { name: pattern }))
        .first();

      if (await tab.isVisible({ timeout: 2000 })) {
        await tab.click({ timeout: 5000 });
        await page.waitForTimeout(2000);
        return;
      }
    } catch {}
  }

  try {
    const link = page.locator('a[href*="/groups/"]').filter({
      hasText: /Thảo luận|Discussion/i,
    });

    if (await link.first().isVisible({ timeout: 2000 })) {
      await link.first().click({ timeout: 5000 });
      await page.waitForTimeout(2000);
    }
  } catch {}
}

async function openGroupComposer(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);

  const strategies = [
    {
      name: 'role button',
      locator: () =>
        page.getByRole('button', {
          name: /tạo bài viết|viết bài|bạn viết|write something|create.*post/i,
        }),
    },
    {
      name: 'placeholder text',
      locator: () =>
        page.locator(
          'text=/Bạn viết gì đi|Viết bài|Write something|Bạn đang nghĩ gì|Tạo bài viết/i',
        ),
    },
    {
      name: 'role button div',
      locator: () =>
        page
          .locator('div[role="button"]')
          .filter({
            hasText: /viết|write something|tạo bài/i,
          }),
    },
  ];

  for (const { name, locator } of strategies) {
    try {
      const target = locator().first();

      await target.waitFor({ state: 'visible', timeout: 8000 });
      await target.scrollIntoViewIfNeeded();
      await target.click({ timeout: 3000 });
      console.log('Mở composer bằng:', name);
      return;
    } catch (e) {
      console.log(`Composer "${name}" thất bại:`, e.message.split('\n')[0]);
    }
  }

  throw new Error('Không tìm thấy ô soạn bài trên group');
}

async function waitForPostDialog(page) {
  const dialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.locator('div[role="textbox"]') })
    .last();

  await dialog.waitFor({ state: 'visible', timeout: 15000 });

  return dialog;
}

async function getPostEditor(page) {
  const dialog = await waitForPostDialog(page);

  const editor = dialog.locator('div[role="textbox"]').first();

  await editor.waitFor({ state: 'visible', timeout: 15000 });

  return editor;
}

async function clickPostButton(page) {
  const dialog = await waitForPostDialog(page);

  const strategies = [
    {
      name: 'aria-label',
      locator: () =>
        dialog.locator('[aria-label="Đăng"], [aria-label="Post"]'),
    },
    {
      name: 'role button text',
      locator: () =>
        dialog
          .locator('[role="button"]')
          .filter({ hasText: /^Đăng$|^Post$/i }),
    },
    {
      name: 'getByRole button',
      locator: () => dialog.getByRole('button', { name: /^Đăng$|^Post$/i }),
    },
    {
      name: 'text Đăng',
      locator: () => dialog.getByText(/^Đăng$|^Post$/i),
    },
  ];

  for (const { name, locator } of strategies) {
    try {
      const btn = locator().last();

      await btn.waitFor({ state: 'visible', timeout: 8000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click({ timeout: 10000 });
      console.log('Bấm nút Đăng bằng:', name);
      return;
    } catch (e) {
      console.log(`Nút Đăng "${name}":`, e.message.split('\n')[0]);
    }
  }

  throw new Error('Không tìm thấy hoặc không bấm được nút Đăng');
}

async function postToGroup(page, profile, groupName, groupUrl, content, files) {
  const url = groupUrl.replace(/\/$/, '');

  console.log(`[${profile}/${groupName}] Mở group:`, url);

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  await dismissOverlays(page);
  await ensureLoggedIn(page, profile);
  await ensureGroupMember(page);
  await switchToDiscussionTab(page);
  await dismissOverlays(page);

  await openGroupComposer(page);
  await page.waitForTimeout(3000);

  await uploadImages(page, files);
  await page.waitForTimeout(3000);

  const editor = await getPostEditor(page);

  await editor.click();

  console.log(`[${profile}/${groupName}] TEXT GOOGLE DOC`);
  console.log(content);

  await editor.fill('');
  await page.keyboard.insertText(content);
  await page.waitForTimeout(3000);

  const current = await editor.innerText();

  console.log(`[${profile}/${groupName}] TEXT FACEBOOK`);
  console.log(current);

  if (!current.trim()) {
    throw new Error('Không nhập được text');
  }

  await clickPostButton(page);

  const dialog = page.locator('[role="dialog"]').last();

  await dialog
    .waitFor({ state: 'hidden', timeout: 60000 })
    .catch(() => page.waitForTimeout(5000));

  console.log(`[${profile}/${groupName}] Đăng thành công`);
}

async function postFacebookAccount(profile, groups, content, files) {
  const cookies = loadCookies(profile);
  const launchOpts = getContextOptions(HEADLESS);

  console.log(`[${profile}] Nạp ${cookies.length} cookie → trình duyệt sạch`);

  const results = [];
  let browser;
  let context;
  let page;

  try {
    browser = await chromium.launch({
      headless: launchOpts.headless,
      args: launchOpts.args,
    });

    context = await browser.newContext({
      viewport: launchOpts.viewport,
      locale: launchOpts.locale,
    });

    await context.addCookies(cookies);

    page = await context.newPage();
    page.setDefaultTimeout(10000);

    for (const { name, url } of groups) {
      try {
        await postToGroup(page, profile, name, url, content, files);
        results.push({ name, ok: true });
      } catch (e) {
        console.log(`Lỗi ${profile}/${name}:`, e.message);

        try {
          await saveDebugScreenshot(page, profile, 'error', name);
        } catch {}

        results.push({ name, ok: false, error: e.message });
      }
    }
  } finally {
    if (context) {
      await context.close();
    }

    if (browser) {
      await browser.close();
    }
  }

  return results;
}


async function runPost(target, docId, folderId) {
  const fid = extractFolderId(folderId);
  const config = loadConfig();
  const jobs = resolvePostJobs(target, config);
  const totalGroups = jobs.reduce((n, j) => n + j.groups.length, 0);
  const cacheDir = singleEntryDir(fid);

  console.log(`Bắt đầu: ${jobs.length} tài khoản, ${totalGroups} group...`);
  console.log(`Cache ngày ${todayKey()}: ${cacheDir}`);

  const { content, files, fromCache } = await getOrFetchEntry(cacheDir, () =>
    fetchSinglePostData(docId, fid),
  );

  console.log(fromCache ? '📦 Nội dung + ảnh từ cache' : '⬇️ Vừa tải từ Google');
  console.log(`Ảnh: ${files.length}, chữ: ${content.length} ký tự`);

  const summary = [];

  for (const { profile, groups } of jobs) {
    console.log(`\n=== ${profile} (${groups.length} group) ===`);
    const results = await postFacebookAccount(profile, groups, content, files);

    for (const r of results) {
      summary.push({ profile, name: r.name, ok: r.ok, error: r.error });
      const label = `${profile}/${r.name}`;
      console.log(r.ok ? `✓ ${label}` : `✗ ${label}: ${r.error}`);
    }
  }

  const failed = summary.filter((r) => !r.ok).length;
  console.log(`\nHoàn tất: ${summary.length - failed}/${summary.length} thành công`);

  return { jobs, summary, failed };
}

const BULK_DELAY_MS = parseInt(process.env.BULK_DELAY_MS || '8000', 10);

/**
 * Folder Drive cha chứa nhiều folder con.
 * Mỗi folder con: 1 Google Doc + nhiều ảnh → post lên group theo target.
 */
async function runPostBulk(target, parentFolderId) {
  const parentId = extractFolderId(parentFolderId);
  const config = loadConfig();
  const jobs = resolvePostJobs(target, config);
  const dateKey = todayKey();

  let subfolders = readSubfoldersIndex(parentId, dateKey);

  if (!subfolders) {
    subfolders = await listDriveSubfolders(parentId);
    saveSubfoldersIndex(parentId, subfolders, dateKey);
  }

  if (!subfolders.length) {
    throw new Error(
      `Không tìm thấy folder con trong ${parentId}. ` +
        'Kiểm tra link Drive và quyền xem (share).',
    );
  }

  console.log(
    `Bulk [${dateKey}]: ${subfolders.length} folder con, ${jobs.length} tài khoản`,
  );
  console.log(`Cache gốc: cache/${dateKey}/${parentId}/`);

  const summary = [];
  let cacheHits = 0;

  for (let i = 0; i < subfolders.length; i++) {
    const sub = subfolders[i];
    const entryDir = bulkEntryDir(parentId, sub.id, dateKey);

    console.log(
      `\n========== Bài ${i + 1}/${subfolders.length}: ${sub.name} ==========`,
    );

    try {
      const { content, files, meta, fromCache } = await getOrFetchEntry(
        entryDir,
        () => fetchBulkPostData(sub.id, sub.name),
      );

      if (fromCache) {
        cacheHits++;
      }

      console.log(
        `${fromCache ? '📦 Cache' : '⬇️ Google'} | Doc: ${meta.docId} | ảnh: ${files.length}`,
      );

      for (const { profile, groups } of jobs) {
        console.log(`\n=== ${profile} (${groups.length} group) ===`);
        const results = await postFacebookAccount(profile, groups, content, files);

        for (const r of results) {
          summary.push({
            post: sub.name,
            postIndex: i + 1,
            profile,
            name: r.name,
            ok: r.ok,
            error: r.error,
            fromCache,
          });

          const label = `[${sub.name}] ${profile}/${r.name}`;
          console.log(r.ok ? `✓ ${label}` : `✗ ${label}: ${r.error}`);
        }
      }
    } catch (e) {
      console.log(`Lỗi folder ${sub.name}:`, e.message);

      for (const { profile, groups } of jobs) {
        for (const g of groups) {
          summary.push({
            post: sub.name,
            postIndex: i + 1,
            profile,
            name: g.name,
            ok: false,
            error: e.message,
          });
        }
      }
    }

    if (i < subfolders.length - 1 && BULK_DELAY_MS > 0) {
      console.log(`Chờ ${BULK_DELAY_MS}ms...`);
      await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
    }
  }

  const failed = summary.filter((r) => !r.ok).length;

  console.log(
    `\nBulk hoàn tất: ${summary.length - failed}/${summary.length} thành công`,
  );
  console.log(`Cache hit: ${cacheHits}/${subfolders.length} bài (ngày ${dateKey})`);

  return { jobs, summary, failed, postCount: subfolders.length, cacheHits };
}

/**
 * Chỉ tải folder Drive cha về cache — không đăng Facebook.
 */
async function syncDriveFolder(parentFolderId, dateKey = todayKey()) {
  const parentId = extractFolderId(parentFolderId);

  console.log(`\n🔄 Sync Drive → cache/${dateKey}/${parentId}/`);

  const subfolders = await listDriveSubfolders(parentId);

  if (!subfolders.length) {
    throw new Error(`Không có folder con trong ${parentId}`);
  }

  saveSubfoldersIndex(parentId, subfolders, dateKey);

  const details = [];
  let downloaded = 0;
  let cached = 0;

  for (let i = 0; i < subfolders.length; i++) {
    const sub = subfolders[i];
    const entryDir = bulkEntryDir(parentId, sub.id, dateKey);

    console.log(`\n[${i + 1}/${subfolders.length}] ${sub.name}`);

    const { fromCache, meta, files } = await getOrFetchEntry(entryDir, () =>
      fetchBulkPostData(sub.id, sub.name),
    );

    if (fromCache) {
      cached++;
    } else {
      downloaded++;
    }

    details.push({
      name: sub.name,
      id: sub.id,
      fromCache,
      images: files.length,
      docId: meta.docId,
      path: entryDir,
    });
  }

  console.log(
    `\n✅ Sync xong: ${subfolders.length} bài (${downloaded} tải mới, ${cached} đã có cache)`,
  );

  return {
    parentId,
    dateKey,
    cachePath: parentCacheDir(parentId, dateKey),
    total: subfolders.length,
    downloaded,
    cached,
    details,
  };
}

/**
 * Đăng bài từ cache local — không gọi Google Drive/Docs.
 */
async function runPushFromCache(target, parentFolderId, dateKey = todayKey()) {
  const parentId = extractFolderId(parentFolderId);
  const config = loadConfig();
  const jobs = resolvePostJobs(target, config);

  const subfolders = readSubfoldersIndexRaw(parentId, dateKey);

  if (!subfolders?.length) {
    throw new Error(
      `Chưa sync folder ${parentId} ngày ${dateKey}.\n` +
        `Chạy: /sync ${parentId}  hoặc  node post.js sync ${parentId}`,
    );
  }

  console.log(
    `\n📤 Push từ cache [${dateKey}]: ${subfolders.length} bài → ${jobs.length} tài khoản`,
  );

  const summary = [];

  for (let i = 0; i < subfolders.length; i++) {
    const sub = subfolders[i];
    const entryDir = bulkEntryDir(parentId, sub.id, dateKey);

    console.log(
      `\n========== Bài ${i + 1}/${subfolders.length}: ${sub.name} (cache) ==========`,
    );

    try {
      const { content, files, meta } = requireCachedEntry(entryDir, sub.name);

      console.log(`📦 Cache | Doc: ${meta.docId} | ảnh: ${files.length}`);

      for (const { profile, groups } of jobs) {
        console.log(`\n=== ${profile} (${groups.length} group) ===`);
        const results = await postFacebookAccount(profile, groups, content, files);

        for (const r of results) {
          summary.push({
            post: sub.name,
            postIndex: i + 1,
            profile,
            name: r.name,
            ok: r.ok,
            error: r.error,
            fromCache: true,
          });

          const label = `[${sub.name}] ${profile}/${r.name}`;
          console.log(r.ok ? `✓ ${label}` : `✗ ${label}: ${r.error}`);
        }
      }
    } catch (e) {
      console.log(`Lỗi ${sub.name}:`, e.message);

      for (const { profile, groups } of jobs) {
        for (const g of groups) {
          summary.push({
            post: sub.name,
            profile,
            name: g.name,
            ok: false,
            error: e.message,
          });
        }
      }
    }

    if (i < subfolders.length - 1 && BULK_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
    }
  }

  const failed = summary.filter((r) => !r.ok).length;

  console.log(
    `\nPush hoàn tất: ${summary.length - failed}/${summary.length} thành công`,
  );

  return { jobs, summary, failed, postCount: subfolders.length, dateKey, parentId };
}

module.exports = {
  runPost,
  runPostBulk,
  syncDriveFolder,
  runPushFromCache,
  loadConfig,
  resolvePostJobs,
  listAccountsText,
  getGroupsForAccount,
};
