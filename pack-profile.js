const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { profileDir, PROFILES_DIR } = require('./paths');

const profile = process.argv[2];

if (!profile) {
  console.error('Cách dùng: node pack-profile.js accountA');
  process.exit(1);
}

const dir = profileDir(profile);

if (!fs.existsSync(dir)) {
  console.error('Không có profile:', dir);
  console.error('Chạy trước: node login.js', profile);
  process.exit(1);
}

const archive = path.resolve(`profiles-${profile}.tar.gz`);

console.log('Đóng gói User Data Dir:', dir);
console.log('→', archive);

execSync(`tar -czf "${archive}" -C "${PROFILES_DIR}" "${profile}"`, {
  stdio: 'inherit',
});

const sizeMb = (fs.statSync(archive).size / 1024 / 1024).toFixed(1);

console.log(`\nXong (${sizeMb} MB). Upload lên VPS:`);
console.log(`  scp "${archive}" USER@IP:/đường/dẫn/fb-agent/`);
console.log('\nTrên VPS:');
console.log('  pm2 stop fbbot');
console.log(`  tar -xzf profiles-${profile}.tar.gz`);
console.log(`  node check-session.js ${profile}`);
console.log('  pm2 start fbbot');
