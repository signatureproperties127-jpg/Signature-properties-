'use strict';

/**
 * mongoStore — snapshot-based Mongo backing for JsonRepository.
 *
 * The existing repository interface is fully synchronous (read/write). We
 * preserve that by:
 *   1. Loading the entire DB snapshot from Mongo into an in-memory cache
 *      during an async pre-boot phase (initMongo()).
 *   2. Returning that cache from read() (deep-clone-per-call so mutations
 *      by callers don't sneak through until write() commits).
 *   3. Serializing writes into a background persist queue that upserts a
 *      single snapshot document `{ _id: "singleton" }` in the
 *      `db_snapshot` collection.
 *
 * A single-document snapshot keeps migration trivial (no per-collection
 * schema churn) and easily fits under the 16 MB BSON limit for realistic
 * broker CRM sizes (current DB is ~600 KB).
 *
 * Env:
 *   STORAGE_MODE = "mongo" | "json"                (default: json)
 *   MONGO_URL    = "mongodb://localhost:27017"     (required when mongo)
 *   MONGO_DB     = database name                   (default: signature_realty)
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');

const STORAGE_MODE = (process.env.STORAGE_MODE || 'json').toLowerCase();
const MONGO_URL    = process.env.MONGO_URL || '';
const MONGO_DB     = process.env.MONGO_DB || 'signature_realty';
const SNAP_COLL    = 'db_snapshot';
const SNAP_ID      = 'singleton';

let _client = null;
let _db = null;
let _cache = null;
let _initialized = false;
let _writeQueue = Promise.resolve();
let _lastWriteError = null;
let _writeStats = { successes: 0, failures: 0, lastWriteAt: null };

function isEnabled() {
  return STORAGE_MODE === 'mongo' && !!MONGO_URL;
}

function isInitialized() {
  return _initialized;
}

/**
 * Async init — connect to Mongo, load the snapshot into memory. If Mongo
 * is empty, seed from the JSON file (if present) so the first-time
 * migration is transparent. Must be awaited before `.listen()` starts.
 */
async function initMongo(fallbackJsonPath) {
  if (!isEnabled()) return { skipped: true, reason: 'STORAGE_MODE!=mongo or missing MONGO_URL' };
  if (_initialized) return { skipped: true, reason: 'already initialized' };

  _client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  await _client.connect();
  _db = _client.db(MONGO_DB);

  const snap = await _db.collection(SNAP_COLL).findOne({ _id: SNAP_ID });
  if (snap && snap.payload) {
    _cache = snap.payload;
    _initialized = true;
    return { ok: true, source: 'mongo', size: JSON.stringify(_cache).length };
  }

  // Mongo empty — seed from JSON file if present (one-time migration)
  if (fallbackJsonPath && fs.existsSync(fallbackJsonPath)) {
    _cache = JSON.parse(fs.readFileSync(fallbackJsonPath, 'utf8'));
    await _db.collection(SNAP_COLL).replaceOne(
      { _id: SNAP_ID },
      { _id: SNAP_ID, payload: _cache, updatedAt: new Date(), migratedFrom: fallbackJsonPath },
      { upsert: true }
    );
    _initialized = true;
    return { ok: true, source: 'json-migrated', size: JSON.stringify(_cache).length };
  }

  // Fresh install — start with empty cache; JsonRepository.ensureDatabase()
  // will populate seed collections into `write()` which we then persist.
  _cache = {};
  _initialized = true;
  return { ok: true, source: 'fresh', size: 0 };
}

/**
 * Deep-clone the current cache and return it (mirrors JsonRepository.read()).
 * Mutations by callers stay in their local copy until write(db) commits.
 */
function read() {
  if (!_initialized) throw new Error('mongoStore.read() called before initMongo()');
  return JSON.parse(JSON.stringify(_cache));
}

/**
 * Replace the cache and enqueue a persist. Persist runs asynchronously
 * but is chained through _writeQueue so writes never race with each
 * other. Errors are surfaced through _lastWriteError and stats.
 */
function write(db) {
  if (!_initialized) throw new Error('mongoStore.write() called before initMongo()');
  _cache = db;
  const snapshot = JSON.parse(JSON.stringify(db));
  _writeQueue = _writeQueue.then(async () => {
    try {
      await _db.collection(SNAP_COLL).replaceOne(
        { _id: SNAP_ID },
        { _id: SNAP_ID, payload: snapshot, updatedAt: new Date() },
        { upsert: true }
      );
      _writeStats.successes += 1;
      _writeStats.lastWriteAt = new Date();
      _lastWriteError = null;
    } catch (e) {
      _writeStats.failures += 1;
      _lastWriteError = e;
      console.error('[mongoStore] Write failed:', e.message);
    }
  });
}

/**
 * Await the next flush of the write queue. Call before graceful shutdown.
 */
async function flush() {
  await _writeQueue;
  return { ..._writeStats, lastError: _lastWriteError ? _lastWriteError.message : null };
}

function close() {
  if (_client) {
    return _client.close();
  }
  return Promise.resolve();
}

function stats() {
  return {
    enabled: isEnabled(),
    initialized: _initialized,
    cacheSize: _cache ? JSON.stringify(_cache).length : 0,
    ..._writeStats,
    lastError: _lastWriteError ? _lastWriteError.message : null
  };
}

module.exports = { isEnabled, isInitialized, initMongo, read, write, flush, close, stats };
