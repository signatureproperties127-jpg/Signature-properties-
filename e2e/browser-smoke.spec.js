const { test, expect } = require('@playwright/test');

test('Signature Realty OS real browser smoke and requirement action-row inspection', async ({ page }) => {
  await page.goto('http://localhost:4173', { waituntil: 'load', timeout: 10000 });
  await page.screenshot({ path: 'test/e2e/screenshots/home.png', fullPage: true });

  const title = await page.title();
  const bodyText = await page.locator('body').innerText();
  const bodyHtml = await page.locator('body').evaluate((element) => element.innerHTML);

  await expect(title).toBe('Signature Realty OS');
  await expect(bodyText.length).toBeGreaterThan(1);
  await expect(bodyHtml.length).toBeGreaterThan(1);

  await page.locator('#app-navigation .nav-link').nth(3).click();
  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 3000 });

  await page.locator('#app-content .req-actions-row').first().waitFor({ state: 'attached', timeout: 5000 });

  const actionRows = await page.locator('#app-content .req-actions-row').count();
  const firstRow = page.locator('#app-content .req-actions-row').first();

  const actionButtonTexts = await firstRow.locator('button').evaluateAll((items) =>
    items.map((item) => ({ text: item.textContent.trim(), title: item.getAttribute('title'), className: item.className, id: item.getAttribute('id') }))
  );

  const shareButtons = page.locator('[title="Share to Broker"]');
  const shareCount = await shareButtons.count();
  const firstRowShareButton = firstRow.locator('[title="Share to Broker"]');

  await expect(actionRows).toBeGreaterThan(0);
  await expect(shareButtons).toHaveCount(actionRows);
  await expect(firstRowShareButton).toHaveCount(1);

  const shareButton = firstRowShareButton;
  const shareButtonBox = await shareButton.boundingBox();

  await expect(shareButton).toBeVisible();
  await expect(shareButton).toBeEnabled();

  await shareButton.click();

  await page.locator('#share-sheet-overlay').waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#share-sheet-panel').waitFor({ state: 'attached', timeout: 3000 });

  const sharePanelText = (await page.locator('#share-sheet-panel').innerText()).trim();
  await expect(sharePanelText).toContain('Share Requirement');
  await expect(sharePanelText).toContain('Select Broker(s)');
  await expect(sharePanelText).toContain('Link Expiry');
  await expect(sharePanelText).toContain('Message Template');
  await expect(sharePanelText).toContain('Send to ... Brokers');

  await page.screenshot({ path: 'test/e2e/screenshots/share-sheet.png', fullPage: true });

  const info = {
    title,
    bodyTextLength: bodyText.length,
    rows: actionRows,
    shareCount,
    shareButtonBox,
    attemptedButtons: actionButtonTexts
  };

  console.log(JSON.stringify(info));
});
