const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 15000,
  webServer: {
    command: 'node test/playwrightAuthServer.js',
    url: 'http://127.0.0.1:4173/api/auth/config',
    reuseExistingServer: false,
    timeout: 30000
  },
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:4173'
  },
  reporter: [['line']]
});
