/**
 * SIGNATURE REALTY CRM — Google Sheet Sync
 * ==========================================
 *
 * SETUP (5 minutes):
 * 1. Open your Google Sheet:
 *    https://docs.google.com/spreadsheets/d/1nkjzrMRDCMoWFnzxxovvxu-fzILv6Li-VfBY4VLr-QI/edit
 * 2. Click:  Extensions → Apps Script
 * 3. Delete the default code and paste THIS ENTIRE FILE
 * 4. Update SYNC_TOKEN below if you configured SHEET_SYNC_TOKEN in Render.
 * 5. Click the "Save" (💾) icon
 * 6. Click the ▶️ Run button next to the function "installTriggers"
 *    - Grant permission when prompted (only once)
 * 7. Done! Every new row / edit will auto-sync to CRM within 2 seconds.
 *
 * OPTIONAL — one-time full backfill:
 *   Click ▶️ Run next to "syncAllRows" to push every existing row to CRM.
 */

// ── CONFIG (update these two) ─────────────────────────────────────────
const WEBHOOK_URL = 'https://signature-properties.onrender.com/api/sync/google-sheet';
const SYNC_TOKEN  = 'CHANGE_ME_SECRET'; // must match SHEET_SYNC_TOKEN env on CRM

// ── Sheet tabs to watch ───────────────────────────────────────────────
const WATCHED_TABS = ['Comm', 'Sale', 'Rent'];

/**
 * onEdit — fires whenever ANY cell is edited on ANY sheet.
 * We push the entire changed row to CRM.
 * This is installed as an authorized trigger by installTriggers().
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const tabName = sheet.getName();
    if (WATCHED_TABS.indexOf(tabName) === -1) return;

    const rowIdx = e.range.getRow();
    if (rowIdx <= 1) return; // header row

    const rowData = _getRowAsObject(sheet, rowIdx);
    if (!rowData) return;

    _postToCrm(tabName, [rowData]);
  } catch (err) {
    Logger.log('onEdit error: ' + err.message);
  }
}

/**
 * Installable onChange trigger — catches row inserts, deletes, formatting.
 * Called from installTriggers().
 */
function onSheetChange(e) {
  try {
    if (!e) return;
    if (e.changeType && ['INSERT_ROW','EDIT','FORMAT','OTHER'].indexOf(e.changeType) === -1) return;

    const ss = SpreadsheetApp.getActive();
    WATCHED_TABS.forEach(function(tabName) {
      const sheet = ss.getSheetByName(tabName);
      if (!sheet) return;
      // Push last row only (INSERT_ROW usually happens at the bottom)
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const rowData = _getRowAsObject(sheet, lastRow);
        if (rowData && rowData['Phone']) _postToCrm(tabName, [rowData]);
      }
    });
  } catch (err) {
    Logger.log('onSheetChange error: ' + err.message);
  }
}

/**
 * Install a permanent trigger — run this ONCE from the Apps Script editor.
 * After installation, edits/inserts sync automatically forever.
 */
function installTriggers() {
  // Remove any previous triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onSheetChange' || t.getHandlerFunction() === 'onEdit') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Install an authorized edit trigger so UrlFetchApp can call the CRM.
  ScriptApp.newTrigger('onEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  // Install onChange trigger
  ScriptApp.newTrigger('onSheetChange')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();

  SpreadsheetApp.getActive().toast('CRM Sync installed! Every row edit will now sync.', 'Signature Realty', 5);
}

/**
 * One-time full backfill — push every existing row to CRM.
 * Run manually from Apps Script editor.
 */
function syncAllRows() {
  const ss = SpreadsheetApp.getActive();
  let totalSent = 0;
  WATCHED_TABS.forEach(function(tabName) {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) return;
    const rows = _getAllRowsAsObjects(sheet);
    if (rows.length === 0) return;
    // Send in batches of 50
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50).filter(function(r) { return r['Phone']; });
      if (batch.length) {
        _postToCrm(tabName, batch);
        totalSent += batch.length;
      }
    }
  });
  SpreadsheetApp.getActive().toast('Synced ' + totalSent + ' rows to CRM', 'Signature Realty', 8);
}

/**
 * Send one safe test row — run this from the function dropdown to verify setup.
 */
function testCrmConnection() {
  _postToCrm('Rent', [{ Name: 'Google Sheet Connection Test', Phone: '9999999999' }]);
}

// ── Helpers ───────────────────────────────────────────────────────────

function _getRowAsObject(sheet, rowIdx) {
  const numCols = sheet.getLastColumn();
  if (numCols < 1) return null;
  const headers = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  const values  = sheet.getRange(rowIdx, 1, 1, numCols).getValues()[0];
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    if (!h) continue;
    let v = values[i];
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    obj[h] = v === null || v === undefined ? '' : String(v);
  }
  return obj;
}

function _getAllRowsAsObjects(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const data    = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return data.map(function(row) {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim();
      if (!h) continue;
      let v = row[i];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      obj[h] = v === null || v === undefined ? '' : String(v);
    }
    return obj;
  });
}

function _postToCrm(tab, rows) {
  rows = Array.isArray(rows) ? rows : [];
  const payload = { tab: tab, rows: rows };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Sync-Token': SYNC_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  try {
    const resp = UrlFetchApp.fetch(WEBHOOK_URL, options);
    const responseText = resp && typeof resp.getContentText === 'function' ? resp.getContentText() : '';
    Logger.log('CRM sync response [' + tab + ' x ' + rows.length + ']: ' + resp.getResponseCode() + ' ' + responseText.substring(0, 300));
  } catch (err) {
    Logger.log('CRM sync FAILED: ' + err.message);
  }
}
