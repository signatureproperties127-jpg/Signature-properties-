const { test, expect } = require('@playwright/test');
const { applySession, createSessionToken } = require('./auth-session');

test('broker network share page is private, responsive, and supports property attachment', async ({ page, request }) => {
  const session = await createSessionToken();
  const networkHeaders = { 'x-session-token': session };
  const property = await request.post('/api/inventory', {
    headers: networkHeaders,
    data: {
      PropertyID: 'PROP-NETWORK-E2E',
      Category: 'Residential',
      PropertyType: 'Apartment',
      Project: 'E2E Network Project',
      Location: 'Bengaluru East',
      BHK: 2,
      Area: 1450,
      Price: 18000000,
      Status: 'Available',
      BrokerID: 'USR-0001'
    }
  });
  expect(property.ok()).toBeTruthy();

  const created = await request.post('/api/broker-network/shares', {
    headers: networkHeaders,
    data: { requirementId: 'REQ-0001', expiry: '7d' }
  });
  expect(created.status()).toBe(201);
  const payload = await created.json();
  const token = payload.data.token;
  expect(token).toBeTruthy();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await applySession(page);

  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/broker-network/share/${token}`);
    await expect(page.getByText('Shared property requirement')).toBeVisible();
    await expect(page.getByText('Client identity remains hidden.')).toBeVisible();
    await expect(page.getByText('Rohan Verma')).toHaveCount(0);
    await expect(page.getByText('rohan.v@example.com')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBeFalsy();
  }

  await page.fill('#propertyId', 'PROP-NETWORK-E2E');
  await page.click('#attach');
  await expect(page.locator('#result')).toHaveText('Property submitted.');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
