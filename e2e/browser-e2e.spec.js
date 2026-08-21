const { test, expect } = require('@playwright/test');

async function inspectRequirementsPage(page) {
  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 3000 });
  await page.locator('#app-content .req-actions-row').first().waitFor({ state: 'attached', timeout: 5000 });

  const requirements = page.locator('#app-content .req-actions-row');
  const rows = await requirements.count();

  if (rows === 0) {
    throw new Error('FIRST_REAL_BREAKPOINT: #app-content .req-actions-row count = 0');
  }

  const expectedButtonNames = ['Edit', 'Duplicate', 'Status', 'History', 'Share', 'Archive'];
  const rowButtons = page.locator('#app-content .req-actions-row button');
  const texts = (await rowButtons.evaluateAll((items) => items.map((item) => item.textContent.trim())));

  for (const expected of expectedButtonNames) {
    if (!texts.includes(expected)) {
      throw new Error(`Expected required action ${expected} in rendered DOM; actual ${JSON.stringify(texts)}`);
    }
  }

  const shareButtons = page.locator('[title="Share to Broker"]');
  await expect(shareButtons).toHaveCount(rows);
  const shareButton = requirements.first().locator('[title="Share to Broker"]');
  await expect(shareButton).toHaveCount(1);
  await expect(shareButton).toBeVisible();
  await expect(shareButton).toBeEnabled();

  await shareButton.click();

  await page.locator('#share-sheet-overlay').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#share-sheet-panel').waitFor({ state: 'attached', timeout: 5000 });

  const sharePanelText = (await page.locator('#share-sheet-panel').innerText()).trim();
  for (const token of ['Share Requirement', 'Select Broker(s)', 'Link Expiry', 'Message Template', 'Send to ... Brokers']) {
    if (!sharePanelText.includes(token)) {
      throw new Error(`Share sheet missing token: ${token}`);
    }
  }

  await page.screenshot({ path: 'test/e2e/screenshots/share-sheet.png', fullPage: true });
}

test('Page opens and requirements action-row/share matrix is visible in browser DOM', async ({ page }) => {
  await page.goto('http://localhost:4173', { waituntil: 'load', timeout: 10000 });
  await page.screenshot({ path: 'test/e2e/screenshots/home.png', fullPage: true });

  const title = await page.title();
  await expect(title).toBe('Signature Properties');

  await page.locator('#app-navigation .nav-link').nth(3).click();
  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 3000 });

  await inspectRequirementsPage(page);
});

test('Browser flow reads lead workspace and clicks basic back control', async ({ page }) => {
  await page.goto('http://localhost:4173', { waituntil: 'load', timeout: 10000 });

  await page.locator('#app-navigation .nav-link').nth(2).click();
  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 3000 });

  await page.locator('#app-content').getByRole('button', { name: 'Back to Leads' }).click();
  await page.locator('#app-content').getByRole('heading', { name: 'Leads' }).waitFor({ state: 'visible', timeout: 3000 });
});

test('Browser can create and save a requirement when the form is opened from the SPA', async ({ page }) => {
  await page.goto('http://localhost:4173', { waituntil: 'load', timeout: 10000 });

  await page.locator('#app-navigation .nav-link').nth(3).click();
  await page.locator('#createRequirementBtn').click();
  await page.locator('#requirement-form').waitFor({ state: 'attached', timeout: 5000 });

  await page.locator('[name="leadId"]').fill('LEAD-0001');
  await page.locator('[name="transactionType"]').selectOption('Purchase');
  await page.locator('[name="category"]').selectOption('Residential');
  await page.locator('[name="propertyType"]').fill('Apartment');
  await page.locator('[name="subCategory"]').fill('Apartment');
  await page.locator('[name="location1"]').fill('Bengaluru East');
  await page.locator('[name="location2"]').fill('Whitefield');
  await page.locator('[name="location3"]').fill('ITPL');
  await page.locator('[name="budgetMin"]').fill('12000000');
  await page.locator('[name="budgetMax"]').fill('15000000');
  await page.locator('[name="possession"]').fill('Ready');
  await page.locator('[name="urgency"]').selectOption('High');
  await page.locator('[name="specialNotes"]').fill('Need immediate shortlist');

  await page.locator('#requirement-form button[type="submit"]').click();

  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 5000 });
  await expect(page.locator('#app-content')).toContainText('Requirements');
});

test('Browser can inspect UI requirement edit and update a requirement urgency', async ({ page }) => {
  await page.goto('http://localhost:4173', { waituntil: 'load', timeout: 10000 });

  await page.locator('#app-navigation .nav-link').nth(3).click();
  await page.locator('#app-content .req-actions-row button[title="Edit Requirement"]').first().click();

  await page.locator('#edit-requirement-form').waitFor({ state: 'attached', timeout: 5000 });
  await page.locator('[name="urgency"]').selectOption('Low');
  await page.locator('#edit-requirement-form button[type="submit"]').click();

  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 5000 });
  await expect(page.locator('#app-content')).toContainText('Requirements');
});

test('Browser can archive a requirement from the UI action row', async ({ page }) => {
  await page.goto('http://localhost:4173', { waituntil: 'load', timeout: 10000 });

  await page.locator('#app-navigation .nav-link').nth(3).click();
  await page.locator('#app-content .req-actions-row button[title="Archive Requirement"]').first().click();

  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 5000 });
  await expect(page.locator('#app-content')).toContainText('Requirements');
});
