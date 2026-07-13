const TRACKER_FOLDER_NAME = "Embers Tracker Cloud Sync";
const TRACKER_APP_ID = "embers-tracker";

function doPost(event) {
  try {
    const request = JSON.parse((event && event.postData && event.postData.contents) || "{}");
    const action = String(request.action || "").toLowerCase();
    if (action === "create") return jsonResponse(createTracker(request));
    if (action === "pull") return jsonResponse(pullTracker(request));
    if (action === "push") return jsonResponse(pushTracker(request));
    if (action === "list") return jsonResponse(listTrackers(request));
    if (action === "adminpull") return jsonResponse(adminPullTracker(request));
    if (action === "adminpush") return jsonResponse(adminPushTracker(request));
    if (action === "rename") return jsonResponse(renameTracker(request));
    return jsonResponse({ ok: false, error: "Unknown action." });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || "Apps Script error." });
  }
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function trackerFolder() {
  const folders = DriveApp.getFoldersByName(TRACKER_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(TRACKER_FOLDER_NAME);
}

function cleanCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function newTrackerCode(name) {
  const prefix = cleanCode(name || "EMBER").slice(0, 18) || "EMBER";
  const suffix = Utilities.getUuid().split("-")[0].toUpperCase();
  return `${prefix}-${suffix}`;
}

function pinHash(pin) {
  const cleanPin = String(pin || "").trim();
  if (!cleanPin) throw new Error("Tracker PIN is required.");
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, cleanPin);
  return Utilities.base64Encode(bytes);
}

function propertyKey(code) {
  return `tracker:${cleanCode(code)}`;
}

function trackerRecord(code) {
  const raw = PropertiesService.getScriptProperties().getProperty(propertyKey(code));
  return raw ? JSON.parse(raw) : null;
}

function saveTrackerRecord(record) {
  PropertiesService.getScriptProperties().setProperty(propertyKey(record.code), JSON.stringify(record));
}

function deleteTrackerRecord(code) {
  PropertiesService.getScriptProperties().deleteProperty(propertyKey(code));
}

function adminPinHash() {
  return PropertiesService.getScriptProperties().getProperty("ADMIN_PIN_HASH");
}

function requireAdminAccess(request) {
  const pin = String(request.adminPin || "").trim();
  if (!pin) throw new Error("Admin code is required.");
  const hash = pinHash(pin);
  const properties = PropertiesService.getScriptProperties();
  const saved = adminPinHash();
  if (!saved) {
    properties.setProperty("ADMIN_PIN_HASH", hash);
    return;
  }
  if (saved !== hash) throw new Error("Admin code did not match.");
}

function requireTrackerAccess(request) {
  const code = cleanCode(request.code);
  if (!code) throw new Error("Tracker code is required.");
  const record = trackerRecord(code);
  if (!record) throw new Error("Tracker code was not found.");
  if (record.pinHash !== pinHash(request.pin)) throw new Error("Tracker PIN did not match.");
  return record;
}

function createTracker(request) {
  const name = String(request.name || "Embers Tracker").trim();
  const code = cleanCode(request.code) || newTrackerCode(name);
  if (trackerRecord(code)) throw new Error("That tracker code already exists. Try another name.");
  const payload = normalizePayload(request.payload);
  const now = new Date().toISOString();
  const file = trackerFolder().createFile(`${code}.json`, JSON.stringify(payload, null, 2), MimeType.PLAIN_TEXT);
  const record = {
    code,
    name,
    fileId: file.getId(),
    pinHash: pinHash(request.pin),
    createdAt: now,
    updatedAt: now,
  };
  saveTrackerRecord(record);
  return { ok: true, code, name, updatedAt: now };
}

function pullTracker(request) {
  const record = requireTrackerAccess(request);
  const file = DriveApp.getFileById(record.fileId);
  const payload = JSON.parse(file.getBlob().getDataAsString() || "{}");
  return { ok: true, code: record.code, name: record.name, updatedAt: record.updatedAt || file.getLastUpdated().toISOString(), payload };
}

function pushTracker(request) {
  const record = requireTrackerAccess(request);
  const payload = normalizePayload(request.payload);
  const now = new Date().toISOString();
  DriveApp.getFileById(record.fileId).setContent(JSON.stringify(payload, null, 2));
  record.updatedAt = now;
  saveTrackerRecord(record);
  return { ok: true, code: record.code, name: record.name, updatedAt: now };
}

function adminTrackerRecord(request) {
  requireAdminAccess(request);
  const code = cleanCode(request.code);
  if (!code) throw new Error("Tracker code is required.");
  const record = trackerRecord(code);
  if (!record) throw new Error("Tracker code was not found.");
  return record;
}

function adminPullTracker(request) {
  const record = adminTrackerRecord(request);
  const file = DriveApp.getFileById(record.fileId);
  const payload = JSON.parse(file.getBlob().getDataAsString() || "{}");
  return { ok: true, code: record.code, name: record.name, updatedAt: record.updatedAt || file.getLastUpdated().toISOString(), payload };
}

function adminPushTracker(request) {
  const record = adminTrackerRecord(request);
  const payload = normalizePayload(request.payload);
  const now = new Date().toISOString();
  DriveApp.getFileById(record.fileId).setContent(JSON.stringify(payload, null, 2));
  record.updatedAt = now;
  saveTrackerRecord(record);
  return { ok: true, code: record.code, name: record.name, updatedAt: now };
}

function renameTracker(request) {
  requireAdminAccess(request);
  const oldCode = cleanCode(request.code);
  const newCode = cleanCode(request.newCode);
  if (!oldCode) throw new Error("Current tracker code is required.");
  if (!newCode) throw new Error("New tracker code is required.");
  const record = trackerRecord(oldCode);
  if (!record) throw new Error("Tracker code was not found.");
  if (oldCode !== newCode && trackerRecord(newCode)) throw new Error("That tracker code already exists. Try another name.");

  const now = new Date().toISOString();
  const name = String(request.name || "").trim();
  const oldRecordCode = record.code;
  record.code = newCode;
  if (name) record.name = name;
  record.updatedAt = now;

  DriveApp.getFileById(record.fileId).setName(`${newCode}.json`);
  saveTrackerRecord(record);
  if (oldRecordCode !== newCode) deleteTrackerRecord(oldRecordCode);
  return { ok: true, code: record.code, name: record.name, updatedAt: now };
}

function listTrackers(request) {
  requireAdminAccess(request);
  const properties = PropertiesService.getScriptProperties().getProperties();
  const trackers = Object.keys(properties)
    .filter((key) => key.indexOf("tracker:") === 0)
    .map((key) => JSON.parse(properties[key]))
    .map((record) => ({
      code: record.code,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return { ok: true, trackers };
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Tracker payload is required.");
  payload.app = payload.app || TRACKER_APP_ID;
  payload.syncedAt = new Date().toISOString();
  return payload;
}
