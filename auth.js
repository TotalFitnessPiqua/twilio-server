// auth.js
const fs = require('fs');
const bcrypt = require('bcryptjs');
const path = require('path');

const USERS_PATH = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function findUser(username) {
  const users = loadUsers();
  return users.find(u => u.username === username);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

module.exports = {
  findUser,
  verifyPassword
};
