const fs = require('fs');
const path = require('path');
const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

const AUTH_FILE = 'creds.json';

function useSingleFileAuthState(folder) {
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, AUTH_FILE);

  let data;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    data = JSON.parse(raw, BufferJSON.reviver);
    if (!data.creds) data.creds = initAuthCreds();
  } catch {
    data = { creds: initAuthCreds(), keys: {} };
  }

  const write = () => {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, BufferJSON.replacer));
    fs.renameSync(tmp, filePath);
  };

  return {
    state: {
      creds: data.creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          for (const id of ids) {
            result[id] = data.keys[`${type}-${id}`] || null;
          }
          return result;
        },
        set: async (entries) => {
          for (const category in entries) {
            for (const id in entries[category]) {
              const value = entries[category][id];
              const key = `${category}-${id}`;
              if (value) data.keys[key] = value;
              else delete data.keys[key];
            }
          }
          write();
        }
      }
    },
    saveCreds: () => {
      write();
    }
  };
}

module.exports = { useSingleFileAuthState };
