#!/usr/bin/env node
require('dotenv').config();

const {
  runPost,
  runPostBulk,
  syncDriveFolder,
  runPushFromCache,
  listAccountsText,
  loadConfig,
} = require('./post-core');
const { logCommand, getCommandHistory, formatHistoryText } = require('./command-log');

function printHelp() {
  console.log(`
Đăng bài Facebook group (CLI)

=== Quy trình khuyên dùng (nhiều bài) ===
  node post.js sync PARENT_FOLDER_ID          # tải về server
  node post.js push accountA PARENT_FOLDER_ID # đăng từ cache
  node post.js push all PARENT_FOLDER_ID

=== 1 bài (Google Doc + folder ảnh) ===
  node post.js accountA DOC_ID FOLDER_ID

=== Bulk (sync + đăng 1 lần) ===
  node post.js bulk accountA PARENT_FOLDER_ID

=== Khác ===
  node post.js list
  node post.js history [số_dòng]

.env: HEADLESS=true, BULK_DELAY_MS=8000, CACHE_REFRESH=true
`);
}

function logCli(command, args, status, result) {
  logCommand({
    source: 'cli',
    command,
    args,
    status,
    result,
    raw: `node post.js ${[command, ...args].join(' ')}`,
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    printHelp();
    process.exit(0);
  }

  if (args[0] === 'list') {
    console.log(listAccountsText(loadConfig()));
    process.exit(0);
  }

  if (args[0] === 'history') {
    const limit = parseInt(args[1] || '20', 10);
    console.log(formatHistoryText(getCommandHistory(limit)));
    process.exit(0);
  }

  if (args[0] === 'sync') {
    if (args.length < 2) {
      console.error('Thiếu: node post.js sync PARENT_FOLDER_ID\n');
      process.exit(1);
    }

    logCli('sync', [args[1]], 'started', null);

    try {
      const r = await syncDriveFolder(args[1]);
      logCli('sync', [args[1]], 'completed', `${r.total} bài, ${r.downloaded} tải mới`);
      process.exit(0);
    } catch (e) {
      logCli('sync', [args[1]], 'failed', e.message);
      throw e;
    }
  }

  if (args[0] === 'push') {
    if (args.length < 3) {
      console.error('Thiếu: node post.js push <tài khoản> PARENT_FOLDER_ID\n');
      process.exit(1);
    }

    logCli('push', [args[1], args[2]], 'started', null);

    try {
      const { failed } = await runPushFromCache(args[1], args[2]);
      logCli('push', [args[1], args[2]], 'completed', failed ? 'có lỗi' : 'ok');
      process.exit(failed > 0 ? 1 : 0);
    } catch (e) {
      logCli('push', [args[1], args[2]], 'failed', e.message);
      throw e;
    }
  }

  if (args[0] === 'bulk') {
    if (args.length < 3) {
      console.error('Thiếu: node post.js bulk <tài khoản> PARENT_FOLDER_ID\n');
      process.exit(1);
    }

    logCli('bulk', [args[1], args[2]], 'started', null);

    try {
      const { failed } = await runPostBulk(args[1], args[2]);
      logCli('bulk', [args[1], args[2]], 'completed', failed ? 'có lỗi' : 'ok');
      process.exit(failed > 0 ? 1 : 0);
    } catch (e) {
      logCli('bulk', [args[1], args[2]], 'failed', e.message);
      throw e;
    }
  }

  if (args.length < 3) {
    console.error('Thiếu tham số.\n');
    printHelp();
    process.exit(1);
  }

  const [target, docId, folderId] = args;

  logCli('post', [target, docId, folderId], 'started', null);

  try {
    const { failed } = await runPost(target, docId, folderId);
    logCli('post', [target, docId, folderId], 'completed', failed ? 'có lỗi' : 'ok');
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    logCli('post', [target, docId, folderId], 'failed', e.message);
    throw e;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
