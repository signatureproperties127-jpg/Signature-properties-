const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 15000,
  webServer: {
    command: 'TMP_DIR=$(mktemp -d) && PORT=4173 SIG_REALTY_DB_FILE="$TMP_DIR/sig-realty-db.json" node server.js',
    url: 'http://127.0.0.1:4173/api/dashboard',
    reuseExistingServer: false,
    timeout: 30000
  },
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:4173'
  },
  reporter: [['line']]
});
