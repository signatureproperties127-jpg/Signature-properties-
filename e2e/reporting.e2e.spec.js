const { test, expect } = require('@playwright/test');
const { applySession, createSessionToken } = require('./auth-session');

const BASE_URL = 'http://127.0.0.1:4173';

test.setTimeout(90000);

async function requestJson(request, token, method, route, data) {
  const response = await request.fetch(`${BASE_URL}${route}`, {
    method,
    data,
    headers: { 'Content-Type': 'application/json', 'x-session-token': token }
  });
  const payload = await response.json();
  return { response, payload };
}

async function createReportingFixture(request, token, suffix = 'RPE01') {
  const lead = await requestJson(request, token, 'POST', '/api/leads', {
    clientName: `Reporting E2E Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 8666600${suffix}`,
    email: `reporting.e2e.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-3001',
    leadSource: 'Manual'
  });
  expect(lead.response.ok()).toBeTruthy();

  const requirement = await requestJson(request, token, 'POST', '/api/requirements', {
    leadId: lead.payload.data.LeadID,
    transactionId: `TXN-RPE-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 20000000,
    location1: `RPE Location ${suffix}`,
    location2: `RPE East ${suffix}`,
    location3: `RPE District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1700,
    possession: 'Ready',
    urgency: 'High',
    formType: 'residential'
  });
  expect(requirement.response.ok()).toBeTruthy();

  const property = await requestJson(request, token, 'POST', '/api/inventory', {
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `RPE Project ${suffix}`,
    location: `RPE Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1450,
    price: 16200000,
    possession: 'Ready',
    status: 'Available',
    builderId: 'BLD-RPE-01'
  });
  expect(property.response.ok()).toBeTruthy();

  const matching = await requestJson(request, token, 'POST', '/api/matching/run', {
    requirementId: requirement.payload.data.RequirementID
  });
  expect(matching.response.ok()).toBeTruthy();
  const match = matching.payload.data.matches.find((item) => item.PropertyID === property.payload.data.PropertyID);
  expect(match).toBeTruthy();

  const shortlist = await requestJson(request, token, 'POST', '/api/shortlist', {
    requirementId: requirement.payload.data.RequirementID,
    propertyId: property.payload.data.PropertyID,
    matchId: match.MatchID,
    priority: 'High'
  });
  expect(shortlist.response.ok()).toBeTruthy();

  const siteVisit = await requestJson(request, token, 'POST', '/api/site-visits', {
    leadId: lead.payload.data.LeadID,
    requirementId: requirement.payload.data.RequirementID,
    propertyId: property.payload.data.PropertyID,
    matchId: match.MatchID,
    shortlistId: shortlist.payload.data.ShortlistID,
    visitDate: '2026-12-11',
    visitTime: '11:30',
    assignedAgentId: 'USR-3001'
  });
  expect(siteVisit.response.ok()).toBeTruthy();

  const negotiation = await requestJson(request, token, 'POST', '/api/negotiations', {
    LeadID: lead.payload.data.LeadID,
    RequirementID: requirement.payload.data.RequirementID,
    TransactionID: requirement.payload.data.TransactionID,
    PropertyID: property.payload.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.payload.data.ShortlistID,
    SiteVisitID: siteVisit.payload.data.VisitID,
    AskingPrice: 16200000,
    CurrentOffer: 15800000,
    AgreedPrice: 15800000,
    Status: 'AGREED',
    AssignedAgentID: 'USR-3001'
  });
  expect(negotiation.response.ok()).toBeTruthy();

  const tokenRecord = await requestJson(request, token, 'POST', '/api/tokens', {
    NegotiationID: negotiation.payload.data.NegotiationID,
    LeadID: lead.payload.data.LeadID,
    RequirementID: requirement.payload.data.RequirementID,
    PropertyID: property.payload.data.PropertyID,
    SiteVisitID: siteVisit.payload.data.VisitID,
    ShortlistID: shortlist.payload.data.ShortlistID,
    TokenAmount: 500000,
    PaidAmount: 300000,
    PendingAmount: 200000,
    Status: 'PARTIAL'
  });
  expect(tokenRecord.response.ok()).toBeTruthy();

  const deal = await requestJson(request, token, 'POST', '/api/deals', {
    LeadID: lead.payload.data.LeadID,
    RequirementID: requirement.payload.data.RequirementID,
    PropertyID: property.payload.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.payload.data.ShortlistID,
    SiteVisitID: siteVisit.payload.data.VisitID,
    NegotiationID: negotiation.payload.data.NegotiationID,
    TokenID: tokenRecord.payload.data.TokenID,
    FinalPrice: 15800000,
    Brokerage: 316000,
    Status: 'COMPLETED'
  });
  expect(deal.response.ok()).toBeTruthy();

  const commission = await requestJson(request, token, 'POST', '/api/commission', {
    DealID: deal.payload.data.DealID,
    LeadID: lead.payload.data.LeadID,
    RequirementID: requirement.payload.data.RequirementID,
    PropertyID: property.payload.data.PropertyID,
    AgentID: 'USR-3001',
    CommissionType: 'PERCENTAGE',
    BaseAmount: 15800000,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50
  });
  expect(commission.response.ok()).toBeTruthy();

  return { leadId: lead.payload.data.LeadID, commissionId: commission.payload.data.CommissionID };
}

test('reporting center renders real analytics and filter/export actions using persisted data', async ({ page }) => {
  const token = await createSessionToken();
  await createReportingFixture(page.request, token, '801');

  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await applySession(page);
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 12000 });
  await page.locator('#app-navigation .nav-link', { hasText: 'Reports' }).click();

  await expect(page.locator('#app-content').getByRole('heading', { name: 'Reporting Center', exact: true })).toBeVisible();
  await expect(page.locator('#app-content')).toContainText('Executive Dashboard');
  await expect(page.locator('#app-content')).toContainText('Lead Conversion Funnel');

  await page.selectOption('#reportsDatePreset', 'thisyear');
  await page.locator('#reportsFilterForm button[type="submit"]').click();

  await expect(page.locator('#app-content')).toContainText('Top Agents');
  await expect(page.locator('#app-content')).toContainText('Source Performance');
  await expect(page.locator('#app-content')).toContainText('Commission & Closing');

  const exportButtons = page.locator('.reports-export-btn');
  await expect(exportButtons).toHaveCount(4);

  const state = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(state.scrollWidth - state.clientWidth).toBe(0);

  expect(consoleErrors.length).toBe(0);
  expect(pageErrors.length).toBe(0);
});

test('reporting center is responsive and usable on 360/390/768/1024 viewports', async ({ browser }) => {
  const viewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 }
  ];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await applySession(page);
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 12000 });
    await page.locator('#app-navigation .nav-link', { hasText: 'Reports' }).click();

    await expect(page.locator('#app-content').getByRole('heading', { name: 'Reporting Center', exact: true })).toBeVisible();
    await expect(page.locator('#reportsFilterForm')).toBeVisible();
    await expect(page.locator('#reportsFilterForm button[type="submit"]')).toBeVisible();

    const state = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyText: document.body.innerText
    }));

    expect(state.scrollWidth - state.clientWidth).toBe(0);
    expect(state.bodyText.includes('Executive Dashboard')).toBeTruthy();
    expect(state.bodyText.includes('Financial Snapshot')).toBeTruthy();

    expect(consoleErrors.length).toBe(0);
    expect(pageErrors.length).toBe(0);

    await page.close();
  }
});
