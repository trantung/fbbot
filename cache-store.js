const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./paths');

const CACHE_DIR = path.join(ROOT_DIR, 'cache');
const FORCE_REFRESH = process.env.CACHE_REFRESH === 'true';

function todayKey() {
  const d = new Date();

  return (
    String(d.getFullYear()) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

/** cache/{Ymd}/{parentFolderId}/{subFolderId}/ */
function bulkEntryDir(parentFolderId, subFolderId, dateKey = todayKey()) {
  return path.join(CACHE_DIR, dateKey, parentFolderId, subFolderId);
}

/** cache/{Ymd}/single/{folderId}/ */
function singleEntryDir(folderId, dateKey = todayKey()) {
  return path.join(CACHE_DIR, dateKey, 'single', folderId);
}

/** cache/{Ymd}/{parentFolderId}/_subfolders.json */
function subfoldersIndexPath(parentFolderId, dateKey = todayKey()) {
  return path.join(CACHE_DIR, dateKey, parentFolderId, '_subfolders.json');
}

function isEntryCached(entryDir) {
  const contentFile = path.join(entryDir, 'content.txt');
  const metaFile = path.join(entryDir, 'meta.json');
  const imagesDir = path.join(entryDir, 'images');

  if (!fs.existsSync(contentFile) || !fs.existsSync(metaFile)) {
    return false;
  }

  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

  if (!meta.imageCount && meta.imageCount !== 0) {
    return false;
  }

  if (!fs.existsSync(imagesDir)) {
    return meta.imageCount === 0;
  }

  const images = fs.readdirSync(imagesDir).filter((f) => !f.startsWith('.'));

  return images.length === meta.imageCount;
}

function readCachedEntry(entryDir) {
  const content = fs.readFileSync(path.join(entryDir, 'content.txt'), 'utf8');
  const meta = JSON.parse(fs.readFileSync(path.join(entryDir, 'meta.json'), 'utf8'));
  const imagesDir = path.join(entryDir, 'images');
  let files = [];

  if (fs.existsSync(imagesDir)) {
    files = fs
      .readdirSync(imagesDir)
      .filter((f) => !f.startsWith('.'))
      .sort()
      .map((f) => path.join(imagesDir, f));
  }

  return { content, files, meta, fromCache: true };
}

function saveCachedEntry(entryDir, { content, files, meta }) {
  const imagesDir = path.join(entryDir, 'images');

  fs.mkdirSync(imagesDir, { recursive: true });

  const savedPaths = [];

  for (let i = 0; i < files.length; i++) {
    const src = files[i];
    const ext = path.extname(src) || '.jpg';
    const dest = path.join(imagesDir, `img_${i}${ext}`);

    if (path.resolve(src) !== path.resolve(dest)) {
      fs.copyFileSync(src, dest);
    }

    savedPaths.push(dest);
  }

  fs.writeFileSync(path.join(entryDir, 'content.txt'), content, 'utf8');

  fs.writeFileSync(
    path.join(entryDir, 'meta.json'),
    JSON.stringify(
      {
        ...meta,
        imageCount: savedPaths.length,
        cachedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log('💾 Đã lưu cache:', entryDir);

  return { content, files: savedPaths, meta, fromCache: false };
}

function readSubfoldersIndexRaw(parentFolderId, dateKey = todayKey()) {
  const file = subfoldersIndexPath(parentFolderId, dateKey);

  if (!fs.existsSync(file)) {
    return null;
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  return data.subfolders || data;
}

function readSubfoldersIndex(parentFolderId, dateKey = todayKey()) {
  if (FORCE_REFRESH) {
    return null;
  }

  const list = readSubfoldersIndexRaw(parentFolderId, dateKey);

  if (list) {
    console.log('📦 Cache danh sách folder con:', subfoldersIndexPath(parentFolderId, dateKey));
  }

  return list;
}

function saveSubfoldersIndex(parentFolderId, subfolders, dateKey = todayKey()) {
  const file = subfoldersIndexPath(parentFolderId, dateKey);

  fs.mkdirSync(path.dirname(file), { recursive: true });

  fs.writeFileSync(
    file,
    JSON.stringify({ cachedAt: new Date().toISOString(), subfolders }, null, 2),
    'utf8',
  );
}

function parentCacheDir(parentFolderId, dateKey = todayKey()) {
  return path.join(CACHE_DIR, dateKey, parentFolderId);
}

function requireCachedEntry(entryDir, label) {
  if (!isEntryCached(entryDir)) {
    throw new Error(
      `Chưa có cache "${label}". Chạy /sync hoặc node post.js sync trước.`,
    );
  }

  return readCachedEntry(entryDir);
}

/**
 * Lấy bài từ cache (theo ngày) hoặc tải Google rồi lưu cache.
 */
async function getOrFetchEntry(entryDir, fetchFn) {
  if (!FORCE_REFRESH && isEntryCached(entryDir)) {
    console.log('📦 Dùng cache:', entryDir);

    return readCachedEntry(entryDir);
  }

  console.log('⬇️ Tải mới từ Google →', entryDir);

  const fetched = await fetchFn();

  return saveCachedEntry(entryDir, fetched);
}

module.exports = {
  CACHE_DIR,
  todayKey,
  bulkEntryDir,
  singleEntryDir,
  readSubfoldersIndex,
  saveSubfoldersIndex,
  getOrFetchEntry,
  isEntryCached,
  readCachedEntry,
  readSubfoldersIndexRaw,
  requireCachedEntry,
  parentCacheDir,
  FORCE_REFRESH,
};
