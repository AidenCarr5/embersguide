const TRACKER_FOLDER_NAME = "Embers Tracker Cloud Sync";
const TRACKER_APP_ID = "embers-tracker";

function doPost(event) {
  try {
    const request = JSON.parse((event && event.postData && event.postData.contents) || "{}");
    const action = String(request.action || "").toLowerCase();
    if (action === "create") return jsonResponse(createTracker(request));
    if (action === "pull") return jsonResponse(pullTracker(request));
    if (action === "push") return jsonResponse(pushTracker(request));
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

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Tracker payload is required.");
  payload.app = payload.app || TRACKER_APP_ID;
  payload.syncedAt = new Date().toISOString();
  return payload;
}
