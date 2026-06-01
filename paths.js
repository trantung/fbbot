const path = require('path');

const ROOT_DIR = path.resolve(__dirname);
const PROFILES_DIR = path.join(ROOT_DIR, 'profiles');
const COOKIES_DIR = path.join(ROOT_DIR, 'cookies');

function profileDir(profile) {
  return path.join(PROFILES_DIR, profile);
}

function cookieFile(profile) {
  return path.join(COOKIES_DIR, `${profile}.json`);
}

module.exports = {
  ROOT_DIR,
  PROFILES_DIR,
  COOKIES_DIR,
  profileDir,
  cookieFile,
};
