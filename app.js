const STORE_KEY = "ember-badge-studio-v1";
const TRACKER_APP_ID = "embers-tracker";
const TRACKER_SCHEMA_VERSION = 1;
const DRIVE_SYNC_FILE_NAME = "Embers Tracker Sync.json";
const DRIVE_SYNC_FOLDER_NAME = "Embers Tracker Files";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DEFAULT_GOOGLE_CLIENT_ID = "428700740931-sos1bugq8r2f4eaqli22tkeind062sm3.apps.googleusercontent.com";
const DEFAULT_GOOGLE_APP_ID = "428700740931";
const DEFAULT_GOOGLE_API_KEY = "AIzaSyBC9TQs0YQX_VDzNrQr2inJntsE5h-QUlU";
const DEFAULT_APPS_SCRIPT_ENDPOINT = "https://script.google.com/macros/s/AKfycbxCe2I-9wSIiWY1Zb0SbcpYVnrJu_hAw3dL4TlyOzxPaFqfPLSqcSdjQDHU9THZDaIXHg/exec";

let driveTokenClient = null;
let driveAccessToken = "";
let driveTokenExpiresAt = 0;
let driveAutoPushTimer = null;
let suppressDriveAutoPush = true;
let driveSyncInFlight = false;
let driveSyncHydrated = false;
let driveTrackerFiles = [];
let googlePickerReady = false;
let appScriptSyncInFlight = false;
let appScriptAutoPushTimer = null;
let suppressAppScriptAutoPush = true;

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

const uid = (prefix = "id") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const today = () => new Date().toISOString().slice(0, 10);

function makeBadge(id, area, name, requiredCount, requirementTitles, options = {}) {
  return {
    id,
    area,
    name,
    requiredCount,
    imageUrl: options.imageUrl || "",
    progressMode: options.progressMode === "criteria" ? "criteria" : "events",
    requirements: requirementTitles.map((title) => ({
      id: `${id}-${slug(title)}`,
      title,
    })),
  };
}

function meetingCreditTitles(count) {
  return Array.from({ length: count }, (_, index) => `Meeting credit ${index + 1}`);
}

const BRANCHES = {
  sparks: { singular: "Spark", plural: "Sparks", productPrefix: "SPARK" },
  embers: { singular: "Ember", plural: "Embers", productPrefix: "EMBERS" },
  guides: { singular: "Guide", plural: "Guides", productPrefix: "GUIDE" },
  pathfinders: { singular: "Pathfinder", plural: "Pathfinders", productPrefix: "PATHFINDER" },
  rangers: { singular: "Ranger", plural: "Rangers", productPrefix: "RANGER" },
};

const DEFAULT_BRANCH = "embers";

function branchValue(value) {
  const key = String(value || "").trim().toLowerCase();
  return BRANCHES[key] ? key : DEFAULT_BRANCH;
}

function currentBranchKey() {
  try {
    return branchValue(state?.settings?.branch);
  } catch {
    return DEFAULT_BRANCH;
  }
}

function currentBranch() {
  return BRANCHES[currentBranchKey()];
}

function branchSingular() {
  return currentBranch().singular;
}

function branchPlural() {
  return currentBranch().plural;
}

const branchTextOriginals = new WeakMap();
const branchAttributeOriginals = new WeakMap();

function branchCopyText(text) {
  const singular = branchSingular();
  const plural = branchPlural();
  return String(text || "")
    .replace(/\bEmbers\b/g, plural)
    .replace(/\bEmber\b/g, singular)
    .replace(/\bembers\b/g, plural.toLowerCase())
    .replace(/\bember\b/g, singular.toLowerCase());
}

function shouldSkipBranchTextNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest("script, style, option, select, input, textarea, #appTitle, #loginAppTitle, #notes, .guides-logo-img"));
}

function renderBranchCopy() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    if (shouldSkipBranchTextNode(node)) return;
    if (!branchTextOriginals.has(node)) branchTextOriginals.set(node, node.nodeValue);
    const original = branchTextOriginals.get(node);
    if (/\bEmbers?\b/i.test(original)) node.nodeValue = branchCopyText(original);
  });

  $$("[placeholder], [aria-label]").forEach((element) => {
    if (element.closest("#appTitle, #loginAppTitle, .guides-logo-img")) return;
    ["placeholder", "aria-label"].forEach((attr) => {
      const value = element.getAttribute(attr);
      if (!value || !/\bEmbers?\b/i.test(value)) return;
      let originals = branchAttributeOriginals.get(element);
      if (!originals) {
        originals = {};
        branchAttributeOriginals.set(element, originals);
      }
      originals[attr] = originals[attr] || value;
      element.setAttribute(attr, branchCopyText(originals[attr]));
    });
  });
}

function embersOfficialSiteBadges() {
  const themeRows = [
    ["Be Well", "My Healthy Relationships"],
    ["Be Well", "My Mighty Mind"],
    ["Be Well", "My Physical Self"],
    ["Build Skills", "Money Sense"],
    ["Build Skills", "Life Stuff"],
    ["Build Skills", "How To"],
    ["Connect and Question", "Canadian Connections"],
    ["Connect and Question", "Local Communities"],
    ["Connect and Question", "World Stage"],
    ["Experiment and Create", "Art Studio"],
    ["Experiment and Create", "Design Space"],
    ["Experiment and Create", "Science Lab"],
    ["Explore Identities", "Being You"],
    ["Explore Identities", "Different Together"],
    ["Explore Identities", "Gender Power"],
    ["Guide Together", "Global Guiding"],
    ["Guide Together", "Our Story"],
    ["Guide Together", "Spirit of Guiding"],
    ["Into the Outdoors", "Camping Skills & Adventures"],
    ["Into the Outdoors", "Nature Discoveries"],
    ["Into the Outdoors", "Our Shared Planet"],
    ["Take Action", "Your Action"],
    ["Take Action", "Your Choice"],
    ["Take Action", "Your Voice"],
  ];

  const areaBadges = [...new Set(themeRows.map(([area]) => area))].map((name) => ({
    area: name,
    name,
    requiredCount: 2,
    requirementTitles: themeRows.filter(([area]) => area === name).map(([, themeName]) => themeName),
  }));

  const themeBadges = themeRows.map(([area, name]) => ({ area, name, requiredCount: 5 }));

  const discoveryBadges = [
    "Adventurer",
    "Animal Helper",
    "Artist",
    "Camper",
    "Change Champion A",
    "Change Champion B",
    "Experimenter",
    "Foodie",
    "Inventor",
    "Leader",
    "Maker",
    "Mindful Mover",
    "Planet Protector",
    "Volunteer",
  ].map((name) => ({ area: "Discovery Badges", name, requiredCount: 1 }));

  return [...areaBadges, ...themeBadges, ...discoveryBadges].map((badge) =>
    makeBadge(
      `site-${officialBadgeKey(badge.name)}`,
      badge.area,
      badge.name,
      badge.requiredCount,
      badge.requirementTitles || meetingCreditTitles(badge.requiredCount)
    )
  );
}

const PROGRAM_AREAS = [
  "Be Well",
  "Build Skills",
  "Connect and Question",
  "Experiment and Create",
  "Explore Identities",
  "Guide Together",
  "Into the Outdoors",
  "Take Action",
];

function titleCaseBadgeName(value) {
  return String(value || "")
    .replace(/MY HEATHY/gi, "MY HEALTHY")
    .replace(/\bAND\b/gi, "and")
    .replace(/\s*-\s*/g, " - ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\bAnd\b/g, "and")
    .replace(/Camp Award - /i, "")
    .replace(/Camping Skills and Adventure$/i, "Camping Skills & Adventures")
    .replace(/Camping Skills and Adventures$/i, "Camping Skills & Adventures")
    .trim();
}

function normalizeStoreTitle(productTitle, branchKey) {
  const prefix = BRANCHES[branchKey]?.productPrefix || "";
  let title = String(productTitle || "")
    .replace(new RegExp(`^\\d*GF-${prefix}-`, "i"), "")
    .replace(new RegExp(`^GF-${prefix}-`, "i"), "")
    .replace(/--+/g, "-")
    .replace(/:$/g, "")
    .trim();

  if (/^DISCOVERY BADGE-/i.test(title)) {
    return { area: "Discovery Badges", name: titleCaseBadgeName(title.replace(/^DISCOVERY BADGE-/i, "")), requiredCount: 1 };
  }
  if (/^CAMP AWARD-/i.test(title)) {
    return { area: "Camp Awards", name: titleCaseBadgeName(title.replace(/^CAMP AWARD-/i, "")), requiredCount: 1 };
  }

  for (const area of PROGRAM_AREAS) {
    const areaKey = area.toUpperCase();
    if (title.toUpperCase() === areaKey) return { area, name: area, requiredCount: 2, requirementTitles: [] };
    if (title.toUpperCase().startsWith(`${areaKey}-`)) {
      return { area, name: titleCaseBadgeName(title.slice(areaKey.length + 1)), requiredCount: 5 };
    }
  }

  return { area: "Insignia & Awards", name: titleCaseBadgeName(title), requiredCount: 1 };
}

function branchCatalogProducts(branchKey) {
  return (window.BRANCH_BADGE_PRODUCTS && Array.isArray(window.BRANCH_BADGE_PRODUCTS[branchKey]))
    ? window.BRANCH_BADGE_PRODUCTS[branchKey]
    : [];
}

function branchOfficialSiteBadges(branchKey) {
  if (branchKey === "embers") return embersOfficialSiteBadges();
  const badgeRows = branchCatalogProducts(branchKey).map((product) => {
    const badge = normalizeStoreTitle(product.title, branchKey);
    return { ...badge, imageUrl: product.image || "" };
  });
  const themeRows = badgeRows.filter((badge) => PROGRAM_AREAS.includes(badge.area) && badge.name !== badge.area);
  return badgeRows.map((badge) => {
    const requirementTitles = badge.name === badge.area
      ? themeRows.filter((theme) => theme.area === badge.area).map((theme) => theme.name)
      : meetingCreditTitles(badge.requiredCount);
    return makeBadge(
      `site-${branchKey}-${officialBadgeKey(badge.name)}`,
      badge.area,
      badge.name,
      badge.requiredCount,
      badge.requirementTitles?.length ? badge.requirementTitles : requirementTitles,
      { imageUrl: badge.imageUrl }
    );
  });
}

function officialSiteBadges(branchKey = currentBranchKey()) {
  return branchOfficialSiteBadges(branchValue(branchKey));
}

function officialBadgeByName() {
  return new Map(officialSiteBadges().map((badge) => [badge.name.trim().toLowerCase(), badge]));
}

function isCustomBadge(badge) {
  return String(badge?.id || "").startsWith("custom-");
}

function officialBadgesWithSavedCriteria(previousBadges = [], branchKey = currentBranchKey()) {
  const savedById = new Map(previousBadges.filter((badge) => String(badge.id || "").startsWith("site-")).map((badge) => [badge.id, badge]));
  return officialSiteBadges(branchKey).map((badge) => {
    const saved = savedById.get(badge.id);
    if (!saved || isProgramAreaBadge(badge)) return badge;
    return {
      ...badge,
      requiredCount: badge.requiredCount,
      requirements: Array.isArray(saved.requirements) && saved.requirements.length >= badge.requiredCount ? saved.requirements : badge.requirements,
    };
  });
}

function buildEmptyData(branchKey = DEFAULT_BRANCH) {
  const branch = branchValue(branchKey);
  return {
    kids: [],
    badges: officialSiteBadges(branch),
    meetings: [],
    baselineCredits: [],
    manualBadgeAdjustments: {},
    manualCriteriaSelections: {},
    badgeHandouts: {},
    attendanceRecords: [],
    scheduledEvents: [],
    weeklyPlans: [],
    notes: [],
    patrolPointSpending: [],
    cookieTracker: { rows: {}, orders: [], grocery: {} },
    settings: {
      branch,
      badgeEditConfirmation: true,
      badgeProgressResetDone: false,
      driveSync: { clientId: "", apiKey: "", appId: "", folderId: "", folderName: DRIVE_SYNC_FOLDER_NAME, fileId: "", fileName: DRIVE_SYNC_FILE_NAME, autoPull: true, autoPush: true, remoteModifiedTime: "", lastPulledAt: "", lastPushedAt: "", webViewLink: "" },
      appScriptSync: { endpoint: DEFAULT_APPS_SCRIPT_ENDPOINT, trackerCode: "", trackerName: "", pin: "", autoPush: true, lastPulledAt: "", lastPushedAt: "", remoteUpdatedAt: "" },
    },
    createdAt: new Date().toISOString(),
  };
}

const EMBER_YEAR_LABELS = {
  "1": "1st year",
  "2": "2nd year",
  "3": "3rd year",
};

function emberYearValue(value) {
  const year = String(value || "").trim();
  return EMBER_YEAR_LABELS[year] ? year : "";
}

function emberYearLabel(value) {
  return EMBER_YEAR_LABELS[emberYearValue(value)] || "No year set";
}

function ordinalYearLabel(year) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} year`;
}

const MEMBERSHIP_YEAR_LABELS = Object.fromEntries(
  Array.from({ length: 13 }, (_, index) => {
    const year = index + 1;
    return [String(year), ordinalYearLabel(year)];
  })
);

const OTHER_PATROL_VALUE = "__other__";

const LEADERSHIP_LABELS = {
  none: "N/A",
  patrolLeader: "Patrol leader",
  patrolSecond: "Patrol second",
};

const RETURNING_LABELS = {
  returningThirdYear: "Returning 3rd year",
  newThirdYear: "New 3rd year",
  returningSecondYear: "Returning 2nd year",
  newSecondYear: "New 2nd year",
  firstYear: "1st year",
};

const ROSTER_STATUS_ORDER = {
  returningThirdYear: 0,
  newThirdYear: 1,
  returningSecondYear: 2,
  newSecondYear: 3,
  firstYear: 4,
  "": 5,
};

function membershipYearValue(value) {
  const year = String(value || "").trim();
  return MEMBERSHIP_YEAR_LABELS[year] ? year : "";
}

function leadershipValue(value) {
  const key = String(value || "none").trim();
  return LEADERSHIP_LABELS[key] ? key : "none";
}

function returningValue(value) {
  const key = String(value || "").trim();
  if (key === "returning") return "returningSecondYear";
  return RETURNING_LABELS[key] ? key : "";
}

function returningLabel(value) {
  return RETURNING_LABELS[returningValue(value)] || "No status set";
}

function normalizePlannerNote(note = {}) {
  if (!note || typeof note !== "object") return null;
  return {
    id: String(note.id || uid("note")),
    title: String(note.title || "Untitled page"),
    content: String(note.content || ""),
    updatedAt: note.updatedAt || new Date().toISOString(),
  };
}

let state = loadState();
let calendarCursor = startOfMonth(new Date());
let planningCalendarCursor = startOfMonth(new Date());
let selectedCalendarEventId = "";
let selectedPlanningPlanId = "";
let selectedPlanningEventId = "";
let selectedPlanningDate = "";
let modalEventId = "";
let modalBadgeSelection = new Set();
let completionMeetingId = "";
let completionBadgeSelection = new Set();
let completionBadgeCredits = new Map();
let completionBadgeKidIds = {};
let selectedMeetingBadgeIds = new Set();
let selectedMeetingBadgeCredits = new Map();
let planningBadgeSelection = new Set();
let planningBadgeCredits = new Map();
let planningActivities = [];
let itineraryReturnTab = "planning";
let chatHistory = [];
let kidBadgeMode = "progress";
let attendanceView = "roster";
let selectedAttendanceEventId = "";
let attendanceWorkflowCursor = startOfMonth(new Date());
let patrolPointsMode = "earned";
let selectedNoteId = "";
let notesSaveTimer = null;
if (!state.settings.badgeProgressResetDone) {
  state.settings.badgeProgressResetDone = true;
  saveState();
}
suppressDriveAutoPush = false;
suppressAppScriptAutoPush = false;

function loadState() {
  const saved = localStorage.getItem(STORE_KEY);
  if (!saved) return buildEmptyData();
  try {
    const parsed = JSON.parse(saved);
    return normalizeState(parsed);
  } catch {
    return buildEmptyData();
  }
}

function normalizeState(value) {
  const fallback = buildEmptyData();
  const branch = branchValue((value.settings || {}).branch || value.branch || fallback.settings.branch);
  const normalized = {
    kids: Array.isArray(value.kids) ? value.kids.map((kid) => ({
      ...kid,
      year: emberYearValue(kid.year),
      membershipYear: membershipYearValue(kid.membershipYear),
      leadership: leadershipValue(kid.leadership),
      returningStatus: returningValue(kid.returningStatus),
    })) : fallback.kids,
    badges: fallback.badges,
    meetings: Array.isArray(value.meetings) ? value.meetings : [],
    baselineCredits: Array.isArray(value.baselineCredits) ? value.baselineCredits : [],
    manualBadgeAdjustments: value.manualBadgeAdjustments && typeof value.manualBadgeAdjustments === "object" ? value.manualBadgeAdjustments : {},
    manualCriteriaSelections: value.manualCriteriaSelections && typeof value.manualCriteriaSelections === "object" ? value.manualCriteriaSelections : {},
    badgeHandouts: value.badgeHandouts && typeof value.badgeHandouts === "object" ? value.badgeHandouts : {},
    attendanceRecords: Array.isArray(value.attendanceRecords) ? value.attendanceRecords : [],
    scheduledEvents: Array.isArray(value.scheduledEvents) ? value.scheduledEvents : [],
    weeklyPlans: Array.isArray(value.weeklyPlans) ? value.weeklyPlans : [],
    notes: Array.isArray(value.notes) ? value.notes.map(normalizePlannerNote).filter(Boolean) : [],
    patrolPointSpending: Array.isArray(value.patrolPointSpending) ? value.patrolPointSpending.map(normalizePatrolSpendEntry) : [],
    cookieTracker: value.cookieTracker && typeof value.cookieTracker === "object" ? {
      rows: value.cookieTracker.rows && typeof value.cookieTracker.rows === "object" ? value.cookieTracker.rows : {},
      orders: Array.isArray(value.cookieTracker.orders) ? value.cookieTracker.orders.map(normalizeCookieOrder) : [],
      grocery: value.cookieTracker.grocery && typeof value.cookieTracker.grocery === "object" ? value.cookieTracker.grocery : {},
    } : fallback.cookieTracker,
    settings: {
      ...fallback.settings,
      ...(value.settings || {}),
      branch,
      driveSync: { ...fallback.settings.driveSync, ...((value.settings || {}).driveSync || {}) },
      appScriptSync: { ...fallback.settings.appScriptSync, ...((value.settings || {}).appScriptSync || {}) },
    },
    createdAt: value.createdAt || new Date().toISOString(),
  };
  return remapToOfficialBadges(normalized, Array.isArray(value.badges) ? value.badges : []);
}

function trackerPayloadObject() {
  const settings = {
    ...(state.settings || {}),
    appScriptSync: {
      ...((state.settings || {}).appScriptSync || {}),
      adminPin: "",
      adminMode: false,
    },
  };
  return {
    ...state,
    settings,
    app: TRACKER_APP_ID,
    schemaVersion: TRACKER_SCHEMA_VERSION,
    syncedAt: new Date().toISOString(),
  };
}

function blankTrackerPayloadObject(sync = appScriptSyncSettings()) {
  const branch = branchValue(state.settings?.branch);
  const blank = buildEmptyData(branch);
  return {
    ...blank,
    settings: {
      ...blank.settings,
      branch,
      appScriptSync: {
        ...(blank.settings.appScriptSync || {}),
        endpoint: sync.endpoint || DEFAULT_APPS_SCRIPT_ENDPOINT,
        trackerCode: sync.trackerCode || "",
        trackerName: sync.trackerName || "",
        pin: "",
        adminPin: "",
        adminMode: false,
        autoPush: true,
      },
    },
    app: TRACKER_APP_ID,
    schemaVersion: TRACKER_SCHEMA_VERSION,
    syncedAt: new Date().toISOString(),
  };
}

function looksLikeTrackerPayload(value) {
  if (!value || typeof value !== "object") return false;
  if (value.app === TRACKER_APP_ID) return true;
  const hasCoreArrays = ["kids", "badges", "meetings"].every((key) => Array.isArray(value[key]));
  const hasTrackerSettings = value.settings && typeof value.settings === "object" && value.settings.driveSync;
  const hasTrackerCollections = Array.isArray(value.attendanceRecords) && Array.isArray(value.weeklyPlans);
  return hasCoreArrays && (hasTrackerSettings || hasTrackerCollections);
}

function remapToOfficialBadges(data, previousBadges = []) {
  const officialBadges = officialBadgesWithSavedCriteria(previousBadges, data.settings?.branch);
  const customBadges = previousBadges.filter(isCustomBadge);
  const allBadges = [...officialBadges, ...customBadges];
  const officialById = new Map(officialBadges.map((badge) => [badge.id, badge]));
  const allById = new Map(allBadges.map((badge) => [badge.id, badge]));
  const officialByName = new Map(officialBadges.map((badge) => [badge.name.trim().toLowerCase(), badge]));
  const previousById = new Map(previousBadges.map((badge) => [badge.id, badge]));
  const previousRequirementToBadge = new Map();
  previousBadges.forEach((badge) => {
    (badge.requirements || []).forEach((requirement) => previousRequirementToBadge.set(requirement.id, badge.id));
  });

  const mappedBadgeIds = (badgeIds = [], requirementIds = []) => {
    const ids = new Set();
    badgeIds.forEach((id) => {
      if (allById.has(id)) ids.add(id);
      const previous = previousById.get(id);
      const official = previous ? officialByName.get(previous.name.trim().toLowerCase()) : null;
      if (official) ids.add(official.id);
    });
    requirementIds.forEach((requirementId) => {
      const previous = previousById.get(previousRequirementToBadge.get(requirementId));
      const official = previous ? officialByName.get(previous.name.trim().toLowerCase()) : null;
      if (official) ids.add(official.id);
    });
    return [...ids];
  };

  const mappedRequirementIds = (badgeIds, previousCount = 0) =>
    badgeIds.flatMap((id) => {
      const badge = allById.get(id);
      if (!badge) return [];
      const count = previousCount || badge.requirements.length;
      return badge.requirements.slice(0, count).map((requirement) => requirement.id);
    });

  const mapEvent = (event) => {
    const badgeIds = mappedBadgeIds(event.badgeIds || [], event.requirementIds || []);
    return {
      ...event,
      badgeIds,
      requirementIds: mappedRequirementIds(badgeIds),
    };
  };

  return {
    ...data,
    badges: allBadges,
    manualBadgeAdjustments: Object.fromEntries(
      Object.entries(data.manualBadgeAdjustments || {}).filter(([key]) => allById.has(key.split("|")[1]))
    ),
    manualCriteriaSelections: Object.fromEntries(
      Object.entries(data.manualCriteriaSelections || {}).filter(([key]) => allById.has(key.split("|")[1]))
    ),
    badgeHandouts: Object.fromEntries(
      Object.entries(data.badgeHandouts || {}).filter(([key]) => allById.has(key.split("|")[1]))
    ),
    baselineCredits: (data.baselineCredits || []).map((credit) => {
      const badgeIds = mappedBadgeIds([credit.badgeId], credit.requirementIds || []);
      const badgeId = badgeIds[0];
      if (!badgeId) return null;
      return {
        ...credit,
        badgeId,
        requirementIds: mappedRequirementIds([badgeId], (credit.requirementIds || []).length),
      };
    }).filter(Boolean),
    meetings: (data.meetings || []).map(mapEvent),
    attendanceRecords: (data.attendanceRecords || []).map(mapEvent),
    scheduledEvents: (data.scheduledEvents || []).map(mapEvent),
    weeklyPlans: (data.weeklyPlans || []).map((plan) => ({
      ...plan,
      badgeIds: mappedBadgeIds(plan.badgeIds || []),
      activities: Array.isArray(plan.activities) ? plan.activities.map((activity) => String(activity || "")) : [],
    })),
    cookieTracker: data.cookieTracker || { rows: {}, grocery: {} },
  };
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  scheduleDriveAutoPush();
  scheduleAppScriptAutoPush();
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function googleAppIdFromClientId(clientId = "") {
  const match = String(clientId || "").match(/^(\d+)-/);
  return match?.[1] || DEFAULT_GOOGLE_APP_ID;
}

function driveSyncSettings() {
  state.settings = state.settings || {};
  const existingSync = state.settings.driveSync || {};
  state.settings.driveSync = {
    clientId: DEFAULT_GOOGLE_CLIENT_ID,
    apiKey: DEFAULT_GOOGLE_API_KEY,
    appId: DEFAULT_GOOGLE_APP_ID,
    folderId: "",
    folderName: DRIVE_SYNC_FOLDER_NAME,
    fileId: "",
    fileName: DRIVE_SYNC_FILE_NAME,
    autoPull: true,
    autoPush: true,
    remoteModifiedTime: "",
    lastPulledAt: "",
    lastPushedAt: "",
    webViewLink: "",
    ...existingSync,
  };
  if (!state.settings.driveSync.clientId) state.settings.driveSync.clientId = DEFAULT_GOOGLE_CLIENT_ID;
  if (!state.settings.driveSync.appId) state.settings.driveSync.appId = googleAppIdFromClientId(state.settings.driveSync.clientId);
  if (!state.settings.driveSync.folderName) state.settings.driveSync.folderName = DRIVE_SYNC_FOLDER_NAME;
  if (!state.settings.driveSync.fileName) state.settings.driveSync.fileName = DRIVE_SYNC_FILE_NAME;
  if (!driveSyncHydrated && existingSync.autoPush === false && !existingSync.autoPushUserSet) {
    state.settings.driveSync.autoPush = true;
  }
  driveSyncHydrated = true;
  return state.settings.driveSync;
}

function setDriveSyncStatus(message, stateLabel = "") {
  const status = document.querySelector("#driveSyncStatus");
  const badge = document.querySelector("#driveSyncState");
  const loginStatus = document.querySelector("#loginSyncStatus");
  if (status) status.textContent = message;
  if (loginStatus) loginStatus.textContent = message;
  if (badge) badge.textContent = stateLabel || (driveAccessToken ? "Connected" : "Not connected");
}

function appScriptSyncSettings() {
  state.settings = state.settings || {};
  state.settings.appScriptSync = {
    endpoint: DEFAULT_APPS_SCRIPT_ENDPOINT,
    trackerCode: "",
    trackerName: "",
    pin: "",
    adminPin: "",
    adminMode: false,
    autoPush: true,
    lastPulledAt: "",
    lastPushedAt: "",
    remoteUpdatedAt: "",
    ...(state.settings.appScriptSync || {}),
  };
  return state.settings.appScriptSync;
}

function setAppScriptSyncStatus(message, stateLabel = "") {
  const status = $("#appScriptSyncStatus");
  const badge = $("#appScriptSyncState");
  const loginStatus = $("#loginCodeStatus");
  if (status) status.textContent = message;
  if (loginStatus) loginStatus.textContent = message;
  if (badge) badge.textContent = stateLabel || (appScriptSyncSettings().trackerCode ? "Code linked" : "Not connected");
}

function saveAppScriptSyncSettingsFromForm(source = "data") {
  const sync = appScriptSyncSettings();
  if (source === "remembered") {
    renderAppScriptSyncSettings();
    return;
  }
  const endpointInput = source === "login" || source === "login-create" ? $("#loginCodeEndpoint") : $("#appScriptEndpoint");
  const codeInput = source === "login-create" ? $("#loginNewTrackerCode") : source === "login" ? $("#loginTrackerCode") : $("#appScriptTrackerCode");
  const pinInput = source === "login-create" ? $("#loginNewTrackerPin") : source === "login" ? $("#loginTrackerPin") : $("#appScriptPin");
  const nameInput = source === "login-create" ? $("#loginNewTrackerName") : source === "login" ? null : $("#appScriptTrackerName");
  const adminInput = $("#appScriptAdminPin");
  if (source === "login-create" && $("#loginBranch")) state.settings.branch = branchValue($("#loginBranch").value);
  if (endpointInput) sync.endpoint = endpointInput.value.trim() || DEFAULT_APPS_SCRIPT_ENDPOINT;
  if (codeInput) sync.trackerCode = codeInput.value.trim().toUpperCase();
  if (pinInput) sync.pin = pinInput.value.trim();
  if (nameInput) sync.trackerName = nameInput.value.trim();
  if (adminInput) sync.adminPin = adminInput.value.trim();
  if ($("#appScriptAutoPush")) sync.autoPush = $("#appScriptAutoPush").checked;
  suppressAppScriptAutoPush = true;
  saveState();
  suppressAppScriptAutoPush = false;
  renderAppScriptSyncSettings();
  renderUnitTrackerTitle();
}

function renderAppScriptSyncSettings() {
  const sync = appScriptSyncSettings();
  const endpoint = $("#appScriptEndpoint");
  if (endpoint) endpoint.value = sync.endpoint || "";
  const code = $("#appScriptTrackerCode");
  if (code) code.value = sync.trackerCode || "";
  const pin = $("#appScriptPin");
  if (pin) pin.value = sync.pin || "";
  const name = $("#appScriptTrackerName");
  if (name) name.value = sync.trackerName || "";
  const admin = $("#appScriptAdminPin");
  if (admin) admin.value = sync.adminPin || "";
  if ($("#appScriptAutoPush")) $("#appScriptAutoPush").checked = sync.autoPush !== false;
  if ($("#loginCodeEndpoint")) $("#loginCodeEndpoint").value = sync.endpoint || "";
  if ($("#loginTrackerCode")) $("#loginTrackerCode").value = sync.trackerCode || "";
  if ($("#loginTrackerPin")) $("#loginTrackerPin").value = sync.pin || "";
  if ($("#loginBranch")) $("#loginBranch").value = branchValue(state.settings?.branch);
  const pieces = [];
  if (sync.trackerCode) pieces.push(`Tracker code (username): ${sync.trackerCode}`);
  if (sync.adminMode) pieces.push("Admin access");
  if (sync.autoPush && sync.trackerCode) pieces.push("Auto-push on");
  if (sync.lastPulledAt) pieces.push(`Last pull: ${formatDateTime(sync.lastPulledAt)}`);
  if (sync.lastPushedAt) pieces.push(`Last push: ${formatDateTime(sync.lastPushedAt)}`);
  setAppScriptSyncStatus(pieces.join(" | ") || "Use a tracker code to sync without Google sign-in.");
}

async function appScriptRequest(action, extra = {}) {
  const sync = appScriptSyncSettings();
  const endpoint = String(extra.endpoint || sync.endpoint || DEFAULT_APPS_SCRIPT_ENDPOINT).trim();
  if (!endpoint) throw new Error("Add the Apps Script web app URL first.");
  let response;
  try {
    response = await fetch("/api/apps-script-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint,
        action,
        code: extra.code ?? sync.trackerCode,
        pin: extra.pin ?? sync.pin,
        adminPin: extra.adminPin,
        name: extra.name ?? sync.trackerName,
        payload: extra.payload,
        clientUpdatedAt: state.updatedAt || "",
      }),
    });
  } catch (error) {
    throw new Error("Could not reach the local tracker service. Close other tracker windows, reopen the app, and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `Sync request failed with status ${response.status}.`);
  return data;
}

function rememberAppScriptTracker(data, source = "data") {
  const sync = appScriptSyncSettings();
  sync.endpoint = source === "login" || source === "login-create"
    ? $("#loginCodeEndpoint")?.value.trim() || sync.endpoint || DEFAULT_APPS_SCRIPT_ENDPOINT
    : $("#appScriptEndpoint")?.value.trim() || sync.endpoint || DEFAULT_APPS_SCRIPT_ENDPOINT;
  sync.trackerCode = String(data.code || sync.trackerCode || "").trim().toUpperCase();
  sync.trackerName = String(data.name || sync.trackerName || "").trim();
  sync.remoteUpdatedAt = data.updatedAt || sync.remoteUpdatedAt || "";
  sync.adminMode = false;
  sync.autoPush = true;
}

async function createAppScriptTracker(source = "data") {
  saveAppScriptSyncSettingsFromForm(source);
  const sync = appScriptSyncSettings();
  if (!sync.pin) throw new Error("Add a tracker PIN first.");
  const data = await appScriptRequest("create", {
    name: sync.trackerName || unitTrackerDisplayName(),
    code: sync.trackerCode,
    pin: sync.pin,
    payload: blankTrackerPayloadObject(sync),
  });
  rememberAppScriptTracker(data, source);
  sync.lastPushedAt = new Date().toISOString();
  suppressAppScriptAutoPush = true;
  saveState();
  suppressAppScriptAutoPush = false;
  renderAppScriptSyncSettings();
  return data;
}

async function pullAppScriptTracker(source = "data") {
  saveAppScriptSyncSettingsFromForm(source);
  const sync = { ...appScriptSyncSettings() };
  if (!sync.trackerCode || !sync.pin) throw new Error("Add the tracker code and PIN first.");
  setAppScriptSyncStatus("Pulling latest tracker by code...", "Working");
  const data = await appScriptRequest("pull", { code: sync.trackerCode, pin: sync.pin });
  state = normalizeState(data.payload);
  state.settings.appScriptSync = {
    ...(state.settings.appScriptSync || {}),
    endpoint: sync.endpoint,
    trackerCode: data.code || sync.trackerCode,
    trackerName: data.name || sync.trackerName,
    pin: sync.pin,
    adminPin: sync.adminPin || "",
    adminMode: false,
    autoPush: true,
    lastPulledAt: new Date().toISOString(),
    remoteUpdatedAt: data.updatedAt || "",
  };
  suppressAppScriptAutoPush = true;
  saveState();
  suppressAppScriptAutoPush = false;
  renderAll();
  setAppScriptSyncStatus("Latest tracker loaded by code.", "Connected");
}

async function adminOpenAppScriptTracker(code, adminPin) {
  const priorSync = { ...appScriptSyncSettings(), adminPin };
  if (!code || !adminPin) throw new Error("Choose a tracker and enter the admin code first.");
  setAppScriptSyncStatus("Opening tracker with admin access...", "Working");
  const data = await appScriptRequest("adminpull", { code, adminPin });
  state = normalizeState(data.payload);
  state.settings.appScriptSync = {
    ...(state.settings.appScriptSync || {}),
    endpoint: priorSync.endpoint || DEFAULT_APPS_SCRIPT_ENDPOINT,
    trackerCode: data.code || code,
    trackerName: data.name || priorSync.trackerName,
    pin: "",
    adminPin,
    adminMode: true,
    autoPush: true,
    lastPulledAt: new Date().toISOString(),
    remoteUpdatedAt: data.updatedAt || "",
  };
  suppressAppScriptAutoPush = true;
  saveState();
  suppressAppScriptAutoPush = false;
  renderAll();
  setAppScriptSyncStatus("Tracker opened with admin access.", "Connected");
}

async function tryRememberedAppScriptLogin() {
  const sync = appScriptSyncSettings();
  if (!sync.endpoint || !sync.trackerCode || !sync.pin) return false;
  setAppScriptSyncStatus("Loading the remembered tracker code...", "Working");
  try {
    await pullAppScriptTracker("remembered");
    switchTab("planning");
    showToast("Latest tracker loaded by code.");
    return true;
  } catch (error) {
    setAppScriptSyncStatus(`Remembered tracker code could not load: ${error.message}`, "Needs review");
    return false;
  }
}

async function pushAppScriptTracker(options = {}) {
  const sync = appScriptSyncSettings();
  if (!sync.trackerCode || !sync.endpoint) throw new Error("Add the tracker code and Apps Script URL first.");
  if (sync.adminMode) {
    if (!sync.adminPin) throw new Error("Admin access needs the admin code.");
  } else if (!sync.pin) {
    throw new Error("Add the tracker PIN first.");
  }
  appScriptSyncInFlight = true;
  try {
    setAppScriptSyncStatus(sync.adminMode ? "Pushing tracker with admin access..." : "Pushing tracker by code...", "Working");
    const data = await appScriptRequest(sync.adminMode ? "adminpush" : "push", {
      code: sync.trackerCode,
      pin: sync.pin,
      adminPin: sync.adminPin,
      payload: trackerPayloadObject(),
    });
    sync.trackerCode = data.code || sync.trackerCode;
    sync.trackerName = data.name || sync.trackerName;
    sync.remoteUpdatedAt = data.updatedAt || sync.remoteUpdatedAt || "";
    sync.lastPushedAt = new Date().toISOString();
    suppressAppScriptAutoPush = true;
    saveState();
    suppressAppScriptAutoPush = false;
    renderAppScriptSyncSettings();
    if (!options.auto) showToast("Tracker code sync pushed.");
  } finally {
    appScriptSyncInFlight = false;
  }
}

function scheduleAppScriptAutoPush() {
  if (suppressAppScriptAutoPush || appScriptSyncInFlight) return;
  const sync = appScriptSyncSettings();
  const canPushByCode = Boolean(sync.endpoint && sync.trackerCode && sync.pin);
  const canPushByAdmin = Boolean(sync.endpoint && sync.trackerCode && sync.adminMode && sync.adminPin);
  if (sync.autoPush === false || (!canPushByCode && !canPushByAdmin)) return;
  clearTimeout(appScriptAutoPushTimer);
  appScriptAutoPushTimer = setTimeout(() => {
    pushAppScriptTracker({ auto: true }).catch((error) => setAppScriptSyncStatus(`Code sync skipped: ${error.message}`, "Needs review"));
  }, 1800);
}

function renderAppScriptTrackerList(trackers = []) {
  const list = $("#appScriptTrackerList");
  if (!list) return;
  list.innerHTML = trackers.length ? `
    <div class="drive-file-options">
      ${trackers.map((tracker) => `
        <button class="drive-file-option" data-app-script-tracker-code="${escapeAttr(tracker.code)}" type="button">
          <strong>${escapeHtml(tracker.name || "Unit tracker")}</strong>
          <span>${escapeHtml(tracker.code)} - Updated ${escapeHtml(formatDateTime(tracker.updatedAt))}</span>
          <span>Open and edit with admin access</span>
        </button>
      `).join("")}
    </div>
  ` : `<p class="muted">No tracker codes found for this admin code.</p>`;
}

async function listAppScriptTrackers() {
  saveAppScriptSyncSettingsFromForm("data");
  const adminPin = $("#appScriptAdminPin")?.value.trim() || "";
  if (!adminPin) throw new Error("Enter the admin code first.");
  const sync = appScriptSyncSettings();
  sync.adminPin = adminPin;
  setAppScriptSyncStatus("Listing all tracker codes...", "Working");
  const data = await appScriptRequest("list", { adminPin });
  renderAppScriptTrackerList(data.trackers || []);
  setAppScriptSyncStatus(`Found ${(data.trackers || []).length} tracker code${(data.trackers || []).length === 1 ? "" : "s"}.`, "Connected");
}

function unitTrackerDisplayName() {
  const appScriptSync = appScriptSyncSettings();
  const trackerCode = String(appScriptSync.trackerCode || "").trim();
  if (trackerCode) return trackerCode;
  const sync = driveSyncSettings();
  const selected = driveTrackerFiles.find((file) => file.id === sync.fileId);
  const fileName = String(selected?.name || sync.fileName || "").trim();
  if (!sync.fileId || !fileName) return "Tracker";
  const baseName = fileName
    .replace(/\.json$/i, "")
    .replace(/\bsync\b$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!baseName) return "Tracker";
  const title = baseName.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  return /\btracker\b/i.test(title) ? title : `${title} Tracker`;
}

function renderUnitTrackerTitle() {
  const title = unitTrackerDisplayName();
  const appTitle = $("#appTitle");
  const loginTitle = $("#loginAppTitle");
  if (appTitle) appTitle.textContent = title;
  if (loginTitle) loginTitle.textContent = title;
  document.title = title;
}

function showTrackerCodeLogin(options = {}) {
  closeSwitchTrackerModal();
  switchTab("login");
  const sync = appScriptSyncSettings();
  if ($("#loginCodeEndpoint")) $("#loginCodeEndpoint").value = sync.endpoint || DEFAULT_APPS_SCRIPT_ENDPOINT;
  if ($("#loginTrackerCode")) $("#loginTrackerCode").value = options.keepCurrent ? sync.trackerCode || "" : "";
  if ($("#loginTrackerPin")) $("#loginTrackerPin").value = options.keepCurrent ? sync.pin || "" : "";
  if ($("#loginNewTrackerName")) $("#loginNewTrackerName").value = "";
  if ($("#loginNewTrackerPin")) $("#loginNewTrackerPin").value = "";
  if ($("#loginNewTrackerCode")) $("#loginNewTrackerCode").value = "";
  setAppScriptSyncStatus("Enter a tracker code and PIN to open a unit tracker.");
  setTimeout(() => $("#loginTrackerCode")?.focus(), 0);
}

function rememberSelectedDriveFile(file) {
  if (!file?.id) return;
  const sync = driveSyncSettings();
  sync.fileId = file.id;
  sync.fileName = file.name || sync.fileName || DRIVE_SYNC_FILE_NAME;
  sync.remoteModifiedTime = file.modifiedTime || sync.remoteModifiedTime || "";
  sync.webViewLink = file.webViewLink || sync.webViewLink || "";
  sync.autoPush = true;
}

function clearRememberedDriveFile() {
  const sync = driveSyncSettings();
  sync.fileId = "";
  sync.fileName = DRIVE_SYNC_FILE_NAME;
  sync.remoteModifiedTime = "";
  sync.webViewLink = "";
}

function isDriveFileAccessError(error) {
  const message = String(error?.message || error || "");
  return /File not found|notFound|"code"\s*:\s*(403|404)|PERMISSION_DENIED|permission|forbidden/i.test(message);
}

function renderDriveSyncSettings() {
  const sync = driveSyncSettings();
  renderUnitTrackerTitle();
  const clientId = $("#driveClientId");
  if (clientId) clientId.value = sync.clientId || "";
  const apiKey = $("#driveApiKey");
  if (apiKey) apiKey.value = sync.apiKey || "";
  const appId = $("#driveAppId");
  if (appId) appId.value = sync.appId || googleAppIdFromClientId(sync.clientId);
  if ($("#driveFileId")) $("#driveFileId").value = sync.fileId || "";
  const fileSelect = $("#driveFileSelect");
  if (fileSelect) {
    const files = driveTrackerFiles.some((file) => file.id === sync.fileId)
      ? driveTrackerFiles
      : sync.fileId
        ? [{ id: sync.fileId, name: sync.fileName || DRIVE_SYNC_FILE_NAME, modifiedTime: sync.remoteModifiedTime || "", webViewLink: sync.webViewLink || "" }, ...driveTrackerFiles]
        : driveTrackerFiles;
    fileSelect.innerHTML = files.length
      ? files.map((file) => `<option value="${escapeAttr(file.id)}">${escapeHtml(file.name || DRIVE_SYNC_FILE_NAME)}${file.modifiedTime ? ` - ${escapeHtml(formatDateTime(file.modifiedTime))}` : ""}</option>`).join("")
      : `<option value="">No unit trackers loaded</option>`;
    fileSelect.value = sync.fileId || "";
  }
  if ($("#driveAutoPull")) $("#driveAutoPull").checked = sync.autoPull !== false;
  if ($("#driveAutoPush")) $("#driveAutoPush").checked = Boolean(sync.autoPush);
  const pieces = [];
  if (sync.folderId) pieces.push("Drive folder linked");
  if (sync.fileId) pieces.push(`Unit tracker: ${sync.fileName || DRIVE_SYNC_FILE_NAME}`);
  if (sync.autoPush && sync.fileId) pieces.push("Auto-push on");
  if (sync.lastPulledAt) pieces.push(`Last pull: ${formatDateTime(sync.lastPulledAt)}`);
  if (sync.lastPushedAt) pieces.push(`Last push: ${formatDateTime(sync.lastPushedAt)}`);
  setDriveSyncStatus(pieces.join(" | ") || "Sign in with Google to load the latest shared tracker.");
}

function saveDriveSyncSettingsFromForm(source = "data") {
  const sync = driveSyncSettings();
  const clientInput = source === "login" ? null : $("#driveClientId");
  const apiKeyInput = source === "login" ? null : $("#driveApiKey");
  const appIdInput = source === "login" ? null : $("#driveAppId");
  const fileInput = source === "login" ? null : $("#driveFileId");
  const fileSelect = source === "login" ? null : $("#driveFileSelect");
  if (clientInput) sync.clientId = clientInput.value.trim();
  if (apiKeyInput) sync.apiKey = apiKeyInput.value.trim();
  if (appIdInput) sync.appId = appIdInput.value.trim() || googleAppIdFromClientId(sync.clientId);
  if (fileInput?.value.trim()) sync.fileId = fileInput.value.trim();
  if (fileSelect && fileSelect.value) {
    sync.fileId = fileSelect.value;
    const selected = driveTrackerFiles.find((file) => file.id === fileSelect.value);
    if (selected) {
      sync.fileName = selected.name || sync.fileName || DRIVE_SYNC_FILE_NAME;
      sync.remoteModifiedTime = selected.modifiedTime || sync.remoteModifiedTime || "";
      sync.webViewLink = selected.webViewLink || sync.webViewLink || "";
    }
  }
  if ($("#driveAutoPull")) sync.autoPull = $("#driveAutoPull").checked;
  if ($("#driveAutoPush")) {
    sync.autoPush = $("#driveAutoPush").checked;
    sync.autoPushUserSet = true;
  }
  suppressDriveAutoPush = true;
  saveState();
  suppressDriveAutoPush = false;
  renderDriveSyncSettings();
}

function waitForGoogleIdentity() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (window.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve();
      } else if (attempts > 80) {
        clearInterval(timer);
        reject(new Error("Google Identity Services did not load."));
      }
    }, 100);
  });
}

function waitForGooglePicker() {
  return new Promise((resolve, reject) => {
    const loadPicker = () => {
      if (!window.gapi?.load) return false;
      window.gapi.load("picker", {
        callback: () => {
          googlePickerReady = true;
          resolve();
        },
        onerror: () => reject(new Error("Google Picker did not load.")),
        timeout: 8000,
        ontimeout: () => reject(new Error("Google Picker timed out.")),
      });
      return true;
    };
    if (window.google?.picker && googlePickerReady) {
      resolve();
      return;
    }
    if (loadPicker()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (window.google?.picker && googlePickerReady) {
        clearInterval(timer);
        resolve();
      } else if (loadPicker()) {
        clearInterval(timer);
      } else if (attempts > 80) {
        clearInterval(timer);
        reject(new Error("Google API loader did not load."));
      }
    }, 100);
  });
}

async function requestDriveAccessToken(prompt = "consent") {
  const sync = driveSyncSettings();
  if (!sync.clientId) throw new Error("Add a Google OAuth Client ID first.");
  await waitForGoogleIdentity();
  return new Promise((resolve, reject) => {
    driveTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: sync.clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        driveAccessToken = response.access_token;
        driveTokenExpiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000;
        resolve(response);
      },
    });
    driveTokenClient.requestAccessToken({ prompt });
  });
}

async function ensureDriveToken(prompt = "consent") {
  if (driveAccessToken && Date.now() < driveTokenExpiresAt) return;
  await requestDriveAccessToken(prompt);
}

async function driveFetch(url, options = {}) {
  await ensureDriveToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${driveAccessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || response.statusText);
  }
  return response;
}

async function driveFileMetadata(fileId) {
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,webViewLink,parents`);
  return response.json();
}

function driveQueryEscape(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function trackerFileNameFromInput(rawName = "") {
  const clean = String(rawName || "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  const base = clean || DRIVE_SYNC_FILE_NAME.replace(/\.json$/i, "");
  return base.toLowerCase().endsWith(".json") ? base : `${base}.json`;
}

async function findDriveSyncFolder() {
  const sync = driveSyncSettings();
  if (sync.folderId) {
    try {
      const metadata = await driveFileMetadata(sync.folderId);
      if (metadata?.id) return metadata;
    } catch {
      sync.folderId = "";
    }
  }
  const escapedName = driveQueryEscape(sync.folderName || DRIVE_SYNC_FOLDER_NAME);
  const params = new URLSearchParams({
    q: `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: "1",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
  });
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const result = await response.json();
  return (result.files || [])[0] || null;
}

async function createDriveSyncFolder() {
  const sync = driveSyncSettings();
  const response = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id,name,modifiedTime,webViewLink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: sync.folderName || DRIVE_SYNC_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  return response.json();
}

async function ensureDriveSyncFolder() {
  const sync = driveSyncSettings();
  const existing = await findDriveSyncFolder();
  const folder = existing || await createDriveSyncFolder();
  sync.folderId = folder.id;
  sync.folderName = folder.name || sync.folderName || DRIVE_SYNC_FOLDER_NAME;
  suppressDriveAutoPush = true;
  saveState();
  suppressDriveAutoPush = false;
  return folder;
}

async function findDriveSyncFiles() {
  const sync = driveSyncSettings();
  const folder = await ensureDriveSyncFolder();
  const folderQuery = { q: `'${driveQueryEscape(folder.id)}' in parents and mimeType = 'application/json' and trashed = false`, needsTrackerCheck: false };
  const legacyName = driveQueryEscape(DRIVE_SYNC_FILE_NAME);
  const legacyQuery = { q: `name = '${legacyName}' and mimeType = 'application/json' and trashed = false`, needsTrackerCheck: true };
  const queries = [folderQuery, legacyQuery];
  const seen = new Set();
  const files = [];
  for (const query of queries) {
    const params = new URLSearchParams({
      q: query.q,
      fields: "files(id,name,modifiedTime,owners(displayName,emailAddress),webViewLink,parents)",
      orderBy: "modifiedTime desc",
      pageSize: "50",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
    });
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
    const result = await response.json();
    for (const file of result.files || []) {
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      if (query.needsTrackerCheck && !(await isDriveTrackerFile(file.id))) continue;
      files.push(file);
    }
  }
  driveTrackerFiles = files.sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")));
  if (!driveTrackerFiles.some((file) => file.id === sync.fileId) && sync.fileId) {
    try {
      const linked = await driveFileMetadata(sync.fileId);
      driveTrackerFiles = [linked, ...driveTrackerFiles.filter((file) => file.id !== linked.id)];
    } catch {
      // Keep listing available files even if the remembered file is no longer accessible.
    }
  }
  renderDriveSyncSettings();
  return driveTrackerFiles;
}

async function isDriveTrackerFile(fileId) {
  try {
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
    if (!response.ok) return false;
    return looksLikeTrackerPayload(await response.json());
  } catch {
    return false;
  }
}

function pickerSetupMessage() {
  return "Add a Google Picker API key in Data > Google Drive sync to open shared trackers from Drive.";
}

async function openDriveFilePicker() {
  saveDriveSyncSettingsFromForm();
  const sync = driveSyncSettings();
  if (!sync.clientId) throw new Error("Add a Google OAuth Client ID first.");
  if (!sync.apiKey) throw new Error(pickerSetupMessage());
  await ensureDriveToken(driveAccessToken ? "" : "consent");
  await waitForGooglePicker();
  setDriveSyncStatus("Choose a unit tracker JSON file from Google Drive...", "Choose unit");
  return new Promise((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes("application/json")
      .setMode(google.picker.DocsViewMode.LIST);
    const picker = new google.picker.PickerBuilder()
      .setDeveloperKey(sync.apiKey)
      .setAppId(sync.appId || googleAppIdFromClientId(sync.clientId))
      .setOAuthToken(driveAccessToken)
      .setTitle("Choose a unit tracker")
      .addView(view)
      .setCallback(async (data) => {
        if (data.action === google.picker.Action.CANCEL) {
          setDriveSyncStatus("Tracker selection cancelled.", "Connected");
          resolve(null);
          return;
        }
        if (data.action !== google.picker.Action.PICKED) return;
        const document = data[google.picker.Response.DOCUMENTS]?.[0];
        const fileId = document?.[google.picker.Document.ID];
        if (!fileId) {
          reject(new Error("Google Picker did not return a file."));
          return;
        }
        try {
          const metadata = await driveFileMetadata(fileId);
          if (!(await isDriveTrackerFile(fileId))) {
            throw new Error("That file is not an Embers Tracker JSON file.");
          }
          const pickedFile = {
            id: metadata.id || fileId,
            name: metadata.name || document[google.picker.Document.NAME] || DRIVE_SYNC_FILE_NAME,
            modifiedTime: metadata.modifiedTime || "",
            webViewLink: metadata.webViewLink || document[google.picker.Document.URL] || "",
            parents: metadata.parents || [],
          };
          driveTrackerFiles = [pickedFile, ...driveTrackerFiles.filter((file) => file.id !== pickedFile.id)];
          resolve(pickedFile);
        } catch (error) {
          reject(error);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

function renderLoginDriveChooser(files = []) {
  const chooser = $("#loginDriveChooser");
  if (!chooser) return;
  chooser.innerHTML = `
    <div class="drive-file-list">
      <h3>${files.length ? "Choose a unit tracker" : "Create a unit tracker"}</h3>
      ${files.length ? `
        <div class="drive-file-options">
          ${files.map((file) => `
            <button class="drive-file-option" data-login-drive-file="${escapeAttr(file.id)}" type="button">
              <strong>${escapeHtml(file.name || DRIVE_SYNC_FILE_NAME)}</strong>
              <span>${escapeHtml(file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || "Shared Drive")} - Updated ${escapeHtml(formatDateTime(file.modifiedTime))}</span>
            </button>
          `).join("")}
        </div>
      ` : `<p class="muted">No unit tracker JSON files were found in the ${escapeHtml(DRIVE_SYNC_FOLDER_NAME)} folder.</p>`}
      <div class="drive-create-inline">
        <input id="loginDriveNewFileName" class="compact-input" type="text" placeholder="New unit name, e.g. Tuesday Embers" />
        <button class="quiet-button" id="loginDriveCreate" type="button">Create named tracker</button>
        <button class="quiet-button" id="loginDrivePicker" type="button">Open tracker from Drive</button>
      </div>
    </div>
  `;
}

function renderSwitchTrackerList(files = driveTrackerFiles) {
  const list = $("#switchTrackerList");
  if (!list) return;
  const sync = driveSyncSettings();
  list.innerHTML = `
    ${files.length ? `
      <div class="drive-file-options">
        ${files.map((file) => `
          <button class="drive-file-option ${file.id === sync.fileId ? "is-current" : ""}" data-switch-drive-file="${escapeAttr(file.id)}" type="button">
            <strong>${escapeHtml(file.name || DRIVE_SYNC_FILE_NAME)}</strong>
            <span>${file.id === sync.fileId ? "Current unit tracker" : "Load this unit tracker"} - Updated ${escapeHtml(formatDateTime(file.modifiedTime))}</span>
          </button>
        `).join("")}
      </div>
    ` : `<p class="muted">No unit trackers were found. Create one or open a shared tracker from Drive.</p>`}
    <div class="drive-create-inline">
      <button class="quiet-button" id="switchTrackerPicker" type="button">Open tracker from Drive</button>
    </div>
  `;
}

async function openSwitchTrackerModal() {
  const modal = $("#switchTrackerModal");
  if (!modal) return;
  modal.hidden = false;
  $("#switchTrackerList").innerHTML = `<p class="muted">Looking for unit trackers...</p>`;
  await ensureDriveToken(driveAccessToken ? "" : "consent");
  const files = await findDriveSyncFiles();
  renderSwitchTrackerList(files);
}

function closeSwitchTrackerModal() {
  const modal = $("#switchTrackerModal");
  if (modal) modal.hidden = true;
}

async function loadDriveFileById(fileId) {
  const selected = driveTrackerFiles.find((file) => file.id === fileId);
  rememberSelectedDriveFile(selected || { id: fileId });
  suppressDriveAutoPush = true;
  saveState();
  suppressDriveAutoPush = false;
  await pullDriveSyncFile();
  rememberSelectedDriveFile(selected || { id: fileId });
  suppressDriveAutoPush = true;
  saveState();
  suppressDriveAutoPush = false;
  renderDriveSyncSettings();
  switchTab("planning");
  showToast("Latest tracker loaded from Google Drive.");
}

async function signInAndFindDriveFile() {
  saveDriveSyncSettingsFromForm("login");
  const sync = driveSyncSettings();
  if (!sync.clientId) {
    setDriveSyncStatus("Google sign-in is not configured yet. Add the OAuth Client ID in Data > Google Drive sync.", "Needs setup");
    return;
  }
  $("#loginDriveChooser").innerHTML = "";
  setDriveSyncStatus("Signing in with Google...", "Working");
  await requestDriveAccessToken("consent");
  if (sync.fileId) {
    setDriveSyncStatus("Loading the remembered unit tracker...", "Working");
    try {
      await pullDriveSyncFile();
      switchTab("planning");
      showToast("Latest tracker loaded from Google Drive.");
      return;
    } catch (error) {
      if (!isDriveFileAccessError(error)) throw error;
      clearRememberedDriveFile();
      suppressDriveAutoPush = true;
      saveState();
      suppressDriveAutoPush = false;
      renderDriveSyncSettings();
      $("#loginDriveChooser").innerHTML = "";
      setDriveSyncStatus("That Google account does not have access to the remembered tracker. Choose a shared tracker or create a new one.", "Choose unit");
    }
  }
  setDriveSyncStatus(`Looking for unit trackers created by this app...`, "Working");
  const files = await findDriveSyncFiles();
  renderLoginDriveChooser(files);
  setDriveSyncStatus(files.length ? "Choose the unit tracker to load, or open one from Drive." : "Create a tracker, or open a shared tracker from Drive.", files.length ? "Choose unit" : "No unit found");
}

async function tryRememberedGoogleLogin() {
  const sync = driveSyncSettings();
  if (!sync.clientId || !sync.fileId) return;
  setDriveSyncStatus("Checking Google Drive for the latest tracker...", "Working");
  try {
    await requestDriveAccessToken("");
    await pullDriveSyncFile();
    switchTab("planning");
    showToast("Latest tracker loaded from Google Drive.");
  } catch (error) {
    if (isDriveFileAccessError(error)) {
      clearRememberedDriveFile();
      suppressDriveAutoPush = true;
      saveState();
      suppressDriveAutoPush = false;
      renderDriveSyncSettings();
    }
    setDriveSyncStatus("Sign in with Google to load the latest shared tracker.");
  }
}

function driveSyncPayload() {
  return JSON.stringify(trackerPayloadObject(), null, 2);
}

async function createDriveSyncFile(fileName = "") {
  saveDriveSyncSettingsFromForm();
  await ensureDriveToken();
  const folder = await ensureDriveSyncFolder();
  const finalName = trackerFileNameFromInput(fileName || $("#driveNewFileName")?.value || $("#loginDriveNewFileName")?.value || driveSyncSettings().fileName || DRIVE_SYNC_FILE_NAME);
  const boundary = `ember_tracker_${Date.now().toString(36)}`;
  const metadata = {
    name: finalName,
    mimeType: "application/json",
    parents: [folder.id],
  };
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    driveSyncPayload(),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  setDriveSyncStatus(`Creating ${finalName} in Google Drive...`, "Working");
  const response = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,webViewLink", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const metadataResult = await response.json();
  const sync = driveSyncSettings();
  rememberSelectedDriveFile({ ...metadataResult, name: metadataResult.name || finalName });
  sync.folderId = folder.id;
  sync.folderName = folder.name || sync.folderName || DRIVE_SYNC_FOLDER_NAME;
  sync.lastPushedAt = new Date().toISOString();
  suppressDriveAutoPush = true;
  saveState();
  suppressDriveAutoPush = false;
  await findDriveSyncFiles().catch(() => {});
  renderDriveSyncSettings();
  return metadataResult;
}

async function pullDriveSyncFile() {
  saveDriveSyncSettingsFromForm();
  const sync = driveSyncSettings();
  if (!sync.fileId) throw new Error("Add or create a Google Drive sync file first.");
  setDriveSyncStatus("Pulling latest data from Google Drive...", "Working");
  const metadata = await driveFileMetadata(sync.fileId);
  const selected = driveTrackerFiles.find((file) => file.id === sync.fileId);
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sync.fileId)}?alt=media`);
  const remote = await response.json();
  const localSync = { ...driveSyncSettings() };
  state = normalizeState(remote);
  state.settings.driveSync = {
    ...(state.settings.driveSync || {}),
    ...localSync,
    fileId: localSync.fileId || metadata.id,
    fileName: selected?.name || metadata.name || localSync.fileName || DRIVE_SYNC_FILE_NAME,
    folderId: localSync.folderId || metadata.parents?.[0] || "",
    remoteModifiedTime: selected?.modifiedTime || metadata.modifiedTime || "",
    lastPulledAt: new Date().toISOString(),
    webViewLink: selected?.webViewLink || metadata.webViewLink || localSync.webViewLink || "",
    autoPush: true,
  };
  suppressDriveAutoPush = true;
  saveState();
  suppressDriveAutoPush = false;
  renderAll();
  setDriveSyncStatus("Latest Google Drive data loaded.", "Connected");
}

async function pushDriveSyncFile(options = {}) {
  saveDriveSyncSettingsFromForm();
  const sync = driveSyncSettings();
  if (!sync.fileId) throw new Error("Add or create a Google Drive sync file first.");
  driveSyncInFlight = true;
  try {
    setDriveSyncStatus("Checking Google Drive before upload...", "Working");
    const metadata = await driveFileMetadata(sync.fileId);
    const selected = driveTrackerFiles.find((file) => file.id === sync.fileId);
    const remoteChanged = sync.remoteModifiedTime && metadata.modifiedTime && metadata.modifiedTime > sync.remoteModifiedTime;
    if (remoteChanged && options.auto) {
      setDriveSyncStatus("Google Drive has newer data. Pull latest or manually push to overwrite.", "Needs review");
      return;
    }
    if (remoteChanged && !window.confirm("Google Drive has newer data than this browser last pulled. Overwrite it with this browser's data?")) {
      setDriveSyncStatus("Push cancelled. Pull latest before continuing.", "Needs review");
      return;
    }
    setDriveSyncStatus("Uploading latest backup to Google Drive...", "Working");
    const response = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(sync.fileId)}?uploadType=media&fields=id,name,modifiedTime,webViewLink`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: driveSyncPayload(),
    });
    const updated = await response.json();
    rememberSelectedDriveFile({
      id: updated.id || metadata.id || sync.fileId,
      name: selected?.name || updated.name || metadata.name || sync.fileName || DRIVE_SYNC_FILE_NAME,
      modifiedTime: updated.modifiedTime || metadata.modifiedTime || "",
      webViewLink: updated.webViewLink || metadata.webViewLink || sync.webViewLink || "",
    });
    sync.lastPushedAt = new Date().toISOString();
    suppressDriveAutoPush = true;
    saveState();
    suppressDriveAutoPush = false;
    renderDriveSyncSettings();
    setDriveSyncStatus("Backup pushed to Google Drive.", "Connected");
  } finally {
    driveSyncInFlight = false;
  }
}

function scheduleDriveAutoPush() {
  if (suppressDriveAutoPush || driveSyncInFlight) return;
  const sync = driveSyncSettings();
  if (!sync.autoPush || !sync.fileId || !driveAccessToken || Date.now() >= driveTokenExpiresAt) return;
  clearTimeout(driveAutoPushTimer);
  driveAutoPushTimer = setTimeout(() => {
    pushDriveSyncFile({ auto: true }).catch((error) => setDriveSyncStatus(`Auto-push skipped: ${error.message}`, "Needs review"));
  }, 1800);
}

async function shareDriveSyncFile() {
  saveDriveSyncSettingsFromForm();
  const sync = driveSyncSettings();
  if (!sync.fileId) throw new Error("Create or load a sync file first.");
  const metadata = await driveFileMetadata(sync.fileId);
  sync.webViewLink = metadata.webViewLink || sync.webViewLink || "";
  suppressDriveAutoPush = true;
  saveState();
  suppressDriveAutoPush = false;
  const shareUrl = `https://drive.google.com/file/d/${encodeURIComponent(sync.fileId)}/view`;
  await navigator.clipboard?.writeText(sync.webViewLink || shareUrl).catch(() => {});
  window.open(sync.webViewLink || shareUrl, "_blank", "noopener,noreferrer");
  setDriveSyncStatus("Tracker link opened in Google Drive. Use Share there to add other leaders; the link was copied if your browser allows it.", "Connected");
}

function compareKidsByYear(a, b) {
  const yearA = Number(emberYearValue(a.year)) || 99;
  const yearB = Number(emberYearValue(b.year)) || 99;
  return yearA - yearB || a.name.localeCompare(b.name);
}

function compareKidsByRosterHierarchy(a, b) {
  const returnOrder = ROSTER_STATUS_ORDER;
  const aReturn = returnOrder[returningValue(a.returningStatus)] ?? returnOrder[""];
  const bReturn = returnOrder[returningValue(b.returningStatus)] ?? returnOrder[""];
  if (aReturn !== bReturn) return aReturn - bReturn;
  return compareKidsByYear(a, b);
}

function compareKidsForRoster(a, b) {
  const yearCompare = compareKidsByYear(a, b);
  const yearA = emberYearValue(a.year);
  const yearB = emberYearValue(b.year);
  if (yearA !== yearB) return yearCompare;
  const aReturn = ROSTER_STATUS_ORDER[returningValue(a.returningStatus)] ?? ROSTER_STATUS_ORDER[""];
  const bReturn = ROSTER_STATUS_ORDER[returningValue(b.returningStatus)] ?? ROSTER_STATUS_ORDER[""];
  return aReturn - bReturn || a.name.localeCompare(b.name);
}

function sortedKids() {
  return [...state.kids].sort(compareKidsByRosterHierarchy);
}

function compareKidsForBadges(a, b) {
  return compareKidsByRosterHierarchy(a, b);
}

function patrolOptions(current = "") {
  return [...new Set(["Dryads", "Lares", "Elves", "Leprechauns", "Fairies", "Nymphs", "Gnomes", "Pixies", "Kelpies", "Sprites", ...state.kids.map((kid) => kid.patrol).filter(Boolean), current].filter((patrol) => patrol && patrol !== OTHER_PATROL_VALUE))]
    .sort((a, b) => a.localeCompare(b));
}

function patrolSelectOptions(current = "", emptyLabel = "Choose patrol") {
  const options = patrolOptions(current);
  const currentIsKnown = !current || options.includes(current);
  return `
    <option value="" ${current ? "" : "selected"}>${escapeHtml(emptyLabel)}</option>
    ${options.map((patrol) => `<option value="${escapeAttr(patrol)}" ${currentIsKnown && current === patrol ? "selected" : ""}>${escapeHtml(patrol)}</option>`).join("")}
    <option value="${OTHER_PATROL_VALUE}" ${current && !currentIsKnown ? "selected" : ""}>Other</option>
  `;
}

function setOtherPatrolInput(select, input, current = "") {
  if (!select || !input) return;
  const isOther = select.value === OTHER_PATROL_VALUE;
  input.classList.toggle("hidden", !isOther);
  input.hidden = !isOther;
  input.value = isOther ? current : "";
}

function selectedPatrolFromForm() {
  const select = $("#kidPatrol");
  const other = $("#kidPatrolOther");
  return select?.value === OTHER_PATROL_VALUE ? (other?.value || "").trim() : (select?.value || "").trim();
}

function renderRosterFormOptions() {
  const patrolSelect = $("#kidPatrol");
  if (patrolSelect) {
    const current = patrolSelect.value === OTHER_PATROL_VALUE ? "" : patrolSelect.value;
    patrolSelect.innerHTML = patrolSelectOptions(current);
    setOtherPatrolInput(patrolSelect, $("#kidPatrolOther"));
  }
}

function setDefaultMeetingDate() {
  $("#meetingDate").value = today();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function switchTab(tabId) {
  document.body.classList.toggle("itinerary-mode", tabId === "itinerary");
  document.body.classList.toggle("login-mode", tabId === "login");
  $$("[data-tab-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tabTarget === tabId);
  });
  $$(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === tabId);
  });
  if (tabId === "kid-badges") renderKidBadgeModeControls();
  if (tabId === "attendance") setAttendanceView(attendanceView);
  if (tabId === "patrol-points") renderPatrolPointsMode();
  if (tabId === "log") {
    renderAttendanceWorkflowCalendar();
    queueMeetingBadgePanelSync();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function allRequirementMap() {
  const map = new Map();
  state.badges.forEach((badge) => {
    badge.requirements.forEach((requirement) => {
      map.set(requirement.id, { badge, requirement });
    });
  });
  return map;
}

const CATEGORY_THEMES = {
  "Program Area Badges": { fill: "#d9edf4", accent: "#005f93" },
  "Program Badges": { fill: "#dfeaf0", accent: "#657986" },
  "Guide Together": { fill: "#d8eff7", accent: "#0879a6" },
  "Connect and Question": { fill: "#f3dfec", accent: "#8a3f88" },
  "Take Action": { fill: "#ffe5ba", accent: "#c76522" },
  "Be Well": { fill: "#b9e2db", accent: "#bf5c32" },
  "Custom Badges": { fill: "#edf0f7", accent: "#56627a" },
  "Explore Identities": { fill: "#eadcf6", accent: "#6a3d95" },
  "Build Skills": { fill: "#d7e9c1", accent: "#4f8732" },
  "Experiment and Create": { fill: "#ffdf9f", accent: "#c15d2d" },
  "Into the Outdoors": { fill: "#c7e8cb", accent: "#2f7b4f" },
  "Camp Awards": { fill: "#e2f0dc", accent: "#3c7a39" },
  "Insignia & Awards": { fill: "#edf0f7", accent: "#56627a" },
  "Discovery Badges": { fill: "#d6eef7", accent: "#116293" },
};

const CATEGORY_ORDER = [
  "Be Well",
  "Build Skills",
  "Connect and Question",
  "Experiment and Create",
  "Explore Identities",
  "Guide Together",
  "Into the Outdoors",
  "Take Action",
  "Camp Awards",
  "Insignia & Awards",
  "Discovery Badges",
];

const OFFICIAL_BADGE_IMAGES = {
  "adventurer": "./assets/badges/adventurer.jpg",
  "animal-helper": "./assets/badges/animal-helper.jpg",
  "art-studio": "./assets/badges/art-studio.jpg",
  "artist": "./assets/badges/artist.jpg",
  "be-well": "./assets/badges/be-well.jpg",
  "being-you": "./assets/badges/being-you.jpg",
  "build-skills": "./assets/badges/build-skills.jpg",
  "camper": "./assets/badges/camper.jpg",
  "camping-skills-and-adventures": "./assets/badges/camping-skills-and-adventures.jpg",
  "canadian-connections": "./assets/badges/canadian-connections.jpg",
  "change-champion": "./assets/badges/change-champion-a.jpg",
  "change-champion-a": "./assets/badges/change-champion-a.jpg",
  "change-champion-b": "./assets/badges/change-champion-b.jpg",
  "connect-and-question": "./assets/badges/connect-and-question.jpg",
  "design-space": "./assets/badges/design-space.jpg",
  "different-together": "./assets/badges/different-together.jpg",
  "experiment-and-create": "./assets/badges/experiment-and-create.jpg",
  "experimenter": "./assets/badges/experimenter.jpg",
  "explore-identities": "./assets/badges/explore-identities.jpg",
  "foodie": "./assets/badges/foodie.jpg",
  "gender-power": "./assets/badges/gender-power.jpg",
  "global-guiding": "./assets/badges/global-guiding.jpg",
  "guide-together": "./assets/badges/guide-together.jpg",
  "how-to": "./assets/badges/how-to.jpg",
  "into-the-outdoors": "./assets/badges/into-the-outdoors.jpg",
  "inventor": "./assets/badges/inventor.jpg",
  "leader": "./assets/badges/leader.jpg",
  "life-stuff": "./assets/badges/life-stuff.jpg",
  "local-communities": "./assets/badges/local-communities.jpg",
  "maker": "./assets/badges/maker.jpg",
  "mindful-mover": "./assets/badges/mindful-mover.jpg",
  "money-sense": "./assets/badges/money-sense.jpg",
  "my-healthy-relationships": "./assets/badges/my-healthy-relationships.jpg",
  "my-mighty-mind": "./assets/badges/my-mighty-mind.jpg",
  "my-physical-self": "./assets/badges/my-physical-self.jpg",
  "nature-discoveries": "./assets/badges/nature-discoveries.jpg",
  "our-shared-planet": "./assets/badges/our-shared-planet.jpg",
  "our-story": "./assets/badges/our-story.jpg",
  "planet-protector": "./assets/badges/planet-protector.jpg",
  "science-lab": "./assets/badges/science-lab.jpg",
  "spirit-of-guiding": "./assets/badges/spirit-of-guiding.jpg",
  "take-action": "./assets/badges/take-action.jpg",
  "volunteer": "./assets/badges/volunteer.jpg",
  "world-stage": "./assets/badges/world-stage.jpg",
  "your-action": "./assets/badges/your-action.jpg",
  "your-choice": "./assets/badges/your-choice.jpg",
  "your-voice": "./assets/badges/your-voice.jpg",
};

function categoryTheme(area) {
  return CATEGORY_THEMES[area] || { fill: "#d9f0f4", accent: "#075f91" };
}

function officialBadgeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function badgeImageSrc(badge) {
  if (badge.imageUrl) return badge.imageUrl;
  return OFFICIAL_BADGE_IMAGES[officialBadgeKey(badge.name)] || badgeImageSvg(badge);
}

function isProgramAreaBadge(badge) {
  return badge.area && badge.name === badge.area;
}

function badgeEarnLabel(badge) {
  const needed = Number(badge.requiredCount) || (badge.requirements || []).length || 1;
  if (isProgramAreaBadge(badge)) return `${needed} of ${(badge.requirements || []).length} badges`;
  return `${needed} ${needed === 1 ? "event" : "events"} to earn`;
}

function compareBadges(a, b) {
  if (isCustomBadge(a) !== isCustomBadge(b)) return isCustomBadge(a) ? 1 : -1;
  const aIndex = CATEGORY_ORDER.indexOf(a.area || "");
  const bIndex = CATEGORY_ORDER.indexOf(b.area || "");
  const areaSort =
    (aIndex === -1 ? CATEGORY_ORDER.length : aIndex) -
    (bIndex === -1 ? CATEGORY_ORDER.length : bIndex) ||
    String(a.area || "").localeCompare(String(b.area || ""));
  if (areaSort) return areaSort;
  const aIsProgramArea = a.name === a.area;
  const bIsProgramArea = b.name === b.area;
  if (aIsProgramArea !== bIsProgramArea) return aIsProgramArea ? 1 : -1;
  return a.name.localeCompare(b.name);
}

function badgeImageSvg(badge) {
  const theme = categoryTheme(badge.area);
  const label = badge.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="${escapeAttr(badge.name)}">
      <rect width="180" height="180" fill="white"/>
      <path d="M90 12 L160 90 L90 168 L20 90 Z" fill="${theme.accent}"/>
      <path d="M90 28 L144 90 L90 152 L36 90 Z" fill="${theme.fill}"/>
      <circle cx="74" cy="75" r="17" fill="#ffd05b"/>
      <circle cx="108" cy="76" r="17" fill="#59c2dd"/>
      <path d="M60 111 C78 91 105 91 124 111" fill="none" stroke="${theme.accent}" stroke-width="10" stroke-linecap="round"/>
      <text x="90" y="105" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="#081925">${escapeHtml(label)}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function visibleLogBadges() {
  const search = ($("#badgeTileSearch")?.value || "").trim().toLowerCase();
  return state.badges
    .filter((badge) => {
      const haystack = `${badge.name} ${badge.area || ""} ${(badge.requirements || []).map((requirement) => requirement.title).join(" ")}`.toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort(compareBadges);
}

function badgeIdsForRequirementIds(requirementIds) {
  const requirementMap = allRequirementMap();
  return [...new Set((requirementIds || []).map((id) => requirementMap.get(id)?.badge.id).filter(Boolean))];
}

function badgeIdsForMeeting(meeting) {
  if (Array.isArray(meeting.badgeIds) && meeting.badgeIds.length) return meeting.badgeIds;
  return badgeIdsForRequirementIds(meeting.requirementIds || []);
}

function meetingIsComplete(meeting = {}) {
  return !meeting.attendanceSubmittedAt || Boolean(meeting.completedAt);
}

function meetingCandidateBadgeIds(meeting = {}) {
  const ids = (meeting.pendingBadgeIds || []).length ? meeting.pendingBadgeIds : meetingIsComplete(meeting) ? badgeIdsForMeeting(meeting) : (meeting.badgeIds || []);
  const valid = new Set(state.badges.filter((badge) => !isProgramAreaBadge(badge)).map((badge) => badge.id));
  return [...new Set((ids || []).filter((id) => valid.has(id)))];
}

function meetingCandidateBadgeCredits(meeting = {}) {
  const ids = meetingCandidateBadgeIds(meeting);
  const credits = (meeting.pendingBadgeIds || []).length ? (meeting.pendingBadgeCredits || {}) : meetingIsComplete(meeting) ? (meeting.badgeCredits || {}) : (meeting.pendingBadgeCredits || meeting.badgeCredits || {});
  return badgeCreditsForIds(ids, credits);
}

function defaultBadgeKidIdsForMeeting(meeting = {}, badgeIds = meetingCandidateBadgeIds(meeting)) {
  const present = new Set(meeting.presentKidIds || []);
  const validKids = new Set(state.kids.map((kid) => kid.id));
  const hasPendingKidIds = meeting.pendingBadgeKidIds && typeof meeting.pendingBadgeKidIds === "object" && Object.keys(meeting.pendingBadgeKidIds).length > 0;
  const saved = hasPendingKidIds
    ? meeting.pendingBadgeKidIds
    : meeting.badgeKidIds && typeof meeting.badgeKidIds === "object"
      ? meeting.badgeKidIds
      : {};
  return Object.fromEntries((badgeIds || []).map((badgeId) => {
    const selected = Array.isArray(saved[badgeId]) ? saved[badgeId].filter((kidId) => validKids.has(kidId)) : [...present].filter((kidId) => validKids.has(kidId));
    return [badgeId, [...new Set(selected)]];
  }));
}

function badgeCreditMax(badge) {
  if (!badge || isProgramAreaBadge(badge)) return 1;
  return Math.max(1, Math.min(Number(badge.requiredCount) || badge.requirements.length || 1, badge.requirements.length || 1));
}

function badgeCreditValue(badge, value) {
  return Math.max(1, Math.min(Number(value) || 1, badgeCreditMax(badge)));
}

function badgeCreditsForIds(badgeIds, credits = {}) {
  const wanted = new Set(badgeIds || []);
  return Object.fromEntries(
    state.badges
      .filter((badge) => wanted.has(badge.id) && !isProgramAreaBadge(badge))
      .map((badge) => [badge.id, badgeCreditValue(badge, credits[badge.id])])
  );
}

function badgeCreditsFromSelection(selection, creditMap) {
  return badgeCreditsForIds([...selection], Object.fromEntries(creditMap || new Map()));
}

function badgeCreditCount(event, badge) {
  if (!badge || !(event.badgeIds || []).includes(badge.id)) return 0;
  return badgeCreditValue(badge, event.badgeCredits?.[badge.id] || 1);
}

function eventCreditsKidForBadge(event, kidId, badgeId) {
  const selected = event.badgeKidIds?.[badgeId];
  if (Array.isArray(selected)) return selected.includes(kidId);
  return !(event.missingKidIds || []).includes(kidId);
}

function totalBadgeCredits(badgeIds = [], badgeCredits = {}) {
  return badgeIds.reduce((sum, badgeId) => {
    const badge = state.badges.find((item) => item.id === badgeId);
    return sum + (badge ? badgeCreditValue(badge, badgeCredits[badgeId] || 1) : 0);
  }, 0);
}

function badgeCreditTag(badge, badgeCredits = {}) {
  const count = badgeCreditValue(badge, badgeCredits[badge.id] || 1);
  return `${badge.name}${count > 1 ? ` x${count}` : ""}`;
}

function calendarBadgeThemeAttrs(badges = []) {
  const themes = [];
  const seenAreas = new Set();
  badges.forEach((badge) => {
    if (!badge || isProgramAreaBadge(badge)) return;
    const area = badge.area || "Program Badges";
    if (seenAreas.has(area)) return;
    seenAreas.add(area);
    themes.push(categoryTheme(area));
  });
  if (!themes.length) return { className: "", style: "" };
  const primary = themes[0];
  const stripeStops = themes
    .map((theme, index) => {
      const start = Math.round((index / themes.length) * 100);
      const end = Math.round(((index + 1) / themes.length) * 100);
      return `${theme.accent} ${start}% ${end}%`;
    })
    .join(", ");
  return {
    className: `has-badge-theme${themes.length > 1 ? " has-mixed-badge-theme" : ""}`,
    style: `style="--event-fill: ${primary.fill}; --event-accent: ${primary.accent}; --event-stripe: linear-gradient(90deg, ${stripeStops});"`,
  };
}

function requirementIdsForBadgeCredits(badgeCredits) {
  return Object.entries(badgeCredits || {}).flatMap(([badgeId, count]) => {
    const badge = state.badges.find((item) => item.id === badgeId);
    if (!badge) return [];
    return badge.requirements.slice(0, badgeCreditValue(badge, count)).map((requirement) => requirement.id);
  });
}

function requirementIdsForBadgeIds(badgeIds) {
  const badgeIdSet = new Set(badgeIds || []);
  return state.badges
    .filter((badge) => badgeIdSet.has(badge.id))
    .flatMap((badge) => (badge.requirements || []).map((requirement) => requirement.id));
}

function creditSetForKid(kidId, throughDate = null) {
  const credits = new Set();
  (state.baselineCredits || []).forEach((credit) => {
    if (credit.kidId !== kidId) return;
    (credit.requirementIds || []).forEach((id) => credits.add(id));
  });
  const meetings = [...state.meetings].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  meetings.forEach((meeting) => {
    if (throughDate && String(meeting.date) > throughDate) return;
    if (!meeting.presentKidIds?.includes(kidId)) return;
    (meeting.requirementIds || []).forEach((id) => credits.add(id));
  });
  return credits;
}

function baselineNotesForKidBadge(kidId, badgeId) {
  return (state.baselineCredits || [])
    .filter((credit) => credit.kidId === kidId && credit.badgeId === badgeId && credit.note)
    .map((credit) => credit.note);
}

function manualAdjustmentKey(kidId, badgeId) {
  return `${kidId}|${badgeId}`;
}

function manualBadgeAdjustment(kidId, badgeId) {
  return Number((state.manualBadgeAdjustments || {})[manualAdjustmentKey(kidId, badgeId)]) || 0;
}

function isCriteriaBadge(badge = {}) {
  return badge.progressMode === "criteria";
}

function criteriaSelectionKey(kidId, badgeId) {
  return `${kidId}|${badgeId}`;
}

function baselineRequirementIdsForKidBadge(kidId, badgeId) {
  const ids = [];
  (state.baselineCredits || []).forEach((credit) => {
    if (credit.kidId !== kidId || credit.badgeId !== badgeId) return;
    (credit.requirementIds || []).forEach((id) => ids.push(id));
  });
  return ids;
}

function selectedCriteriaIds(kidId, badge) {
  const allowed = new Set((badge.requirements || []).map((requirement) => requirement.id));
  const stored = Array.isArray((state.manualCriteriaSelections || {})[criteriaSelectionKey(kidId, badge.id)])
    ? (state.manualCriteriaSelections || {})[criteriaSelectionKey(kidId, badge.id)]
    : [];
  const baseline = baselineRequirementIdsForKidBadge(kidId, badge.id);
  return [...new Set([...baseline, ...stored].filter((id) => allowed.has(id)))];
}

function setCriteriaSelection(kidId, badgeId, requirementId, checked) {
  const badge = state.badges.find((item) => item.id === badgeId);
  if (!badge) return;
  const allowed = new Set((badge.requirements || []).map((requirement) => requirement.id));
  if (!allowed.has(requirementId)) return;
  state.manualCriteriaSelections = state.manualCriteriaSelections || {};
  const key = criteriaSelectionKey(kidId, badgeId);
  const baseline = new Set(baselineRequirementIdsForKidBadge(kidId, badgeId));
  const selected = new Set(Array.isArray(state.manualCriteriaSelections[key]) ? state.manualCriteriaSelections[key] : []);
  if (checked) selected.add(requirementId);
  else selected.delete(requirementId);
  baseline.forEach((id) => selected.delete(id));
  const stored = [...selected].filter((id) => allowed.has(id));
  if (stored.length) state.manualCriteriaSelections[key] = stored;
  else delete state.manualCriteriaSelections[key];
}

function badgeHandoutKey(kidId, badgeId) {
  return `${kidId}|${badgeId}`;
}

function badgeHandedOut(kidId, badgeId) {
  return Boolean((state.badgeHandouts || {})[badgeHandoutKey(kidId, badgeId)]);
}

function setBadgeHandedOut(kidId, badgeId, handedOut) {
  state.badgeHandouts = state.badgeHandouts || {};
  const key = badgeHandoutKey(kidId, badgeId);
  if (handedOut) state.badgeHandouts[key] = true;
  else delete state.badgeHandouts[key];
}

function setManualBadgeCount(kidId, badgeId, count) {
  const badge = state.badges.find((item) => item.id === badgeId);
  if (!badge) return;
  const max = isProgramAreaBadge(badge) ? badge.requirements.length : Math.min(Number(badge.requiredCount) || badge.requirements.length, badge.requirements.length);
  const target = Math.max(0, Math.min(Number(count) || 0, max));
  const delta = target - automaticBadgeCount(kidId, badge);
  const key = manualAdjustmentKey(kidId, badgeId);
  state.manualBadgeAdjustments = state.manualBadgeAdjustments || {};
  if (delta) state.manualBadgeAdjustments[key] = delta;
  else delete state.manualBadgeAdjustments[key];
}

function automaticBadgeCredits(kidId, badge, throughDate = null) {
  const baselineIds = [];
  (state.baselineCredits || []).forEach((credit) => {
    if (credit.kidId !== kidId || credit.badgeId !== badge.id) return;
    (credit.requirementIds || []).forEach((id) => baselineIds.push(id));
  });
  const baselineRequirements = badge.requirements.filter((requirement) => baselineIds.includes(requirement.id));
  const eventCredits = allAttendanceEvents({ includeScheduled: true })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .filter((event) => {
      if (throughDate && String(event.date) > throughDate) return false;
      return (event.badgeIds || []).includes(badge.id);
    })
    .filter((event) => {
      return eventCreditsKidForBadge(event, kidId, badge.id);
    })
    .flatMap((event) => {
      const count = badgeCreditCount(event, badge);
      return Array.from({ length: count }, (_, index) => ({
        id: `${badge.id}-event-${event.id}-${index + 1}`,
        title: `Event credit ${count > 1 ? index + 1 : ""}: ${event.title || formatDate(event.date) || "Untitled event"}`.replace("  ", " "),
      }));
    });
  return [...baselineRequirements, ...eventCredits];
}

function automaticBadgeCount(kidId, badge, throughDate = null) {
  if (isProgramAreaBadge(badge)) {
    const relatedNames = new Set(badge.requirements.map((requirement) => requirement.title.trim().toLowerCase()));
    return state.badges
      .filter((item) => item.area === badge.area && !isProgramAreaBadge(item) && relatedNames.has(item.name.trim().toLowerCase()))
      .filter((item) => badgeProgress(kidId, item, throughDate).earned)
      .length;
  }
  const needed = Math.min(Number(badge.requiredCount) || badge.requirements.length, badge.requirements.length);
  return Math.min(automaticBadgeCredits(kidId, badge, throughDate).length, needed);
}

function badgeProgress(kidId, badge, throughDate = null) {
  if (isProgramAreaBadge(badge)) {
    const needed = Math.min(Number(badge.requiredCount) || 2, badge.requirements.length);
    const relatedNames = new Set(badge.requirements.map((requirement) => requirement.title.trim().toLowerCase()));
    const relatedBadges = state.badges.filter((item) => item.area === badge.area && !isProgramAreaBadge(item) && relatedNames.has(item.name.trim().toLowerCase()));
    const automaticCompleted = relatedBadges
      .filter((item) => badgeProgress(kidId, item, throughDate).earned)
      .map((item) => ({ id: item.id, title: item.name }));
    const adjustedCount = Math.max(0, Math.min(automaticCompleted.length + manualBadgeAdjustment(kidId, badge.id), badge.requirements.length));
    const completed = automaticCompleted.slice(0, adjustedCount);
    while (completed.length < adjustedCount) completed.push({ id: `${badge.id}-manual-${completed.length + 1}`, title: "Manual adjustment" });
    const earned = adjustedCount >= needed && needed > 0;
    return {
      completed,
      completedCount: adjustedCount,
      needed,
      displayMax: badge.requirements.length,
      earned,
      percent: needed ? Math.min(100, Math.round((adjustedCount / needed) * 100)) : 0,
    };
  }
  const needed = Math.min(Number(badge.requiredCount) || badge.requirements.length, badge.requirements.length);
  if (isCriteriaBadge(badge)) {
    const selectedIds = new Set(selectedCriteriaIds(kidId, badge));
    const completed = badge.requirements.filter((requirement) => selectedIds.has(requirement.id));
    const completedCount = completed.length;
    const earned = completedCount >= needed && needed > 0;
    return {
      completed,
      completedCount,
      needed,
      displayMax: badge.requirements.length,
      earned,
      percent: needed ? Math.min(100, Math.round((completedCount / needed) * 100)) : 0,
    };
  }
  const automaticCompleted = automaticBadgeCredits(kidId, badge, throughDate);
  const adjustedCount = Math.max(0, Math.min(automaticCompleted.length + manualBadgeAdjustment(kidId, badge.id), needed));
  const completed = automaticCompleted.slice(0, adjustedCount);
  while (completed.length < adjustedCount) completed.push({ id: `${badge.id}-manual-${completed.length + 1}`, title: "Manual adjustment" });
  const earned = adjustedCount >= needed && needed > 0;
  return {
    completed,
    completedCount: adjustedCount,
    needed,
    displayMax: needed,
    earned,
    percent: needed ? Math.min(100, Math.round((adjustedCount / needed) * 100)) : 0,
  };
}

function earnedDate(kidId, badge) {
  const dates = [...new Set(allAttendanceEvents({ includeScheduled: true }).map((event) => event.date).filter(Boolean))].sort();
  for (const date of dates) {
    if (badgeProgress(kidId, badge, date).earned) return date;
  }
  return badgeProgress(kidId, badge).earned ? "Excel baseline" : "";
}

function attendanceRate(kidId) {
  const records = allAttendanceEvents();
  if (!records.length) return "0%";
  const present = records.filter((record) => !record.missingKidIds.includes(kidId)).length;
  return `${Math.round((present / records.length) * 100)}%`;
}

function normalizedEventTitle(value) {
  return String(value || "").trim().toLowerCase();
}

function inferredSourceEventIdForMeeting(meeting = {}) {
  if (meeting.sourceEventId) return meeting.sourceEventId;
  const title = normalizedEventTitle(meeting.title);
  if (!meeting.date || !title) return "";
  const plan = (state.weeklyPlans || []).find((item) => item.date === meeting.date && normalizedEventTitle(item.title) === title);
  if (plan) return `planned-${plan.id}`;
  const scheduled = (state.scheduledEvents || []).find((item) => item.date === meeting.date && normalizedEventTitle(item.title) === title);
  return scheduled?.id || "";
}

function allAttendanceEvents({ includeScheduled = false, includePlanned = false } = {}) {
  const imported = (state.attendanceRecords || []).map((record) => ({
    ...record,
    missingKidIds: record.missingKidIds || [],
    badgeIds: record.badgeIds || [],
    badgeCredits: badgeCreditsForIds(record.badgeIds || [], record.badgeCredits || {}),
    requirementIds: record.requirementIds || [],
  }));
  const logged = state.meetings.map((meeting) => {
    const complete = meetingIsComplete(meeting);
    const badgeIds = complete ? badgeIdsForMeeting(meeting) : [];
    return {
      id: `logged-attendance-${meeting.id}`,
      date: meeting.date,
      title: meeting.title,
      summary: meeting.notes || "",
      source: complete ? "logged" : "attendance",
      meetingId: meeting.id,
      sourceEventId: inferredSourceEventIdForMeeting(meeting),
      badgeIds,
      badgeCredits: badgeCreditsForIds(badgeIds, meeting.badgeCredits || {}),
      badgeKidIds: complete ? defaultBadgeKidIdsForMeeting(meeting, badgeIds) : {},
      requirementIds: complete ? (meeting.requirementIds || []) : [],
      missingKidIds: state.kids
        .filter((kid) => !(meeting.presentKidIds || []).includes(kid.id))
        .map((kid) => kid.id),
    };
  });
  const scheduled = includeScheduled
    ? (state.scheduledEvents || []).map((event) => ({
        ...event,
        missingKidIds: event.missingKidIds || [],
        badgeIds: event.badgeIds || [],
        badgeCredits: badgeCreditsForIds(event.badgeIds || [], event.badgeCredits || {}),
        requirementIds: event.requirementIds || [],
        source: "scheduled",
      }))
    : [];
  const planned = includePlanned
    ? (state.weeklyPlans || []).map((plan) => ({
        id: `planned-${plan.id}`,
        planId: plan.id,
        date: plan.date,
        title: plan.title,
        summary: plan.notes || "",
        source: "planned",
        missingKidIds: [],
        badgeIds: plan.badgeIds || [],
        badgeCredits: badgeCreditsForIds(plan.badgeIds || [], plan.badgeCredits || {}),
        activities: Array.isArray(plan.activities) ? plan.activities : [],
        requirementIds: [],
      }))
    : [];
  return [...imported, ...logged, ...scheduled, ...planned].sort((a, b) => {
    if (!a.date && !b.date) return a.title.localeCompare(b.title);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
}

function displayAttendanceEvents(options = {}, extraSourceIds = []) {
  const events = allAttendanceEvents(options);
  const visibleSourceIds = new Set([...events.map((event) => event.id), ...extraSourceIds].filter(Boolean));
  return events.filter((event) => !event.sourceEventId || !visibleSourceIds.has(event.sourceEventId));
}

function renderLogBadgeTiles() {
  const picker = $("#badgeTilePicker");
  if (!picker) return;
  const existingIds = new Set(state.badges.map((badge) => badge.id));
  selectedMeetingBadgeIds = new Set([...selectedMeetingBadgeIds].filter((id) => existingIds.has(id)));
  selectedMeetingBadgeCredits = new Map([...selectedMeetingBadgeCredits].filter(([id]) => selectedMeetingBadgeIds.has(id) && existingIds.has(id)));
  const groups = new Map();
  visibleLogBadges().forEach((badge) => {
    const area = badge.area || "Program Badges";
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(badge);
  });

  picker.innerHTML = [...groups.entries()].map(([area, badges]) => {
    const theme = categoryTheme(area);
    return `
      <section class="badge-category" style="--category-fill: ${theme.fill}; --category-accent: ${theme.accent};">
        <header>
          <h3>${escapeHtml(area)}</h3>
          <span class="tag">${badges.length} ${badges.length === 1 ? "badge" : "badges"}</span>
        </header>
        <div class="badge-tile-grid">
          ${badges.map((badge) => {
            const selected = selectedMeetingBadgeIds.has(badge.id);
            const summaryBadge = isProgramAreaBadge(badge);
            const creditValue = badgeCreditValue(badge, selectedMeetingBadgeCredits.get(badge.id) || 1);
            return `
              <div class="badge-tile-wrap ${selected ? "is-selected" : ""}">
                <button class="badge-tile ${selected ? "is-selected" : ""} ${summaryBadge ? "is-summary" : ""}" ${summaryBadge ? "disabled" : `data-log-badge-id="${escapeAttr(badge.id)}"`} type="button" aria-pressed="${selected}">
                  <img src="${badgeImageSrc(badge)}" alt="" />
                  <span>${escapeHtml(badge.name)}</span>
                  <small>${escapeHtml(badgeEarnLabel(badge))}</small>
                </button>
                ${selected && !summaryBadge ? `
                  <label class="credit-count-control">
                    Activities this session
                    <input data-log-badge-credit="${escapeAttr(badge.id)}" type="number" min="1" max="${badgeCreditMax(badge)}" step="1" value="${escapeAttr(creditValue)}" />
                  </label>
                ` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }).join("") || emptyState("No matching badges. Add or edit badges in the Badges tab.");
}

function collectAttendanceDraftFromGrid() {
  const statusInputs = $$("[data-attendance-kid-id]");
  const badgeIds = [...selectedMeetingBadgeIds].filter((id) => state.badges.some((badge) => badge.id === id));
  const statusByKid = {};
  const badgeKidIds = Object.fromEntries(badgeIds.map((badgeId) => [badgeId, []]));
  if (!statusInputs.length) {
    const presentKidIds = $$('input[name="presentKid"]:checked').map((input) => input.value);
    presentKidIds.forEach((kidId) => {
      statusByKid[kidId] = "present";
      badgeIds.forEach((badgeId) => badgeKidIds[badgeId].push(kidId));
    });
    return { statusByKid, badgeKidIds, presentKidIds };
  }
  statusInputs.forEach((input) => {
    const kidId = input.dataset.attendanceKidId;
    const status = ["present", "partial", "absent"].includes(input.value) ? input.value : "present";
    statusByKid[kidId] = status;
    if (status === "present") {
      badgeIds.forEach((badgeId) => badgeKidIds[badgeId].push(kidId));
    }
  });
  $$("[data-attendance-badge-kid-id][data-attendance-badge-id]:checked").forEach((input) => {
    const status = statusByKid[input.dataset.attendanceBadgeKidId];
    const badgeId = input.dataset.attendanceBadgeId;
    if (status === "partial" && badgeKidIds[badgeId]) badgeKidIds[badgeId].push(input.dataset.attendanceBadgeKidId);
  });
  Object.keys(badgeKidIds).forEach((badgeId) => {
    badgeKidIds[badgeId] = [...new Set(badgeKidIds[badgeId])];
  });
  const presentKidIds = Object.entries(statusByKid)
    .filter(([, status]) => status !== "absent")
    .map(([kidId]) => kidId);
  return { statusByKid, badgeKidIds, presentKidIds };
}

function attendanceStatusForKid(meeting, kidId, draftStatus = {}) {
  if (draftStatus[kidId]) return draftStatus[kidId];
  const saved = meeting?.attendanceStatus?.[kidId];
  if (["present", "partial", "absent"].includes(saved)) return saved;
  if (meeting) return (meeting.presentKidIds || []).includes(kidId) ? "present" : "absent";
  return "present";
}

function attendanceBadgeKidIdsForMeeting(meeting, badgeIds = []) {
  const hasPendingKidIds = meeting?.pendingBadgeKidIds && typeof meeting.pendingBadgeKidIds === "object" && Object.keys(meeting.pendingBadgeKidIds).length > 0;
  const saved = hasPendingKidIds
    ? meeting.pendingBadgeKidIds
    : meeting?.badgeKidIds && typeof meeting.badgeKidIds === "object"
      ? meeting.badgeKidIds
      : {};
  return Object.fromEntries((badgeIds || []).map((badgeId) => [badgeId, Array.isArray(saved[badgeId]) ? saved[badgeId] : null]));
}

function renderAttendanceGrid() {
  if (!state.kids.length) {
    $("#attendanceGrid").innerHTML = emptyState("No Embers entered yet.");
    return;
  }
  const draft = collectAttendanceDraftFromGrid();
  const hasDraftControls = $$("[data-attendance-kid-id]").length > 0;
  const eventId = $("#meetingEventId")?.value || "";
  const ref = eventRefById(eventId);
  const meeting = linkedMeetingForEventId(eventId) || (ref?.type === "logged" ? ref.item : null);
  const badgeIds = [...selectedMeetingBadgeIds].filter((id) => state.badges.some((badge) => badge.id === id));
  const savedBadgeKidIds = attendanceBadgeKidIdsForMeeting(meeting, badgeIds);
  const badges = badgeIds
    .map((id) => state.badges.find((badge) => badge.id === id))
    .filter(Boolean)
    .sort(compareBadges);
  $("#attendanceGrid").innerHTML = sortedKids().map((kid) => {
    const status = attendanceStatusForKid(meeting, kid.id, draft.statusByKid);
    return `
    <article class="attendance-entry-row ${status === "partial" ? "is-partial" : status === "absent" ? "is-absent" : "is-present"}">
      <div class="attendance-entry-main">
        <div>
          <strong>${escapeHtml(kid.name)}</strong>
          <small class="muted">${escapeHtml(emberYearLabel(kid.year))}${kid.patrol ? `, ${escapeHtml(kid.patrol)}` : ""}</small>
        </div>
        <label>
          Attendance
          <select data-attendance-kid-id="${escapeAttr(kid.id)}" aria-label="${escapeAttr(`${kid.name} attendance`)}">
            <option value="present" ${status === "present" ? "selected" : ""}>Full meeting</option>
            <option value="partial" ${status === "partial" ? "selected" : ""}>Partial meeting</option>
            <option value="absent" ${status === "absent" ? "selected" : ""}>Absent</option>
          </select>
        </label>
      </div>
      <div class="attendance-badge-credit-list">
        ${badges.length ? badges.map((badge) => {
          const draftSelected = draft.badgeKidIds[badge.id]?.includes(kid.id);
          const savedIds = savedBadgeKidIds[badge.id];
          const savedSelected = Array.isArray(savedIds) ? savedIds.includes(kid.id) : (!hasDraftControls && status !== "absent");
          const checked = status === "present" ? true : status === "partial" ? (draftSelected || savedSelected) : false;
          return `
            <label class="attendance-badge-credit ${status === "partial" ? "" : "is-locked"}">
              <input
                type="checkbox"
                data-attendance-badge-kid-id="${escapeAttr(kid.id)}"
                data-attendance-badge-id="${escapeAttr(badge.id)}"
                ${checked ? "checked" : ""}
                ${status === "partial" ? "" : "disabled"}
                aria-label="${escapeAttr(`${kid.name} earned ${badge.name}`)}"
              />
              <img src="${badgeImageSrc(badge)}" alt="" />
              <span>${escapeHtml(badge.name)}</span>
            </label>
          `;
        }).join("") : `<span class="small-note">Select badge goals above if partial attendance should receive specific badge credit.</span>`}
      </div>
    </article>
  `;
  }).join("") || emptyState("Add Embers before submitting attendance.");
}

function attendanceWorkflowEvents() {
  return displayAttendanceEvents({ includeScheduled: true, includePlanned: true })
    .filter((event) => event.date)
    .sort((a, b) => {
      const todayIso = today();
      const aFuture = String(a.date) >= todayIso ? 0 : 1;
      const bFuture = String(b.date) >= todayIso ? 0 : 1;
      return aFuture - bFuture || String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title));
    });
}

function linkedMeetingForEventId(eventId) {
  if (!eventId) return null;
  return state.meetings.find((meeting) => inferredSourceEventIdForMeeting(meeting) === eventId) || null;
}

function attendanceMeetingForEvent(event) {
  if (!event) return null;
  const ref = eventRefById(event.id);
  if (ref?.type === "logged") return ref.item;
  return linkedMeetingForEventId(event.id);
}

function attendanceEventStatusLines(event) {
  const meeting = attendanceMeetingForEvent(event);
  return {
    attendance: meeting?.attendanceSubmittedAt ? "Attendance submitted" : "Attendance not submitted",
    badges: meeting && meetingIsComplete(meeting) ? "Badges confirmed" : "Badges not confirmed",
  };
}

function renderAttendanceWorkflowCalendar() {
  const wrap = $("#attendanceWorkflowCalendar");
  if (!wrap) return;
  const events = attendanceWorkflowEvents();
  if (!events.some((event) => event.id === selectedAttendanceEventId)) {
    selectedAttendanceEventId = "";
  }
  const badgeById = new Map(state.badges.map((badge) => [badge.id, badge]));
  const monthStart = startOfMonth(attendanceWorkflowCursor);
  const start = new Date(monthStart);
  start.setDate(start.getDate() - start.getDay());
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const end = new Date(monthEnd);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const days = [];
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    days.push(new Date(date));
  }
  $("#attendanceWorkflowMonthLabel").textContent = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const eventsByDate = new Map();
  events.forEach((event) => {
    if (!eventsByDate.has(event.date)) eventsByDate.set(event.date, []);
    eventsByDate.get(event.date).push(event);
  });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((day) => `<div class="calendar-weekday">${day}</div>`)
    .join("");
  const cells = days.map((date) => {
    const iso = toIsoDate(date);
    const dayEvents = (eventsByDate.get(iso) || []).sort((a, b) => String(a.title).localeCompare(String(b.title)));
    const isMuted = date.getMonth() !== monthStart.getMonth();
    return `
      <article class="calendar-day ${isMuted ? "is-muted" : ""}">
        <div class="calendar-day-number">${date.getDate()}</div>
        ${dayEvents.map((event) => {
          const ref = eventRefById(event.id);
          const linkedMeeting = attendanceMeetingForEvent(event);
          const displayBadgeIds = linkedMeeting ? meetingCandidateBadgeIds(linkedMeeting) : ref?.type === "logged" && !meetingIsComplete(ref.item) ? meetingCandidateBadgeIds(ref.item) : (event.badgeIds || []);
          const badges = displayBadgeIds.map((id) => badgeById.get(id)).filter(Boolean);
          const themeAttrs = calendarBadgeThemeAttrs(badges);
          const status = attendanceEventStatusLines(event);
          return `
            <button class="calendar-event attendance-calendar-event ${event.id === selectedAttendanceEventId ? "is-selected" : ""} ${event.source === "planned" ? "is-planned" : event.source === "scheduled" ? "is-scheduled" : event.source === "logged" ? "is-logged" : ""} ${themeAttrs.className}" ${themeAttrs.style} data-attendance-event="${escapeAttr(event.id)}" type="button">
              ${escapeHtml(event.title || "Untitled event")}
              <span>${escapeHtml(status.attendance)}</span>
              <span>${escapeHtml(status.badges)}</span>
            </button>
          `;
        }).join("")}
      </article>
    `;
  }).join("");
  wrap.innerHTML = events.length ? weekdays + cells : emptyState("Add a planned or scheduled event first.");
  renderAttendanceWorkflowDetail();
}

function badgeDisplayForAttendanceEvent(event) {
  const ref = eventRefById(event?.id || "");
  const linkedMeeting = event ? attendanceMeetingForEvent(event) : null;
  const badgeIds = linkedMeeting ? meetingCandidateBadgeIds(linkedMeeting) : ref?.type === "logged" && !meetingIsComplete(ref.item) ? meetingCandidateBadgeIds(ref.item) : (event?.badgeIds || []);
  const badgeCredits = linkedMeeting ? meetingCandidateBadgeCredits(linkedMeeting) : ref?.type === "logged" ? (event?.badgeCredits || {}) : badgeCreditsForIds(badgeIds, event?.badgeCredits || {});
  return { badgeIds, badgeCredits };
}

function renderAttendanceWorkflowDetail() {
  const detail = $("#attendanceWorkflowDetail");
  if (!detail) return;
  const event = attendanceWorkflowEvents().find((item) => item.id === selectedAttendanceEventId);
  if (!event) {
    detail.innerHTML = emptyState("Single-click an event to see actions. Double-click an event to update attendance.");
    return;
  }
  const status = attendanceEventStatusLines(event);
  const { badgeIds, badgeCredits } = badgeDisplayForAttendanceEvent(event);
  const badges = badgeIds.map((id) => state.badges.find((badge) => badge.id === id)).filter(Boolean);
  const meeting = attendanceMeetingForEvent(event);
  detail.innerHTML = `
    <article class="calendar-detail-card attendance-workflow-detail-card">
      <header>
        <div>
          <h3>${escapeHtml(event.title || "Untitled event")}</h3>
          <p class="muted">${formatDate(event.date)} - ${escapeHtml(event.source === "planned" ? "Planned meeting" : event.source === "scheduled" ? "Scheduled event" : event.source === "logged" ? "Completed meeting" : "Attendance event")}</p>
        </div>
        <div class="inline-actions">
          <button class="text-button" data-open-attendance-itinerary="${escapeAttr(event.id)}" type="button">View itinerary</button>
          <button class="primary-button" data-open-attendance-entry="${escapeAttr(event.id)}" type="button">${meeting?.attendanceSubmittedAt ? "Update attendance" : "Submit attendance"}</button>
          <button class="quiet-button" data-open-attendance-badges="${escapeAttr(event.id)}" type="button">Submit for badges</button>
          ${event.source === "logged" && meeting ? `<button class="text-button" data-remove-meeting="${escapeAttr(meeting.id)}" type="button">Delete</button>` : ""}
        </div>
      </header>
      <div class="tag-row">
        <span class="tag ${status.attendance.includes("not") ? "warning" : "earned"}">${escapeHtml(status.attendance)}</span>
        <span class="tag ${status.badges.includes("not") ? "warning" : "earned"}">${escapeHtml(status.badges)}</span>
        ${badges.map((badge) => `<span class="tag">${escapeHtml(badgeCreditTag(badge, badgeCredits))}</span>`).join("") || `<span class="tag warning">No badge goals selected</span>`}
      </div>
    </article>
  `;
}

function setPresentKidsFromIds(presentKidIds = []) {
  const present = new Set(presentKidIds);
  const statusControls = $$("[data-attendance-kid-id]");
  if (statusControls.length) {
    statusControls.forEach((input) => {
      input.value = present.has(input.dataset.attendanceKidId) ? "present" : "absent";
    });
    renderAttendanceGrid();
    return;
  }
  $$('input[name="presentKid"]').forEach((input) => {
    input.checked = present.has(input.value);
  });
}

function setPatrolPointInputsFromMeeting(meeting = {}) {
  const points = meeting.emberPoints || {};
  $$("#patrolPointInputs input[data-patrol-kid-id]").forEach((input) => {
    input.value = Number(points[input.dataset.patrolKidId]) || 0;
  });
  renderPatrolPointTotals();
}

function applyAttendanceEventToForm(eventId) {
  const event = eventSnapshot(eventId);
  const ref = eventRefById(eventId);
  const linkedMeeting = linkedMeetingForEventId(eventId);
  $("#meetingEventId").value = eventId || "";
  if (!event) {
    $("#meetingDate").value = today();
    $("#meetingTitle").value = "";
    $("#meetingNotes").value = "";
    selectedMeetingBadgeIds = new Set();
    selectedMeetingBadgeCredits = new Map();
    renderLogBadgeTiles();
    renderAttendanceGrid();
    renderPatrolPoints();
    $("#meetingSubmitButton").textContent = "Submit attendance";
    return;
  }
  $("#meetingDate").value = event.date || today();
  $("#meetingTitle").value = event.title || "";
  $("#meetingNotes").value = event.summary || "";
  if (linkedMeeting || ref?.type === "logged") {
    const meeting = linkedMeeting || ref.item;
    const badgeIds = meetingCandidateBadgeIds(meeting);
    selectedMeetingBadgeIds = new Set(badgeIds);
    selectedMeetingBadgeCredits = new Map(Object.entries(meetingCandidateBadgeCredits(meeting)));
    renderAttendanceGrid();
    renderPatrolPoints();
    setPatrolPointInputsFromMeeting(meeting);
    $("#meetingSubmitButton").textContent = meetingIsComplete(meeting) ? "Update attendance" : "Update attendance";
  } else {
    selectedMeetingBadgeIds = new Set((event.badgeIds || []).filter((id) => state.badges.some((badge) => badge.id === id)));
    selectedMeetingBadgeCredits = new Map(Object.entries(badgeCreditsForIds(event.badgeIds || [], event.badgeCredits || {})));
    renderAttendanceGrid();
    const missing = new Set(event.missingKidIds || []);
    setPresentKidsFromIds(state.kids.filter((kid) => !missing.has(kid.id)).map((kid) => kid.id));
    renderPatrolPoints();
    $("#meetingSubmitButton").textContent = "Submit attendance";
  }
  renderLogBadgeTiles();
}

function selectAttendanceEvent(eventId) {
  selectedAttendanceEventId = eventId;
  renderAttendanceWorkflowCalendar();
}

function openAttendanceEntry(eventId) {
  selectedAttendanceEventId = eventId;
  attendanceWorkflowCursor = startOfMonth(new Date(`${eventSnapshot(eventId)?.date || today()}T12:00:00`));
  renderAttendanceWorkflowCalendar();
  applyAttendanceEventToForm(eventId);
  switchTab("attendance-entry");
  queueMeetingBadgePanelSync();
}

function renderKids() {
  renderRosterFormOptions();
  const rows = [];
  let activeYear = null;
  const kidsByYear = [...state.kids].sort(compareKidsForRoster);
  const yearCounts = kidsByYear.reduce((counts, kid) => {
    const key = emberYearValue(kid.year);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  kidsByYear.forEach((kid) => {
    const year = emberYearValue(kid.year);
    const yearLabel = emberYearLabel(year);
    if (year !== activeYear) {
      activeYear = year;
      rows.push(`
        <tr class="year-group-row year-group-${escapeAttr(year || "unset")}">
          <th colspan="7">
            <div class="year-group-content">
              <span>${escapeHtml(yearLabel)}</span>
              <small>${yearCounts[year]} ${yearCounts[year] === 1 ? "Ember" : "Embers"}</small>
            </div>
          </th>
        </tr>
      `);
    }
    rows.push(`
      <tr>
        <td>${escapeHtml(kid.name)}</td>
        <td>
          <select class="table-select year-select year-select-${escapeAttr(year || "unset")}" data-kid-year="${escapeAttr(kid.id)}" aria-label="Year for ${escapeAttr(kid.name)}">
            <option value="" ${year ? "" : "selected"}>No year set</option>
            ${Object.entries(EMBER_YEAR_LABELS).map(([value, label]) => `<option value="${value}" ${year === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </td>
        <td>
          <select class="table-select" data-kid-patrol="${escapeAttr(kid.id)}" aria-label="Patrol for ${escapeAttr(kid.name)}">
            ${patrolSelectOptions(kid.patrol, "No patrol")}
          </select>
          <input
            class="table-input patrol-other-input hidden"
            data-kid-patrol-other="${escapeAttr(kid.id)}"
            type="text"
            placeholder="Type patrol"
            hidden
          />
        </td>
        <td>
          <select class="table-select" data-kid-leadership="${escapeAttr(kid.id)}" aria-label="Leadership for ${escapeAttr(kid.name)}">
            ${Object.entries(LEADERSHIP_LABELS).map(([value, label]) => `<option value="${escapeAttr(value)}" ${leadershipValue(kid.leadership) === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
          </select>
        </td>
        <td>
          <select class="table-select" data-kid-membership="${escapeAttr(kid.id)}" aria-label="GGC membership year for ${escapeAttr(kid.name)}">
            <option value="" ${membershipYearValue(kid.membershipYear) ? "" : "selected"}>No membership year</option>
            ${Object.entries(MEMBERSHIP_YEAR_LABELS).map(([value, label]) => `<option value="${escapeAttr(value)}" ${membershipYearValue(kid.membershipYear) === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
          </select>
        </td>
        <td>
          <select class="table-select" data-kid-returning="${escapeAttr(kid.id)}" aria-label="Returning status for ${escapeAttr(kid.name)}">
            <option value="" ${returningValue(kid.returningStatus) ? "" : "selected"}>No status set</option>
            ${Object.entries(RETURNING_LABELS).map(([value, label]) => `<option value="${escapeAttr(value)}" ${returningValue(kid.returningStatus) === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
          </select>
        </td>
        <td><button class="text-button" data-remove-kid="${escapeAttr(kid.id)}" type="button">Remove</button></td>
      </tr>
    `);
  });
  $("#kidTable").innerHTML = rows.join("") || `<tr><td colspan="7">No Embers added yet.</td></tr>`;
}

function renderAttendanceCalendar() {
  const records = allAttendanceEvents();
  const calendarRecords = displayAttendanceEvents({ includeScheduled: true, includePlanned: true });
  const search = $("#attendanceSearch").value.trim().toLowerCase();
  const kidById = new Map(state.kids.map((kid) => [kid.id, kid]));
  const missedByKid = new Map(state.kids.map((kid) => [kid.id, []]));

  records.forEach((record) => {
    record.missingKidIds.forEach((kidId) => {
      if (!missedByKid.has(kidId)) missedByKid.set(kidId, []);
      missedByKid.get(kidId).push(record);
    });
  });

  const kidRows = sortedKids()
    .map((kid) => ({ kid, missed: missedByKid.get(kid.id) || [] }))
    .filter(({ kid, missed }) => {
      const haystack = `${kid.name} ${kid.patrol} ${emberYearLabel(kid.year)} ${missed.map((record) => `${record.date} ${record.title}`).join(" ")}`.toLowerCase();
      return !search || haystack.includes(search);
    });

  $("#kidMissedSummary").innerHTML = kidRows.map(({ kid, missed }) => `
    <article class="stack-item">
      <header>
        <div>
          <h3>${escapeHtml(kid.name)}</h3>
          <p class="muted">${escapeHtml(emberYearLabel(kid.year))} - ${escapeHtml(kid.patrol || "No patrol")} - ${missed.length} missed ${missed.length === 1 ? "day" : "days"}</p>
        </div>
        <span class="tag ${missed.length ? "warning" : "earned"}">${attendanceRate(kid.id)}</span>
      </header>
      <div class="tag-row">
        ${missed.length ? missed.map((record) => `<span class="tag">${escapeHtml(shortDate(record.date) || record.title)}</span>`).join("") : `<span class="tag earned">No missed days</span>`}
      </div>
    </article>
  `).join("") || emptyState("No Embers match that search.");

  renderCalendarMonth(calendarRecords, kidById);
  renderCalendarEventDetail(calendarRecords, kidById);
}

function renderCalendarMonth(records, kidById) {
  const badgeById = new Map(state.badges.map((badge) => [badge.id, badge]));
  const monthStart = startOfMonth(calendarCursor);
  const start = new Date(monthStart);
  start.setDate(start.getDate() - start.getDay());
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const end = new Date(monthEnd);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const days = [];
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    days.push(new Date(date));
  }

  $("#calendarMonthLabel").textContent = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const eventsByDate = new Map();
  records.forEach((record) => {
    if (!record.date) return;
    if (!eventsByDate.has(record.date)) eventsByDate.set(record.date, []);
    eventsByDate.get(record.date).push(record);
  });

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((day) => `<div class="calendar-weekday">${day}</div>`)
    .join("");
  const cells = days.map((date) => {
    const iso = toIsoDate(date);
    const events = eventsByDate.get(iso) || [];
    const isMuted = date.getMonth() !== monthStart.getMonth();
    return `
      <article class="calendar-day ${isMuted ? "is-muted" : ""}">
        <div class="calendar-day-number">${date.getDate()}</div>
        ${events.map((event) => {
          const missed = (event.missingKidIds || []).map((kidId) => kidById.get(kidId)?.name).filter(Boolean);
          const badges = (event.badgeIds || []).map((id) => badgeById.get(id)).filter(Boolean);
          const themeAttrs = calendarBadgeThemeAttrs(badges);
          return `
            <button class="calendar-event ${event.source === "planned" ? "is-planned" : event.source === "scheduled" ? "is-scheduled" : event.source === "logged" ? "is-logged" : ""} ${themeAttrs.className}" ${themeAttrs.style} data-calendar-event="${escapeAttr(event.id)}" type="button">
              ${escapeHtml(event.title)}
              ${event.source === "planned" ? `<span>Planned</span>` : event.source === "attendance" ? `<span>Attendance submitted</span>` : event.source !== "scheduled" ? `<span>${missed.length ? `${missed.length} away` : "All present"}</span>` : `<span>Scheduled</span>`}
            </button>
          `;
        }).join("")}
      </article>
    `;
  }).join("");
  $("#attendanceCalendar").innerHTML = weekdays + cells;
}

function renderCalendarEventDetail(records, kidById) {
  const detail = $("#calendarEventDetail");
  const visibleMonth = toIsoDate(calendarCursor).slice(0, 7);
  const selected =
    records.find((record) => record.id === selectedCalendarEventId) ||
    records.find((record) => record.date === toIsoDate(new Date())) ||
    records.find((record) => String(record.date || "").startsWith(visibleMonth)) ||
    records[0];
  if (!selected) {
    detail.innerHTML = emptyState("Click an event on the calendar to see details.");
    return;
  }
  selectedCalendarEventId = selected.id;
  const missingNames = (selected.missingKidIds || []).map((kidId) => kidById.get(kidId)?.name).filter(Boolean);
  const activities = itineraryActivitiesForRecord(selected).filter((activity) => String(activity || "").trim());
  const overview = selected.summary || selected.notes || "";
  detail.innerHTML = `
    <article class="calendar-detail-card">
      <header>
        <div>
          <h3>${escapeHtml(selected.title)}</h3>
          <p class="muted">${formatDate(selected.date) || "Date not listed"} - ${selected.source === "planned" ? "Planned meeting" : selected.source === "scheduled" ? "Scheduled event" : selected.source === "excel" ? "Excel attendance" : selected.source === "attendance" ? "Attendance submitted" : "Completed meeting"}</p>
        </div>
        ${selected.source === "scheduled" ? `<button class="text-button" data-remove-scheduled-event="${escapeAttr(selected.id)}" type="button">Delete</button>` : ""}
        ${selected.source === "planned" ? `<button class="text-button" data-remove-plan="${escapeAttr(selected.planId)}" type="button">Delete</button>` : ""}
        ${selected.source === "attendance" ? `<button class="primary-button" data-complete-meeting="${escapeAttr(selected.meetingId)}" type="button">Complete meeting</button>` : ""}
        ${selected.source === "logged" ? `<button class="text-button" data-remove-meeting="${escapeAttr(selected.meetingId)}" type="button">Delete</button>` : ""}
      </header>
      <section class="calendar-detail-section">
        <h4>Missed</h4>
        <div class="tag-row">
          ${missingNames.length ? missingNames.map((name) => `<span class="tag warning">${escapeHtml(name)}</span>`).join("") : `<span class="tag earned">No one missed</span>`}
        </div>
      </section>
      <section class="calendar-detail-section">
        <h4>Itinerary</h4>
        ${overview ? `<p class="linked-text">${linkifyText(overview)}</p>` : ""}
        ${activities.length ? `
          <div class="itinerary-activity-list">
            ${activities.map((activity) => `
              <article class="itinerary-activity">
                <div class="linked-text">${linkifyText(activity)}</div>
              </article>
            `).join("")}
          </div>
        ` : overview ? "" : `<p class="muted">No itinerary notes recorded yet.</p>`}
      </section>
      <div class="tag-row">
        ${selected.source === "planned" ? `<span class="tag">Planned only - no badge credit yet</span>` : selected.source === "scheduled" ? `<span class="tag">Attendance not recorded yet</span>` : selected.source === "attendance" ? `<span class="tag warning">Attendance saved - badge completion pending</span>` : ""}
      </div>
    </article>
  `;
}

function eventRefById(id) {
  if (!id) return null;
  if (id.startsWith("logged-attendance-")) {
    const meetingId = id.replace("logged-attendance-", "");
    const index = state.meetings.findIndex((meeting) => meeting.id === meetingId);
    return index >= 0 ? { type: "logged", index, item: state.meetings[index] } : null;
  }
  let index = (state.attendanceRecords || []).findIndex((record) => record.id === id);
  if (index >= 0) return { type: "excel", index, item: state.attendanceRecords[index] };
  index = (state.scheduledEvents || []).findIndex((event) => event.id === id);
  if (index >= 0) return { type: "scheduled", index, item: state.scheduledEvents[index] };
  if (id.startsWith("planned-")) {
    const planId = id.replace("planned-", "");
    index = (state.weeklyPlans || []).findIndex((plan) => plan.id === planId);
    if (index >= 0) return { type: "planned", index, item: state.weeklyPlans[index] };
  }
  return null;
}

function eventSnapshot(id) {
  return allAttendanceEvents({ includeScheduled: true, includePlanned: true }).find((event) => event.id === id);
}

function renderEventModalBadges() {
  const search = ($("#eventBadgeSearch")?.value || "").trim().toLowerCase();
  const badges = state.badges.filter((badge) => {
    if (isProgramAreaBadge(badge)) return false;
    const haystack = `${badge.name} ${badge.area}`.toLowerCase();
    return !search || haystack.includes(search);
  }).sort(compareBadges);
  $("#eventBadgeChecklist").innerHTML = badges.map((badge) => `
    <label class="check-row">
      <input type="checkbox" name="eventBadge" value="${escapeAttr(badge.id)}" ${modalBadgeSelection.has(badge.id) ? "checked" : ""} />
      <span>${escapeHtml(badge.name)}<small class="muted">${escapeHtml(badge.area || "No area")} - ${badge.requirements.slice(0, 3).map((requirement) => requirement.title).join(", ")}${badge.requirements.length > 3 ? "..." : ""}</small></span>
    </label>
  `).join("") || emptyState("No badges match that search.");
}

function openEventModal(id) {
  const record = eventSnapshot(id);
  const ref = eventRefById(id);
  if (!record || !ref) return;
  modalEventId = id;
  $("#eventEditId").value = id;
  $("#eventModalSource").textContent = ref.type === "planned" ? "Planned meeting" : ref.type === "excel" ? "Excel attendance" : ref.type === "logged" ? (meetingIsComplete(ref.item) ? "Completed meeting" : "Attendance submitted") : "Scheduled event";
  $("#eventModalTitle").textContent = record.title || "Edit event";
  $("#eventEditDate").value = record.date || today();
  $("#eventEditTitle").value = record.title || "";
  $("#eventEditNotes").value = record.summary || "";

  modalBadgeSelection = new Set(ref.type === "logged" && !meetingIsComplete(ref.item) ? meetingCandidateBadgeIds(ref.item) : (record.badgeIds || []));
  renderEventModalBadges();

  const missing = new Set(record.missingKidIds || []);
  $("#eventAbsentChecklist").innerHTML = sortedKids().map((kid) => `
    <label class="check-row">
      <input type="checkbox" name="eventAbsentKid" value="${escapeAttr(kid.id)}" ${missing.has(kid.id) ? "checked" : ""} />
      <span>${escapeHtml(kid.name)}<small class="muted">${escapeHtml(emberYearLabel(kid.year))} - ${escapeHtml(kid.patrol || "No patrol")}</small></span>
    </label>
  `).join("") || emptyState("No Embers available.");

  $("#eventBadgeSearch").value = "";
  $("#eventModal").hidden = false;
}

function closeEventModal() {
  modalEventId = "";
  $("#eventModal").hidden = true;
}

function selectedModalBadgeIds() {
  return [...modalBadgeSelection];
}

function requirementIdsForBadgeIds(badgeIds) {
  const wanted = new Set(badgeIds);
  return state.badges
    .filter((badge) => wanted.has(badge.id))
    .flatMap((badge) => badge.requirements.map((requirement) => requirement.id));
}

function saveEventModal() {
  const id = $("#eventEditId").value;
  const ref = eventRefById(id);
  if (!ref) return;
  const date = $("#eventEditDate").value;
  const title = $("#eventEditTitle").value.trim();
  const summary = $("#eventEditNotes").value.trim();
  const badgeIds = selectedModalBadgeIds();
  const badgeCredits = badgeCreditsForIds(badgeIds, ref.item.badgeCredits || {});
  const requirementIds = requirementIdsForBadgeCredits(badgeCredits);
  const missingKidIds = $$("input[name='eventAbsentKid']:checked").map((input) => input.value);

  if (ref.type === "logged") {
    const meeting = state.meetings[ref.index];
    const presentKidIds = state.kids.filter((kid) => !missingKidIds.includes(kid.id)).map((kid) => kid.id);
    meeting.date = date;
    meeting.title = title;
    meeting.notes = summary;
    meeting.presentKidIds = presentKidIds;
    if (meetingIsComplete(meeting)) {
      meeting.badgeIds = badgeIds;
      meeting.badgeCredits = badgeCredits;
      meeting.requirementIds = requirementIds;
      meeting.badgeKidIds = defaultBadgeKidIdsForMeeting(meeting, badgeIds);
      badgeIds.forEach((badgeId) => {
        if (!Array.isArray(meeting.badgeKidIds[badgeId])) meeting.badgeKidIds[badgeId] = [...presentKidIds];
      });
    } else {
      meeting.pendingBadgeIds = badgeIds;
      meeting.pendingBadgeCredits = badgeCredits;
      meeting.badgeIds = [];
      meeting.badgeCredits = {};
      meeting.requirementIds = [];
    }
  } else if (ref.type === "excel") {
    state.attendanceRecords[ref.index] = {
      ...state.attendanceRecords[ref.index],
      date,
      title,
      summary,
      badgeIds,
      badgeCredits,
      requirementIds,
      missingKidIds,
    };
  } else if (ref.type === "planned") {
    state.weeklyPlans[ref.index] = {
      ...state.weeklyPlans[ref.index],
      date,
      title,
      notes: summary,
      badgeIds,
      badgeCredits,
    };
  } else {
    state.scheduledEvents[ref.index] = {
      ...state.scheduledEvents[ref.index],
      date,
      title,
      summary,
      badgeIds,
      badgeCredits,
      requirementIds,
      missingKidIds,
    };
  }
  selectedCalendarEventId = id;
  calendarCursor = startOfMonth(new Date(`${date}T12:00:00`));
  saveState();
  closeEventModal();
  renderAll();
  setAttendanceView("calendar");
  showToast("Event updated.");
}

function renderCompletionBadges() {
  const search = ($("#completeBadgeSearch")?.value || "").trim().toLowerCase();
  const badges = state.badges
    .filter((badge) => !isProgramAreaBadge(badge))
    .filter((badge) => {
      const haystack = `${badge.name} ${badge.area || ""} ${(badge.requirements || []).map((requirement) => requirement.title).join(" ")}`.toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort(compareBadges);
  $("#completeBadgeChecklist").innerHTML = badges.map((badge) => {
    const selected = completionBadgeSelection.has(badge.id);
    const theme = categoryTheme(badge.area);
    return `
      <label class="check-row badge-plan-row ${selected ? "is-selected" : ""}" style="--category-fill: ${theme.fill}; --category-accent: ${theme.accent};">
        <input type="checkbox" name="completeBadge" value="${escapeAttr(badge.id)}" ${selected ? "checked" : ""} />
        <img src="${badgeImageSrc(badge)}" alt="" />
        <span>${escapeHtml(badge.name)}<small class="muted">${escapeHtml(badge.area || "No area")} - ${escapeHtml(badgeEarnLabel(badge))}</small></span>
        ${selected ? `
          <span class="credit-count-control is-inline">
            Activities
            <input data-complete-badge-credit="${escapeAttr(badge.id)}" type="number" min="1" max="${badgeCreditMax(badge)}" step="1" value="${escapeAttr(badgeCreditValue(badge, completionBadgeCredits.get(badge.id) || 1))}" />
          </span>
        ` : ""}
      </label>
    `;
  }).join("") || emptyState("No badges match that search.");
}

function renderCompletionKidBadgeMatrix() {
  const meeting = state.meetings.find((item) => item.id === completionMeetingId);
  const wrap = $("#completeKidBadgeMatrix");
  if (!meeting || !wrap) return;
  const badgeIds = [...completionBadgeSelection].filter((id) => state.badges.some((badge) => badge.id === id));
  const badges = badgeIds.map((id) => state.badges.find((badge) => badge.id === id)).filter(Boolean).sort(compareBadges);
  const kids = sortedKids();
  const present = new Set(meeting.presentKidIds || []);
  if (!badges.length) {
    wrap.innerHTML = emptyState("Select completed badges to choose which Embers receive credit.");
    return;
  }
  if (!kids.length) {
    wrap.innerHTML = emptyState("Add Embers before completing badge credit.");
    return;
  }
  wrap.innerHTML = `
    <div class="badge-matrix-wrap completion-matrix" role="region" aria-label="Meeting badge credit by Ember">
      <table class="badge-matrix is-summary">
        <thead>
          <tr>
            <th class="sticky-col ember-col">Ember</th>
            <th>Attendance</th>
            ${badges.map((badge) => `
              <th style="--category-fill: ${categoryTheme(badge.area).fill}; --category-accent: ${categoryTheme(badge.area).accent};">
                <img src="${badgeImageSrc(badge)}" alt="" />
                <span>${escapeHtml(badge.name)}</span>
                <small>${escapeHtml(badge.area || "No area")}</small>
              </th>
            `).join("")}
          </tr>
        </thead>
        <tbody>
          ${kids.map((kid) => `
            <tr>
              <th class="sticky-col ember-col" scope="row">${escapeHtml(kid.name)}</th>
              <td>${meeting.attendanceStatus?.[kid.id] === "partial" ? `<span class="tag warning">Partial</span>` : present.has(kid.id) ? `<span class="tag earned">Present</span>` : `<span class="tag warning">Absent</span>`}</td>
              ${badges.map((badge) => {
                const selectedKids = new Set(completionBadgeKidIds[badge.id] || []);
                return `
                  <td style="--category-fill: ${categoryTheme(badge.area).fill}; --category-accent: ${categoryTheme(badge.area).accent};">
                    <label class="completion-credit-check">
                      <input
                        type="checkbox"
                        data-complete-kid-id="${escapeAttr(kid.id)}"
                        data-complete-badge-id="${escapeAttr(badge.id)}"
                        ${selectedKids.has(kid.id) ? "checked" : ""}
                        aria-label="${escapeAttr(`${kid.name} receives ${badge.name} credit`)}"
                      />
                      <span>${selectedKids.has(kid.id) ? "Credit" : "No credit"}</span>
                    </label>
                  </td>
                `;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCompletionModal() {
  renderCompletionBadges();
  renderCompletionKidBadgeMatrix();
}

function openCompleteMeetingModal(meetingId) {
  const meeting = state.meetings.find((item) => item.id === meetingId);
  if (!meeting) return;
  completionMeetingId = meeting.id;
  $("#completeMeetingId").value = meeting.id;
  $("#completeMeetingTitle").textContent = meeting.title || "Verify badges";
  $("#completeMeetingSummary").textContent = `${formatDate(meeting.date) || "No date"} - ${(meeting.presentKidIds || []).length} present. Confirm badge credit before marking the meeting complete.`;
  $("#completeBadgeSearch").value = "";
  completionBadgeSelection = new Set(meetingCandidateBadgeIds(meeting));
  completionBadgeCredits = new Map(Object.entries(meetingCandidateBadgeCredits(meeting)));
  completionBadgeKidIds = defaultBadgeKidIdsForMeeting(meeting, [...completionBadgeSelection]);
  renderCompletionModal();
  $("#completeMeetingModal").hidden = false;
}

function closeCompleteMeetingModal() {
  completionMeetingId = "";
  completionBadgeSelection = new Set();
  completionBadgeCredits = new Map();
  completionBadgeKidIds = {};
  $("#completeMeetingModal").hidden = true;
}

function completeMeetingFromModal() {
  const meeting = state.meetings.find((item) => item.id === $("#completeMeetingId").value);
  if (!meeting) return;
  const badgeIds = [...completionBadgeSelection].filter((id) => state.badges.some((badge) => badge.id === id));
  const badgeCredits = badgeCreditsFromSelection(new Set(badgeIds), completionBadgeCredits);
  meeting.badgeIds = badgeIds;
  meeting.badgeCredits = badgeCredits;
  meeting.requirementIds = requirementIdsForBadgeCredits(badgeCredits);
  meeting.badgeKidIds = defaultBadgeKidIdsForMeeting({ ...meeting, badgeKidIds: completionBadgeKidIds }, badgeIds);
  meeting.pendingBadgeIds = [];
  meeting.pendingBadgeCredits = {};
  meeting.pendingBadgeKidIds = {};
  meeting.completedAt = new Date().toISOString();
  selectedCalendarEventId = `logged-attendance-${meeting.id}`;
  saveState();
  closeCompleteMeetingModal();
  renderAll();
  setAttendanceView("calendar");
  showToast(badgeIds.length ? "Meeting completed and badge progress updated." : "Meeting completed with attendance only.");
}

function renderBadges() {
  const search = $("#badgeSearch").value.trim().toLowerCase();
  const badges = state.badges.filter((badge) => {
    const haystack = `${badge.name} ${badge.area} ${badge.requirements.map((item) => item.title).join(" ")}`.toLowerCase();
    return !search || haystack.includes(search);
  }).sort(compareBadges);
  $("#badgeList").innerHTML = badges.map((badge) => `
    <article class="badge-item">
      <header>
        <div>
          <h3>${escapeHtml(badge.name)}</h3>
          <p class="muted">${escapeHtml(badge.area || "No area")} - ${escapeHtml(badgeEarnLabel(badge))}</p>
        </div>
        <div class="inline-actions">
          <button class="text-button" data-edit-badge="${escapeAttr(badge.id)}" type="button">Edit</button>
          ${isCustomBadge(badge) ? `<button class="text-button" data-remove-badge="${escapeAttr(badge.id)}" type="button">Remove</button>` : ""}
        </div>
      </header>
      <div class="tag-row">
        ${badge.requirements.slice(0, 9).map((requirement) => `<span class="tag">${escapeHtml(requirement.title)}</span>`).join("")}
        ${badge.requirements.length > 9 ? `<span class="tag warning">+${badge.requirements.length - 9} more</span>` : ""}
      </div>
    </article>
  `).join("") || emptyState("No matching badges.");
}

function visiblePlanningBadges() {
  const search = ($("#planningBadgeSearch")?.value || "").trim().toLowerCase();
  return state.badges
    .filter((badge) => !isProgramAreaBadge(badge))
    .filter((badge) => {
      const haystack = `${badge.name} ${badge.area} ${badge.requirements.map((requirement) => requirement.title).join(" ")}`.toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort(compareBadges);
}

function renderPlanningBadges() {
  const visibleIds = new Set(state.badges.map((badge) => badge.id));
  planningBadgeCredits = new Map([...planningBadgeCredits].filter(([id]) => planningBadgeSelection.has(id) && visibleIds.has(id)));
  $("#planningBadgeChecklist").innerHTML = visiblePlanningBadges().map((badge) => {
    const theme = categoryTheme(badge.area);
    const selected = planningBadgeSelection.has(badge.id);
    return `
      <label class="check-row badge-plan-row ${selected ? "is-selected" : ""}" style="--category-fill: ${theme.fill}; --category-accent: ${theme.accent};">
        <input type="checkbox" name="planningBadge" value="${escapeAttr(badge.id)}" ${selected ? "checked" : ""} />
        <img src="${badgeImageSrc(badge)}" alt="" />
        <span>${escapeHtml(badge.name)}<small>${escapeHtml(badge.area || "No area")} - ${escapeHtml(badgeEarnLabel(badge))}</small></span>
        ${selected ? `
          <span class="credit-count-control is-inline">
            Activities
            <input data-planning-badge-credit="${escapeAttr(badge.id)}" type="number" min="1" max="${badgeCreditMax(badge)}" step="1" value="${escapeAttr(badgeCreditValue(badge, planningBadgeCredits.get(badge.id) || 1))}" />
          </span>
        ` : ""}
      </label>
    `;
  }).join("") || emptyState("No badges match that search.");
  renderPlanningActivityPlanner();
}

function selectedPlanningBadgeIds() {
  return [...planningBadgeSelection];
}

function planningBadgeCreditObject() {
  return badgeCreditsFromSelection(planningBadgeSelection, planningBadgeCredits);
}

function planningActivityCount() {
  return totalBadgeCredits(selectedPlanningBadgeIds(), planningBadgeCreditObject());
}

function readPlanningActivityInputs() {
  $$("[data-planning-activity-index]").forEach((input) => {
    planningActivities[Number(input.dataset.planningActivityIndex)] = input.value;
  });
}

function normalizePlanningActivities(count = planningActivityCount()) {
  planningActivities = Array.from({ length: count }, (_, index) => planningActivities[index] || "");
}

function renderPlanningActivityPlanner() {
  const wrap = $("#planningActivityPlanner");
  if (!wrap) return;
  readPlanningActivityInputs();
  const count = planningActivityCount();
  normalizePlanningActivities(count);
  if (!count) {
    wrap.innerHTML = `
      <header>
        <div>
          <h3>Activity itinerary</h3>
          <p class="muted">Add badges when you want badge-linked activity slots, or leave this plan as notes only.</p>
        </div>
      </header>
    `;
    return;
  }
  wrap.innerHTML = `
    <header>
      <div>
        <h3>Activity itinerary</h3>
        <p class="muted">${count} ${count === 1 ? "activity" : "activities"} planned from the selected badge credits.</p>
      </div>
      <span class="tag">${count} total</span>
    </header>
    <div class="planning-activity-list">
      ${planningActivities.map((activity, index) => `
        <label class="planning-activity-row">
          <strong>${index + 1}</strong>
          <textarea data-planning-activity-index="${index}" rows="2" placeholder="Activity ${index + 1}: supplies, timing, instructions, or a link">${escapeHtml(activity)}</textarea>
        </label>
      `).join("")}
    </div>
  `;
}

function resetPlanningForm() {
  $("#planningEditId").value = "";
  $("#planningDate").value = today();
  $("#planningTitle").value = "";
  $("#planningNotes").value = "";
  $("#planningBadgeSearch").value = "";
  planningBadgeSelection = new Set();
  planningBadgeCredits = new Map();
  planningActivities = [];
  selectedPlanningPlanId = "";
  selectedPlanningEventId = "";
  selectedPlanningDate = "";
  renderPlanningBadges();
  renderPlanningActivityPlanner();
}

function renderPlanningCalendar() {
  const badgeById = new Map(state.badges.map((badge) => [badge.id, badge]));
  const monthStart = startOfMonth(planningCalendarCursor);
  const start = new Date(monthStart);
  start.setDate(start.getDate() - start.getDay());
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const end = new Date(monthEnd);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const days = [];
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    days.push(new Date(date));
  }

  $("#planningCalendarMonthLabel").textContent = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const plansByDate = new Map();
  (state.weeklyPlans || []).forEach((plan) => {
    if (!plan.date) return;
    if (!plansByDate.has(plan.date)) plansByDate.set(plan.date, []);
    plansByDate.get(plan.date).push(plan);
  });
  const eventsByDate = new Map();
  const planSourceIds = (state.weeklyPlans || []).map((plan) => `planned-${plan.id}`);
  displayAttendanceEvents({ includeScheduled: true }, planSourceIds).forEach((event) => {
    if (!event.date) return;
    if (!eventsByDate.has(event.date)) eventsByDate.set(event.date, []);
    eventsByDate.get(event.date).push(event);
  });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((day) => `<div class="calendar-weekday">${day}</div>`)
    .join("");
  const cells = days.map((date) => {
    const iso = toIsoDate(date);
    const plans = (plansByDate.get(iso) || []).sort((a, b) => a.title.localeCompare(b.title));
    const events = (eventsByDate.get(iso) || []).sort((a, b) => a.title.localeCompare(b.title));
    const isMuted = date.getMonth() !== monthStart.getMonth();
    return `
      <article class="calendar-day planning-calendar-day ${isMuted ? "is-muted" : ""} ${selectedPlanningDate === iso ? "is-selected-day" : ""}" data-planning-date="${escapeAttr(iso)}" role="button" tabindex="0" aria-label="Plan meeting on ${escapeAttr(formatDate(iso))}">
        <div class="calendar-day-number planning-date-button">${date.getDate()}</div>
        ${plans.map((plan) => {
          const badges = (plan.badgeIds || []).map((id) => badgeById.get(id)).filter(Boolean);
          const themeAttrs = calendarBadgeThemeAttrs(badges);
          const status = attendanceEventStatusLines({ id: `planned-${plan.id}`, source: "planned" });
          const creditCount = totalBadgeCredits(plan.badgeIds || [], plan.badgeCredits || {});
          return `
            <button class="calendar-event is-planned ${themeAttrs.className} ${selectedPlanningPlanId === plan.id ? "is-selected" : ""}" ${themeAttrs.style} data-planning-plan="${escapeAttr(plan.id)}" type="button">
              ${escapeHtml(plan.title || "Planned meeting")}
              <span>${creditCount} ${creditCount === 1 ? "activity" : "activities"}</span>
              <span>${escapeHtml(status.attendance)}</span>
              <span>${escapeHtml(status.badges)}</span>
            </button>
          `;
        }).join("")}
        ${events.map((event) => {
          const badges = (event.badgeIds || []).map((id) => badgeById.get(id)).filter(Boolean);
          const themeAttrs = calendarBadgeThemeAttrs(badges);
          const status = attendanceEventStatusLines(event);
          return `
            <button class="calendar-event ${event.source === "scheduled" ? "is-scheduled" : event.source === "logged" ? "is-logged" : ""} ${themeAttrs.className} ${selectedPlanningEventId === event.id ? "is-selected" : ""}" ${themeAttrs.style} data-planning-event="${escapeAttr(event.id)}" type="button">
              ${escapeHtml(event.title || "GG event")}
              <span>${escapeHtml(status.attendance)}</span>
              <span>${escapeHtml(status.badges)}</span>
            </button>
          `;
        }).join("")}
      </article>
    `;
  }).join("");
  $("#planningCalendar").innerHTML = weekdays + cells;
  renderPlanningCalendarDetail();
}

function renderPlanningCalendarDetail() {
  const detail = $("#planningCalendarDetail");
  const badgeById = new Map(state.badges.map((badge) => [badge.id, badge]));
  const plans = [...(state.weeklyPlans || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const events = displayAttendanceEvents({ includeScheduled: true }, plans.map((plan) => `planned-${plan.id}`));
  const visibleMonth = toIsoDate(planningCalendarCursor).slice(0, 7);
  if (selectedPlanningDate && !selectedPlanningPlanId && !selectedPlanningEventId) {
    detail.innerHTML = `
      <article class="calendar-detail-card planning-detail-card">
        <header>
          <div>
            <h3>New planned meeting</h3>
            <p class="muted">${formatDate(selectedPlanningDate)} - fill in the planning form to schedule it.</p>
          </div>
        </header>
      </article>
    `;
    return;
  }
  const selectedEvent =
    events.find((event) => event.id === selectedPlanningEventId) ||
    (!selectedPlanningPlanId
      ? events.find((event) => event.date === today()) ||
        events.find((event) => String(event.date || "").startsWith(visibleMonth)) ||
        events[0]
      : null);
  if (selectedEvent) {
    selectedPlanningEventId = selectedEvent.id;
    const badges = (selectedEvent.badgeIds || []).map((id) => badgeById.get(id)).filter(Boolean);
    const status = attendanceEventStatusLines(selectedEvent);
    detail.innerHTML = `
      <article class="calendar-detail-card planning-detail-card">
        <header>
          <div>
            <h3>${escapeHtml(selectedEvent.title || "GG event")}</h3>
            <p class="muted">${formatDate(selectedEvent.date)} - ${selectedEvent.source === "scheduled" ? "Scheduled event" : selectedEvent.source === "logged" ? "Completed meeting" : selectedEvent.source === "attendance" ? "Attendance submitted" : "Attendance event"}</p>
          </div>
          <div class="inline-actions">
            <button class="text-button" data-open-itinerary-event="${escapeAttr(selectedEvent.id)}" type="button">Itinerary</button>
            <button class="text-button" data-calendar-event="${escapeAttr(selectedEvent.id)}" type="button">Open event</button>
            ${selectedEvent.source === "attendance" ? `<button class="primary-button" data-complete-meeting="${escapeAttr(selectedEvent.meetingId)}" type="button">Complete meeting</button>` : ""}
            ${selectedEvent.source === "logged" ? `<button class="text-button" data-remove-meeting="${escapeAttr(selectedEvent.meetingId)}" type="button">Delete</button>` : ""}
          </div>
        </header>
        ${selectedEvent.summary ? `<p>${escapeHtml(selectedEvent.summary)}</p>` : ""}
        <div class="tag-row">
          <span class="tag ${status.attendance.includes("not") ? "warning" : "earned"}">${escapeHtml(status.attendance)}</span>
          <span class="tag ${status.badges.includes("not") ? "warning" : "earned"}">${escapeHtml(status.badges)}</span>
          ${badges.map((badge) => `<span class="tag">${escapeHtml(badgeCreditTag(badge, selectedEvent.badgeCredits || {}))}</span>`).join("") || `<span class="tag warning">No badge focus listed</span>`}
        </div>
      </article>
    `;
    return;
  }
  const selected =
    plans.find((plan) => plan.id === selectedPlanningPlanId) ||
    plans.find((plan) => plan.date === today()) ||
    plans.find((plan) => String(plan.date || "").startsWith(visibleMonth)) ||
    plans[0];
  if (!selected) {
    detail.innerHTML = emptyState("Click a calendar date to start scheduling a meeting.");
    return;
  }
  selectedPlanningPlanId = selected.id;
  const badges = (selected.badgeIds || []).map((id) => badgeById.get(id)).filter(Boolean);
  const status = attendanceEventStatusLines({ id: `planned-${selected.id}`, source: "planned" });
  detail.innerHTML = `
    <article class="calendar-detail-card planning-detail-card">
      <header>
        <div>
          <h3>${escapeHtml(selected.title || "Planned meeting")}</h3>
          <p class="muted">${formatDate(selected.date)} - planned only, no badge credit yet</p>
        </div>
        <div class="inline-actions">
          <button class="text-button" data-open-itinerary-plan="${escapeAttr(selected.id)}" type="button">Itinerary</button>
          <button class="text-button" data-edit-plan="${escapeAttr(selected.id)}" type="button">Edit</button>
          <button class="text-button" data-remove-plan="${escapeAttr(selected.id)}" type="button">Delete</button>
        </div>
      </header>
      ${selected.notes ? `<p>${escapeHtml(selected.notes)}</p>` : ""}
      <div class="tag-row">
        <span class="tag ${status.attendance.includes("not") ? "warning" : "earned"}">${escapeHtml(status.attendance)}</span>
        <span class="tag ${status.badges.includes("not") ? "warning" : "earned"}">${escapeHtml(status.badges)}</span>
        ${badges.map((badge) => `<span class="tag">${escapeHtml(badgeCreditTag(badge, selected.badgeCredits || {}))}</span>`).join("") || `<span class="tag warning">No badge focus yet</span>`}
      </div>
    </article>
  `;
}

function selectPlanningCalendarDate(date) {
  $("#planningEditId").value = "";
  $("#planningDate").value = date;
  selectedPlanningPlanId = "";
  selectedPlanningEventId = "";
  selectedPlanningDate = date;
  renderPlanningCalendar();
  $("#planningTitle").focus();
  showToast("Date selected for a new plan.");
}

function renderPlanning() {
  renderPlanningBadges();
  renderPlanningCalendar();
}

function plannerNotes() {
  state.notes = Array.isArray(state.notes) ? state.notes.map(normalizePlannerNote).filter(Boolean) : [];
  return state.notes;
}

function selectedPlannerNote() {
  const notes = plannerNotes();
  if (!notes.length) {
    selectedNoteId = "";
    return null;
  }
  if (!notes.some((note) => note.id === selectedNoteId)) selectedNoteId = notes[0].id;
  return notes.find((note) => note.id === selectedNoteId) || null;
}

function renderNotes() {
  const notes = plannerNotes();
  const active = selectedPlannerNote();
  const notesList = $("#notesList");
  const titleInput = $("#noteTitle");
  const contentInput = $("#noteContent");
  const deleteButton = $("#deletePlannerNote");
  if (!notesList || !titleInput || !contentInput) return;

  notesList.innerHTML = notes.length ? notes.map((note) => `
    <button class="note-page-button ${note.id === selectedNoteId ? "is-active" : ""}" data-note-id="${escapeAttr(note.id)}" type="button">
      <span>${escapeHtml(note.title || "Untitled page")}</span>
      <small>${escapeHtml(formatDateTime(note.updatedAt))}</small>
    </button>
  `).join("") : emptyState("No notes yet.");

  titleInput.disabled = !active;
  contentInput.disabled = !active;
  if (deleteButton) deleteButton.disabled = !active;
  titleInput.value = active?.title || "";
  contentInput.value = active?.content || "";
}

function createPlannerNote() {
  const note = normalizePlannerNote({
    id: uid("note"),
    title: "Untitled page",
    content: "",
    updatedAt: new Date().toISOString(),
  });
  state.notes = [...plannerNotes(), note];
  selectedNoteId = note.id;
  saveState();
  renderNotes();
  $("#noteTitle")?.focus();
  $("#noteTitle")?.select();
}

function scheduleNoteSave() {
  const note = selectedPlannerNote();
  if (!note) return;
  note.title = $("#noteTitle").value.trim() || "Untitled page";
  note.content = $("#noteContent").value;
  note.updatedAt = new Date().toISOString();
  const activeButton = $$("[data-note-id]").find((button) => button.dataset.noteId === note.id);
  if (activeButton) {
    const title = activeButton.querySelector("span");
    const timestamp = activeButton.querySelector("small");
    if (title) title.textContent = note.title;
    if (timestamp) timestamp.textContent = formatDateTime(note.updatedAt);
  }
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(() => {
    saveState();
  }, 700);
}

function flushNoteSave() {
  if (!notesSaveTimer) return;
  clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  saveState();
}

function itineraryBadgeRows(badgeIds = [], badgeCredits = {}) {
  const badgeById = new Map(state.badges.map((badge) => [badge.id, badge]));
  return (badgeIds || [])
    .map((id) => badgeById.get(id))
    .filter((badge) => badge && !isProgramAreaBadge(badge))
    .sort(compareBadges)
    .map((badge) => {
      const theme = categoryTheme(badge.area);
      return `
        <span class="itinerary-badge-chip" style="--category-fill: ${theme.fill}; --category-accent: ${theme.accent};">
          <img src="${badgeImageSrc(badge)}" alt="" />
          <span>${escapeHtml(badgeCreditTag(badge, badgeCredits))}<small>${escapeHtml(badge.area || "No area")}</small></span>
        </span>
      `;
    })
    .join("");
}

function expandedItineraryBadgeGoals(record = {}) {
  const badgeById = new Map(state.badges.map((badge) => [badge.id, badge]));
  return (record.badgeIds || [])
    .map((id) => badgeById.get(id))
    .filter((badge) => badge && !isProgramAreaBadge(badge))
    .sort(compareBadges)
    .flatMap((badge) => {
      const count = badgeCreditValue(badge, record.badgeCredits?.[badge.id] || 1);
      return Array.from({ length: count }, (_, index) => ({ badge, index, count }));
    });
}

function itineraryActivitiesForRecord(record) {
  const count = totalBadgeCredits(record.badgeIds || [], record.badgeCredits || {});
  const saved = Array.isArray(record.activities) ? record.activities : [];
  return Array.from({ length: Math.max(count, saved.length) }, (_, index) => saved[index] || "");
}

function renderItinerary(record, options = {}) {
  const title = record?.title || "Meeting itinerary";
  const dateLabel = formatDate(record?.date) || "Date not listed";
  const badgeCount = (record?.badgeIds || []).length;
  const activityCount = totalBadgeCredits(record?.badgeIds || [], record?.badgeCredits || {});
  const activities = itineraryActivitiesForRecord(record || {});
  const badgeGoals = expandedItineraryBadgeGoals(record || {});
  $("#itineraryTitle").textContent = title;
  $("#itineraryContent").innerHTML = `
    <div class="itinerary-hero">
      <article class="itinerary-stat">
        <span>Date</span>
        <strong>${escapeHtml(dateLabel)}</strong>
      </article>
      <article class="itinerary-stat">
        <span>Badge focus</span>
        <strong>${badgeCount}</strong>
      </article>
      <article class="itinerary-stat">
        <span>Activities</span>
        <strong>${activityCount}</strong>
      </article>
    </div>
    <article class="itinerary-block">
      <h3>Overview</h3>
      ${record?.summary || record?.notes ? `<p class="linked-text">${linkifyText(record.summary || record.notes)}</p>` : `<p class="muted">No overview notes yet.</p>`}
    </article>
    <article class="itinerary-block">
      <h3>Badge goals</h3>
      <div class="tag-row">${itineraryBadgeRows(record?.badgeIds || [], record?.badgeCredits || {}) || `<span class="tag warning">No badge focus listed</span>`}</div>
    </article>
    <article class="itinerary-block">
      <h3>Activity itinerary</h3>
      <div class="itinerary-activity-list">
        ${activities.length ? activities.map((activity, index) => {
          const goal = badgeGoals[index] || null;
          const theme = goal ? categoryTheme(goal.badge.area) : categoryTheme("");
          return `
          <article class="itinerary-activity ${goal ? "has-badge-goal" : ""}" style="--category-fill: ${theme.fill}; --category-accent: ${theme.accent};">
            <div class="itinerary-activity-goal">
              ${goal ? `<img src="${badgeImageSrc(goal.badge)}" alt="" />` : `<span class="itinerary-goal-number">${index + 1}</span>`}
            </div>
            <div>
              <span class="itinerary-goal-label">${goal ? `${escapeHtml(goal.badge.name)}${goal.count > 1 ? ` ${goal.index + 1}/${goal.count}` : ""}` : "Open activity"}</span>
              <div class="linked-text">${activity.trim() ? linkifyText(activity) : `<span class="muted">Activity details not filled in yet.</span>`}</div>
            </div>
          </article>
        `;
        }).join("") : `<p class="muted">No activities planned yet.</p>`}
      </div>
    </article>
    ${options.sourceLabel ? `<p class="small-note">${escapeHtml(options.sourceLabel)}</p>` : ""}
  `;
}

function openPlanItinerary(planId) {
  const plan = (state.weeklyPlans || []).find((item) => item.id === planId);
  if (!plan) return;
  itineraryReturnTab = "planning";
  renderItinerary(plan, { sourceLabel: "Planned only - badge credit is awarded after attendance is completed." });
  switchTab("itinerary");
}

function openEventItinerary(eventId) {
  const event = eventSnapshot(eventId);
  if (!event) return;
  itineraryReturnTab = "planning";
  renderItinerary(event, { sourceLabel: event.source === "logged" ? "Completed meeting" : event.source === "attendance" ? "Attendance submitted" : event.source === "scheduled" ? "Scheduled event" : "Attendance event" });
  switchTab("itinerary");
}

const COOKIE_BOX_PRICE = 6;
const COOKIE_CASE_PRICE = 72;
const COOKIE_FLAVORS = ["Mint", "Chocolate/Vanilla"];
const COOKIE_PAYMENT_METHODS = ["", "Square", "Cash", "Other"];

function cookieRows() {
  state.cookieTracker = state.cookieTracker || { rows: {}, orders: [], grocery: {} };
  state.cookieTracker.rows = state.cookieTracker.rows || {};
  return state.cookieTracker.rows;
}

function normalizeCookieOrder(order = {}) {
  return {
    id: order.id || uid("cookie-order"),
    name: order.name || "Cookie order",
    totalCost: cookieNumber(order.totalCost ?? order.amount ?? order.cost),
    chocolateCases: cookieNumber(order.chocolateCases ?? order.chocolateVanillaCases ?? order.vanillaCases),
    mintCases: cookieNumber(order.mintCases),
    surplusChocolateCases: cookieNumber(order.surplusChocolateCases ?? order.surplusChocolateVanillaCases ?? order.surplusVanillaCases),
    surplusMintCases: cookieNumber(order.surplusMintCases),
    archived: Boolean(order.archived),
    notes: order.notes || "",
  };
}

function cookieOrders() {
  state.cookieTracker = state.cookieTracker || { rows: {}, orders: [], grocery: {} };
  state.cookieTracker.orders = Array.isArray(state.cookieTracker.orders) ? state.cookieTracker.orders.map(normalizeCookieOrder) : [];
  return state.cookieTracker.orders;
}

function activeCookieOrders() {
  return cookieOrders().filter((order) => !order.archived);
}

function archivedCookieOrders() {
  return cookieOrders().filter((order) => order.archived);
}

function cookieOrderOptions(selected = "") {
  const orders = activeCookieOrders();
  const selectedArchived = selected ? archivedCookieOrders().find((order) => order.id === selected) : null;
  const optionOrders = selectedArchived ? [...orders, selectedArchived] : orders;
  return `<option value="">No order selected</option>${optionOrders.map((order) => `<option value="${escapeAttr(order.id)}" ${selected === order.id ? "selected" : ""}>${escapeHtml(order.name)}${order.archived ? " (archived)" : ""}</option>`).join("")}`;
}

function newCookiePickup() {
  return {
    id: uid("cookie"),
    date: today(),
    flavor: "Mint",
    cases: 0,
    boxes: 0,
    orderId: activeCookieOrders()[0]?.id || "",
    notes: "",
  };
}

function newCookiePayment() {
  return {
    id: uid("cookie-payment"),
    date: today(),
    amount: 0,
    method: "",
    methodOther: "",
    orderId: activeCookieOrders()[0]?.id || "",
    notes: "",
  };
}

function normalizeCookieRow(row = {}) {
  const pickups = Array.isArray(row.pickups) ? row.pickups : [];
  const legacyCases = cookieNumber(row.cases);
  const legacyBoxes = cookieNumber(row.individualBoxes);
  const legacyPickup = legacyCases || legacyBoxes ? [{
    id: uid("cookie"),
    date: row.pickupDate || "",
    flavor: row.flavor || "Mint",
    cases: legacyCases,
    boxes: legacyBoxes,
    notes: row.notes || "",
  }] : [];

  const normalizedPickups = [...pickups, ...legacyPickup].map((pickup) => ({
    id: pickup.id || uid("cookie"),
    date: pickup.date || "",
    flavor: COOKIE_FLAVORS.includes(pickup.flavor) ? pickup.flavor : "Mint",
    cases: cookieNumber(pickup.cases),
    boxes: cookieNumber(pickup.boxes),
    orderId: cookieOrders().some((order) => order.id === pickup.orderId) ? pickup.orderId : "",
    notes: pickup.notes || "",
  }));
  const legacyPayment = row.payment || {};
  const owed = normalizedPickups.reduce((sum, pickup) => sum + cookiePickupOwed(pickup), 0);
  const legacyPaymentAmount = legacyPayment.status === "full" ? owed : cookieNumber(legacyPayment.amountPaid ?? row.paymentCollected);
  const payments = Array.isArray(row.payments) ? row.payments : [];
  const normalizedPayments = payments.map((payment) => ({
    id: payment.id || uid("cookie-payment"),
    date: payment.date || "",
    amount: cookieNumber(payment.amount),
    method: normalizeCookiePaymentMethod(payment.method),
    methodOther: payment.methodOther || "",
    orderId: cookieOrders().some((order) => order.id === payment.orderId) ? payment.orderId : "",
    notes: payment.notes || "",
  }));
  if (!payments.length && legacyPaymentAmount) {
    normalizedPayments.push({
      id: uid("cookie-payment"),
      date: legacyPayment.date || row.paymentDate || "",
      amount: legacyPaymentAmount,
      method: normalizeCookiePaymentMethod(legacyPayment.method || row.paymentMethod),
      methodOther: "",
      orderId: "",
      notes: legacyPayment.notes || row.paymentNotes || "",
    });
  }

  return {
    expanded: row.expanded ?? false,
    pickups: normalizedPickups,
    payments: normalizedPayments,
  };
}

function cookieNumber(value) {
  const cleaned = String(value || "").replace(/[$,\s]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function cookieRowForKid(kidId) {
  const rows = cookieRows();
  rows[kidId] = normalizeCookieRow(rows[kidId]);
  return rows[kidId];
}

function cookieMoney(value) {
  return `$${Math.round(value).toLocaleString()}`;
}

function normalizeCookiePaymentMethod(method = "") {
  const value = String(method || "").trim();
  if (!value) return "";
  if (/card/i.test(value)) return "Square";
  return COOKIE_PAYMENT_METHODS.includes(value) ? value : "Other";
}

function cookiePaymentMethodLabel(payment = {}) {
  if (payment.method === "Other") return payment.methodOther?.trim() || "Other";
  return payment.method || "No method";
}

function cookiePickupOwed(pickup = {}) {
  return cookieNumber(pickup.cases) * COOKIE_CASE_PRICE + cookieNumber(pickup.boxes) * COOKIE_BOX_PRICE;
}

function cookieOrderIsActive(orderId = "") {
  if (!orderId) return true;
  const order = cookieOrders().find((item) => item.id === orderId);
  return !order || !order.archived;
}

function cookieRowSummary(row, options = {}) {
  const pickups = (Array.isArray(row.pickups) ? row.pickups : []).filter((pickup) => !options.activeOnly || cookieOrderIsActive(pickup.orderId));
  const owed = pickups.reduce((sum, pickup) => sum + cookiePickupOwed(pickup), 0);
  const cases = pickups.reduce((sum, pickup) => sum + cookieNumber(pickup.cases), 0);
  const boxes = pickups.reduce((sum, pickup) => sum + cookieNumber(pickup.boxes), 0);
  const payments = (Array.isArray(row.payments) ? row.payments : []).filter((payment) => !options.activeOnly || cookieOrderIsActive(payment.orderId));
  const paid = payments.reduce((sum, payment) => sum + cookieNumber(payment.amount), 0);
  return {
    owed,
    activeOwed: owed,
    paid,
    activePaid: paid,
    outstanding: Math.max(owed - paid, 0),
    cases,
    boxes,
    totalBoxes: cases * 12 + boxes,
    pickupCount: pickups.length,
    paymentCount: payments.length,
    paidInFull: owed > 0 && Math.max(owed - paid, 0) <= 0,
  };
}

function cookieOrderStats(orderId) {
  let paid = 0;
  let owed = 0;
  let cases = 0;
  let boxes = 0;
  state.kids.forEach((kid) => {
    const row = cookieRowForKid(kid.id);
    (row.pickups || []).forEach((pickup) => {
      if (pickup.orderId !== orderId) return;
      owed += cookiePickupOwed(pickup);
      cases += cookieNumber(pickup.cases);
      boxes += cookieNumber(pickup.boxes);
    });
    (row.payments || []).forEach((payment) => {
      if (payment.orderId === orderId) paid += cookieNumber(payment.amount);
    });
  });
  const order = cookieOrders().find((item) => item.id === orderId);
  const enteredTarget = cookieNumber(order?.totalCost);
  const chocolateCases = cookieNumber(order?.chocolateCases);
  const mintCases = cookieNumber(order?.mintCases);
  const surplusChocolateCases = cookieNumber(order?.surplusChocolateCases);
  const surplusMintCases = cookieNumber(order?.surplusMintCases);
  const unitCases = chocolateCases + mintCases;
  const surplusCases = surplusChocolateCases + surplusMintCases;
  const orderedCases = unitCases + surplusCases;
  const orderedValue = orderedCases * COOKIE_CASE_PRICE;
  const target = enteredTarget || orderedValue;
  const paymentMethods = {};
  state.kids.forEach((kid) => {
    const row = cookieRowForKid(kid.id);
    (row.payments || []).forEach((payment) => {
      if (payment.orderId !== orderId) return;
      const label = cookiePaymentMethodLabel(payment);
      paymentMethods[label] = (paymentMethods[label] || 0) + cookieNumber(payment.amount);
    });
  });
  return {
    target,
    paid,
    owed,
    cases,
    boxes,
    totalBoxes: cases * 12 + boxes,
    chocolateCases,
    mintCases,
    surplusChocolateCases,
    surplusMintCases,
    unitCases,
    surplusCases,
    orderedCases,
    orderedValue,
    paymentMethods,
    percent: target ? Math.min(100, Math.round((paid / target) * 100)) : 0,
    outstanding: Math.max(target - paid, 0),
  };
}

function paymentMethodColor(method = "") {
  const normalized = method.toLowerCase();
  if (normalized.includes("square")) return "#2d6a9f";
  if (normalized.includes("cash")) return "#45a36f";
  return "#c45f30";
}

function cookiePaymentStackedBar(stats) {
  const target = Math.max(cookieNumber(stats.target), stats.paid, 1);
  const entries = Object.entries(stats.paymentMethods || {}).filter(([, amount]) => amount > 0);
  if (!entries.length) return `<div class="cookie-method-bar is-empty" title="No payments recorded yet"><span></span></div>`;
  return `
    <div class="cookie-method-bar" aria-label="Payments by method">
      ${entries.map(([method, amount]) => {
        const percent = Math.max(2, Math.min(100, (amount / target) * 100));
        return `<span style="width: ${percent}%; background: ${paymentMethodColor(method)};" title="${escapeAttr(`${method}: ${cookieMoney(amount)}`)}"></span>`;
      }).join("")}
    </div>
  `;
}

function cookieOrderCaseSummary(stats) {
  return `
    <div class="cookie-order-case-summary">
      <div><span>Chocolate/Vanilla</span><strong>${stats.chocolateCases}</strong><small>unit cases</small></div>
      <div><span>Mint</span><strong>${stats.mintCases}</strong><small>unit cases</small></div>
      <div><span>Surplus Chocolate/Vanilla</span><strong>${stats.surplusChocolateCases}</strong><small>cases</small></div>
      <div><span>Surplus Mint</span><strong>${stats.surplusMintCases}</strong><small>cases</small></div>
    </div>
  `;
}

function renderCookieOrderProgress() {
  const wrap = $("#cookieOrderProgress");
  if (!wrap) return;
  const activeOrders = activeCookieOrders();
  const archivedOrders = archivedCookieOrders();
  const activeMarkup = activeOrders.map((order) => {
    const stats = cookieOrderStats(order.id);
    return `
      <article class="cookie-order-card">
        <header>
          <div>
            <h3>${escapeHtml(order.name)}</h3>
            <p class="muted">${cookieMoney(stats.paid)} paid of ${cookieMoney(stats.target)} unit order cost</p>
          </div>
          <div class="inline-actions">
            <span class="tag">${stats.orderedCases} cases ordered</span>
            <button class="text-button" data-archive-cookie-order="${escapeAttr(order.id)}" type="button">Archive</button>
            <button class="text-button" data-remove-cookie-order="${escapeAttr(order.id)}" type="button">Remove</button>
          </div>
        </header>
        ${cookiePaymentStackedBar(stats)}
        <div class="cookie-order-progress-line">
          <span>${stats.percent}% paid</span>
          <span>${cookieMoney(stats.outstanding || Math.max(stats.target - stats.paid, 0))} remaining</span>
        </div>
        ${cookieOrderCaseSummary(stats)}
        <details class="cookie-order-edit">
          <summary>Edit order</summary>
          <div class="cookie-order-edit-grid">
            <label>Order name<input data-cookie-order-id="${escapeAttr(order.id)}" data-cookie-order-field="name" type="text" value="${escapeAttr(order.name)}" /></label>
            <label>$ amount<input data-cookie-order-id="${escapeAttr(order.id)}" data-cookie-order-field="totalCost" type="number" min="0" step="1" value="${escapeAttr(order.totalCost)}" /></label>
            <label>Chocolate/Vanilla cases<input data-cookie-order-id="${escapeAttr(order.id)}" data-cookie-order-field="chocolateCases" type="number" min="0" step="1" value="${escapeAttr(order.chocolateCases)}" /></label>
            <label>Mint cases<input data-cookie-order-id="${escapeAttr(order.id)}" data-cookie-order-field="mintCases" type="number" min="0" step="1" value="${escapeAttr(order.mintCases)}" /></label>
            <label>Surplus Chocolate/Vanilla<input data-cookie-order-id="${escapeAttr(order.id)}" data-cookie-order-field="surplusChocolateCases" type="number" min="0" step="1" value="${escapeAttr(order.surplusChocolateCases)}" /></label>
            <label>Surplus Mint<input data-cookie-order-id="${escapeAttr(order.id)}" data-cookie-order-field="surplusMintCases" type="number" min="0" step="1" value="${escapeAttr(order.surplusMintCases)}" /></label>
          </div>
        </details>
        <div class="cookie-order-stats">
          <span>Owed by families <strong>${cookieMoney(stats.owed)}</strong></span>
          <span>Picked up <strong>${stats.cases} cases + ${stats.boxes} boxes</strong></span>
          <span>Order value <strong>${cookieMoney(stats.orderedValue)}</strong></span>
        </div>
      </article>
    `;
  }).join("") || `<div class="empty-box">Add a cookie order to track unit progress.</div>`;

  const archivedMarkup = archivedOrders.length ? `
    <details class="cookie-archive-panel">
      <summary>Archived orders (${archivedOrders.length})</summary>
      <div class="cookie-archive-list">
        ${archivedOrders.map((order) => {
          const stats = cookieOrderStats(order.id);
          return `
            <article>
              <span><strong>${escapeHtml(order.name)}</strong> ${stats.orderedCases} cases, ${cookieMoney(stats.paid)} paid</span>
              <button class="text-button" data-unarchive-cookie-order="${escapeAttr(order.id)}" type="button">Restore</button>
            </article>
          `;
        }).join("")}
      </div>
    </details>
  ` : "";
  wrap.innerHTML = activeMarkup + archivedMarkup;
}

function cookieViewMode() {
  state.cookieTracker = state.cookieTracker || { rows: {}, orders: [], grocery: {} };
  state.cookieTracker.view = ["entry", "progress", "summary"].includes(state.cookieTracker.view) ? state.cookieTracker.view : "entry";
  return state.cookieTracker.view;
}

function selectedCookieKidId() {
  state.cookieTracker = state.cookieTracker || { rows: {}, orders: [], grocery: {} };
  const fallbackKid = sortedKids()[0];
  if (!fallbackKid) return "";
  if (!state.kids.some((kid) => kid.id === state.cookieTracker.selectedKidId)) {
    state.cookieTracker.selectedKidId = fallbackKid.id;
  }
  return state.cookieTracker.selectedKidId;
}

function renderCookieTotals() {
  const totals = state.kids.reduce((sum, kid) => {
    const summary = cookieRowSummary(cookieRowForKid(kid.id), { activeOnly: true });
    return {
      owed: sum.owed + summary.owed,
      paid: sum.paid + summary.paid,
      outstanding: sum.outstanding + summary.outstanding,
      cases: sum.cases + summary.cases,
      boxes: sum.boxes + summary.boxes,
    };
  }, { owed: 0, paid: 0, outstanding: 0, cases: 0, boxes: 0 });

  $("#cookieTotalOwed").textContent = cookieMoney(totals.owed);
  $("#cookieTotalPaid").textContent = cookieMoney(totals.paid);
  $("#cookieTotalOutstanding").textContent = cookieMoney(totals.outstanding);
  $("#cookieTotalCases").textContent = String(totals.cases);
  $("#cookieTotalBoxes").textContent = String(totals.boxes);
}

function cookieSummaryStatus(summary) {
  if (summary.paidInFull) return "Paid";
  if (summary.paid > 0) return "Partial payment";
  return "Not paid yet";
}

function updateCookieComputedDisplay(kidId) {
  const row = cookieRowForKid(kidId);
  const summary = cookieRowSummary(row);
  const rowElement = $(`[data-cookie-row="${CSS.escape(kidId)}"]`);
  if (!rowElement) {
    renderCookieTotals();
    return;
  }

  rowElement.classList.toggle("is-paid", summary.paidInFull);
  const values = {
    owed: cookieMoney(summary.owed),
    paid: cookieMoney(summary.paid),
    outstanding: cookieMoney(summary.outstanding),
    totalBoxes: `${summary.totalBoxes} boxes`,
    cases: String(summary.cases),
    boxes: String(summary.boxes),
    pickupCount: String(summary.pickupCount),
    paymentCount: String(summary.paymentCount),
    status: cookieSummaryStatus(summary),
  };
  Object.entries(values).forEach(([key, value]) => {
    rowElement.querySelectorAll(`[data-cookie-computed="${key}"]`).forEach((item) => {
      item.textContent = value;
    });
  });
  (row.pickups || []).forEach((pickup) => {
    const total = rowElement.querySelector(`[data-cookie-pickup-total="${CSS.escape(pickup.id)}"]`);
    if (total) total.textContent = cookieMoney(cookiePickupOwed(pickup));
  });
  renderCookieTotals();
  renderCookieOrderProgress();
}

function renderCookieTracker() {
  const mode = cookieViewMode();
  const select = $("#cookieKidSelect");
  if (select) {
    select.innerHTML = sortedKids().map((kid) => `<option value="${escapeAttr(kid.id)}">${escapeHtml(kid.name)}</option>`).join("");
    select.value = selectedCookieKidId();
  }
  $("#cookieEntryMode").classList.toggle("is-selected", mode === "entry");
  $("#cookieProgressMode").classList.toggle("is-selected", mode === "progress");
  $("#cookieSummaryMode").classList.toggle("is-selected", mode === "summary");
  const entryControls = $(".cookie-entry-controls");
  const cookieHelp = $(".cookie-help");
  const progressPanel = $("#cookieProgressPanel");
  entryControls.hidden = mode !== "entry";
  cookieHelp.hidden = mode !== "entry";
  progressPanel.hidden = mode !== "progress";
  entryControls.classList.toggle("hidden", mode !== "entry");
  cookieHelp.classList.toggle("hidden", mode !== "entry");
  progressPanel.classList.toggle("hidden", mode !== "progress");

  if (mode === "summary") {
    renderCookieSummaryView();
  } else if (mode === "progress") {
    $("#cookieRows").innerHTML = "";
  } else {
    const kid = state.kids.find((item) => item.id === selectedCookieKidId());
    $("#cookieRows").innerHTML = kid ? renderCookieEntryRow(kid) : emptyState("Add Embers to build the cookie tracker.");
  }
  renderCookieTotals();
  renderCookieOrderProgress();
}

function renderCookieEntryRow(kid) {
    const row = cookieRowForKid(kid.id);
    const summary = cookieRowSummary(row, { activeOnly: true });
    const activePickups = (row.pickups || []).filter((pickup) => cookieOrderIsActive(pickup.orderId));
    const activePayments = (row.payments || []).filter((payment) => cookieOrderIsActive(payment.orderId));
    return `
      <article class="cookie-ember-row cookie-entry-row ${summary.paidInFull ? "is-paid" : ""}" data-cookie-row="${escapeAttr(kid.id)}">
        <div class="cookie-ember-summary" data-cookie-entry-summary>
          <span>
            <span class="cookie-ember-name">${escapeHtml(kid.name)}</span>
            <span class="cookie-ember-meta">${escapeHtml(kid.patrol || "No patrol")}</span>
          </span>
          <span class="cookie-compact-total" data-cookie-computed="totalBoxes">${summary.totalBoxes} boxes</span>
          <span class="cookie-amount-due">Outstanding <strong data-cookie-computed="outstanding">${cookieMoney(summary.outstanding)}</strong></span>
          <span class="cookie-status" data-cookie-computed="status">${cookieSummaryStatus(summary)}</span>
        </div>
        <div class="cookie-ember-details">
          <div class="cookie-payment-panel">
            <div><span class="small-note">Amount owed</span><strong data-cookie-computed="owed">${cookieMoney(summary.owed)}</strong></div>
            <div><span class="small-note">Paid</span><strong data-cookie-computed="paid">${cookieMoney(summary.paid)}</strong></div>
            <div><span class="small-note">Outstanding</span><strong data-cookie-computed="outstanding">${cookieMoney(summary.outstanding)}</strong></div>
          </div>
          <div class="cookie-entry-form-grid">
            <form class="cookie-quick-form cookie-pickup-form" data-cookie-pickup-form data-cookie-kid-id="${escapeAttr(kid.id)}">
              <div class="cookie-form-heading">
                <h3>Add pickup</h3>
                <span>Cookies sent home</span>
              </div>
              <div class="cookie-field-grid">
                <label>Pick up date<input name="date" type="date" value="${today()}" /></label>
                <label>Order<select name="orderId">${cookieOrderOptions(activeCookieOrders()[0]?.id || "")}</select></label>
                <label>Flavour<select name="flavor">${COOKIE_FLAVORS.map((flavor) => `<option value="${escapeAttr(flavor)}">${escapeHtml(flavor)}</option>`).join("")}</select></label>
                <label>Cases<input name="cases" type="number" min="0" step="1" value="0" /></label>
                <label>Boxes<input name="boxes" type="number" min="0" step="1" value="0" /></label>
                <label class="wide-field">Notes<input name="notes" type="text" placeholder="Optional note" /></label>
              </div>
              <button class="primary-button" type="submit">Save pickup</button>
            </form>
            <form class="cookie-quick-form cookie-payment-form" data-cookie-payment-form data-cookie-kid-id="${escapeAttr(kid.id)}">
              <div class="cookie-form-heading">
                <h3>Add payment</h3>
                <span>Money received</span>
              </div>
              <div class="cookie-field-grid">
                <label>Payment date<input name="date" type="date" value="${today()}" /></label>
                <label>Order<select name="orderId">${cookieOrderOptions(activeCookieOrders()[0]?.id || "")}</select></label>
                <label>$ amount<input name="amount" type="number" min="0" step="1" placeholder="0" /></label>
                <label>Method<select name="method">${COOKIE_PAYMENT_METHODS.map((method) => `<option value="${escapeAttr(method)}">${escapeHtml(method || "Choose method")}</option>`).join("")}</select></label>
                <label>Other method<input name="methodOther" type="text" placeholder="If Other" /></label>
                <label class="wide-field">Notes<input name="notes" type="text" placeholder="Optional note" /></label>
              </div>
              <button class="primary-button" type="submit">Save payment</button>
            </form>
          </div>
          <section class="cookie-record-ledger">
            <div class="cookie-detail-heading">
              <div>
                <h3>Records</h3>
                <p class="muted">Saved pickups and payments for ${escapeHtml(kid.name)}.</p>
              </div>
            </div>
            ${cookieRecordTable(kid, activePickups, activePayments)}
          </section>
        </div>
      </article>
    `;
}

function cookieOrderName(orderId = "") {
  if (!orderId) return "No order";
  return cookieOrders().find((order) => order.id === orderId)?.name || "Removed order";
}

function cookieRecordTable(kid, pickups = [], payments = []) {
  const records = [
    ...pickups.map((pickup) => ({
      type: "Pickup",
      date: pickup.date || "",
      order: cookieOrderName(pickup.orderId),
      details: `${pickup.flavor || "Mint"} - ${cookieNumber(pickup.cases)} cases, ${cookieNumber(pickup.boxes)} boxes`,
      amount: cookieMoney(cookiePickupOwed(pickup)),
      notes: pickup.notes || "",
      action: `<button class="text-button" data-cookie-remove-pickup="${escapeAttr(pickup.id)}" data-cookie-kid-id="${escapeAttr(kid.id)}" type="button">Remove</button>`,
    })),
    ...payments.map((payment) => ({
      type: "Payment",
      date: payment.date || "",
      order: cookieOrderName(payment.orderId),
      details: cookiePaymentMethodLabel(payment),
      amount: cookieMoney(payment.amount || 0),
      notes: payment.notes || "",
      action: `<button class="text-button" data-cookie-remove-payment="${escapeAttr(payment.id)}" data-cookie-kid-id="${escapeAttr(kid.id)}" type="button">Remove</button>`,
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!records.length) return `<div class="empty-box">No pickup or payment records yet.</div>`;
  return `
    <div class="cookie-record-table-wrap">
      <table class="cookie-record-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Order</th>
            <th>Details</th>
            <th>Amount</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${records.map((record) => `
            <tr class="cookie-record-${record.type.toLowerCase()}">
              <td>${escapeHtml(formatDate(record.date) || "")}</td>
              <td><span class="cookie-entry-type">${escapeHtml(record.type)}</span></td>
              <td>${escapeHtml(record.order)}</td>
              <td>${escapeHtml(record.details)}</td>
              <td><strong>${escapeHtml(record.amount)}</strong></td>
              <td>${escapeHtml(record.notes)}</td>
              <td>${record.action}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCookieSummaryView() {
  $("#cookieRows").innerHTML = `
    <div class="badge-matrix-wrap cookie-matrix-wrap" role="region" aria-label="Cookie tracker spreadsheet">
      <table class="badge-matrix cookie-matrix">
        <thead>
          <tr>
            <th class="sticky-col ember-col">Ember</th>
            <th>Patrol</th>
            <th>Pickups</th>
            <th>Cases</th>
            <th>Boxes</th>
            <th>Cookies out</th>
            <th>By order</th>
            <th>Owed</th>
            <th>Payments</th>
            <th>Paid</th>
            <th>Outstanding</th>
            <th>Notes</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          ${sortedKids().map((kid) => {
            const row = cookieRowForKid(kid.id);
            const summary = cookieRowSummary(row, { activeOnly: true });
            const paymentNotes = (row.payments || []).map((payment) => payment.notes).filter(Boolean).join("; ");
            const byOrder = activeCookieOrders()
              .map((order) => {
                const boxes = (row.pickups || [])
                  .filter((pickup) => pickup.orderId === order.id)
                  .reduce((sum, pickup) => sum + cookieNumber(pickup.cases) * 12 + cookieNumber(pickup.boxes), 0);
                return boxes ? `${order.name}: ${boxes}` : "";
              })
              .filter(Boolean)
              .join("; ");
            return `
              <tr class="${summary.paidInFull ? "is-paid" : ""}" data-cookie-row="${escapeAttr(kid.id)}">
                <th class="sticky-col ember-col" scope="row">${escapeHtml(kid.name)}</th>
                <td>${escapeHtml(kid.patrol || "")}</td>
                <td data-cookie-computed="pickupCount">${summary.pickupCount}</td>
                <td data-cookie-computed="cases">${summary.cases}</td>
                <td data-cookie-computed="boxes">${summary.boxes}</td>
                <td data-cookie-computed="totalBoxes">${summary.totalBoxes} boxes</td>
                <td>${escapeHtml(byOrder || "No order")}</td>
                <td data-cookie-computed="owed">${cookieMoney(summary.owed)}</td>
                <td data-cookie-computed="paymentCount">${summary.paymentCount}</td>
                <td data-cookie-computed="paid">${cookieMoney(summary.paid)}</td>
                <td data-cookie-computed="outstanding">${cookieMoney(summary.outstanding)}</td>
                <td>${escapeHtml(paymentNotes)}</td>
                <td><button class="text-button" data-cookie-open-kid="${escapeAttr(kid.id)}" type="button">Open</button></td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="13">${emptyState("Add Embers to build the cookie tracker.")}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function cookieRemovalDetails(type, kidId = "", itemId = "") {
  if (type === "pickup") {
    const kid = state.kids.find((item) => item.id === kidId);
    return {
      title: "Remove cookie pickup?",
      message: `This will remove this pickup row${kid ? ` for ${kid.name}` : ""} and update the owed totals.`,
    };
  }
  if (type === "payment") {
    const kid = state.kids.find((item) => item.id === kidId);
    return {
      title: "Remove cookie payment?",
      message: `This will remove this payment row${kid ? ` for ${kid.name}` : ""} and update the paid/outstanding totals.`,
    };
  }
  const order = cookieOrders().find((item) => item.id === itemId);
  return {
    title: "Remove cookie order?",
    message: `This will remove ${order?.name || "this cookie order"} from Progress and clear that order selection from existing pickup/payment rows.`,
  };
}

function openCookieRemoveModal(type, kidId = "", itemId = "") {
  const details = cookieRemovalDetails(type, kidId, itemId);
  $("#removeCookieType").value = type;
  $("#removeCookieKidId").value = kidId;
  $("#removeCookieItemId").value = itemId;
  $("#removeCookieTitle").textContent = details.title;
  $("#removeCookieMessage").textContent = details.message;
  $("#removeCookieModal").hidden = false;
}

function closeCookieRemoveModal() {
  $("#removeCookieType").value = "";
  $("#removeCookieKidId").value = "";
  $("#removeCookieItemId").value = "";
  $("#removeCookieModal").hidden = true;
}

function removeCookieItem(type, kidId, itemId) {
  if (type === "pickup") {
    const row = cookieRowForKid(kidId);
    row.pickups = row.pickups.filter((pickup) => pickup.id !== itemId);
    return "Cookie pickup removed.";
  }
  if (type === "payment") {
    const row = cookieRowForKid(kidId);
    row.payments = row.payments.filter((payment) => payment.id !== itemId);
    return "Cookie payment removed.";
  }
  state.cookieTracker.orders = cookieOrders().filter((order) => order.id !== itemId);
  state.kids.forEach((kid) => {
    const row = cookieRowForKid(kid.id);
    (row.pickups || []).forEach((pickup) => {
      if (pickup.orderId === itemId) pickup.orderId = "";
    });
    (row.payments || []).forEach((payment) => {
      if (payment.orderId === itemId) payment.orderId = "";
    });
  });
  return "Cookie order removed.";
}

function handleCookieTrackerInput(event) {
  const pickupInput = event.target.closest("[data-cookie-kid-id][data-cookie-pickup-id][data-cookie-pickup-field]");
  if (pickupInput) {
    const row = cookieRowForKid(pickupInput.dataset.cookieKidId);
    const pickup = row.pickups.find((item) => item.id === pickupInput.dataset.cookiePickupId);
    if (!pickup) return;
    const field = pickupInput.dataset.cookiePickupField;
    pickup[field] = ["cases", "boxes"].includes(field) ? cookieNumber(pickupInput.value) : pickupInput.value;
    saveState();
    if (field === "orderId") {
      renderCookieTracker();
      return;
    }
    updateCookieComputedDisplay(pickupInput.dataset.cookieKidId);
    return;
  }

  const paymentInput = event.target.closest("[data-cookie-kid-id][data-cookie-payment-id][data-cookie-payment-field]");
  if (!paymentInput) return;
  const row = cookieRowForKid(paymentInput.dataset.cookieKidId);
  const payment = row.payments.find((item) => item.id === paymentInput.dataset.cookiePaymentId);
  if (!payment) return;
  const field = paymentInput.dataset.cookiePaymentField;
  payment[field] = field === "amount" ? cookieNumber(paymentInput.value) : field === "method" ? normalizeCookiePaymentMethod(paymentInput.value) : paymentInput.value;
  saveState();
  if (field === "orderId" || field === "method") {
    renderCookieTracker();
    return;
  }
  updateCookieComputedDisplay(paymentInput.dataset.cookieKidId);
}

function handleCookieOrderInput(event) {
  const input = event.target.closest("[data-cookie-order-id][data-cookie-order-field]");
  if (!input) return;
  const order = cookieOrders().find((item) => item.id === input.dataset.cookieOrderId);
  if (!order) return;
  const field = input.dataset.cookieOrderField;
  order[field] = field === "name" ? input.value : cookieNumber(input.value);
  saveState();
  renderCookieTotals();
  renderCookieOrderProgress();
}

function loadPlanIntoForm(plan) {
  $("#planningEditId").value = plan.id;
  $("#planningDate").value = plan.date || today();
  $("#planningTitle").value = plan.title || "";
  $("#planningNotes").value = plan.notes || "";
  $("#planningBadgeSearch").value = "";
  planningBadgeSelection = new Set(plan.badgeIds || []);
  planningBadgeCredits = new Map(Object.entries(badgeCreditsForIds(plan.badgeIds || [], plan.badgeCredits || {})));
  planningActivities = Array.isArray(plan.activities) ? [...plan.activities] : [];
  selectedPlanningPlanId = plan.id;
  selectedPlanningEventId = "";
  selectedPlanningDate = "";
  planningCalendarCursor = startOfMonth(new Date(`${plan.date || today()}T12:00:00`));
  renderPlanningBadges();
  renderPlanningActivityPlanner();
  renderPlanningCalendar();
  switchTab("planning");
}

function renderKidBadgeFilter() {
  const select = $("#kidBadgeFilter");
  if (!select) return;
  const current = select.value || "all";
  select.innerHTML = [
    `<option value="all">All Embers</option>`,
    ...state.kids.map((kid) => `<option value="${escapeAttr(kid.id)}">${escapeHtml(kid.name)}${kid.patrol ? ` - ${escapeHtml(kid.patrol)}` : ""}</option>`),
  ].join("");
  select.value = state.kids.some((kid) => kid.id === current) ? current : "all";
}

function renderKidBadgeModeControls() {
  $("#kidBadgeProgressToggle")?.classList.toggle("is-active", kidBadgeMode === "progress");
  $("#kidBadgeSummaryToggle")?.classList.toggle("is-active", kidBadgeMode === "summary");
  $("#kidBadgeHandoutToggle")?.classList.toggle("is-active", kidBadgeMode === "handouts");
  if ($("#kidBadgeConfirmationToggle")) $("#kidBadgeConfirmationToggle").checked = badgeEditConfirmationEnabled();
}

function badgeEditConfirmationEnabled() {
  return state.settings?.badgeEditConfirmation !== false;
}

function visibleKidBadgeRows() {
  const selectedKidId = $("#kidBadgeFilter")?.value || "all";
  return [...state.kids]
    .filter((kid) => selectedKidId === "all" || kid.id === selectedKidId)
    .sort(compareKidsForBadges);
}

function summaryBadgesForKids(kids) {
  return [...state.badges]
    .filter((badge) => kids.some((kid) => badgeProgress(kid.id, badge).earned))
    .sort(compareBadges);
}

function renderKidBadges() {
  renderKidBadgeFilter();
  renderKidBadgeModeControls();
  const kids = visibleKidBadgeRows();
  const summaryMode = kidBadgeMode === "summary";
  const handoutMode = kidBadgeMode === "handouts";
  const badges = handoutMode ? summaryBadgesForKids(kids) : [...state.badges].sort(compareBadges);

  if (!kids.length) {
    $("#kidBadgeCards").innerHTML = emptyState("No Embers to show.");
    return;
  }

  if (handoutMode && !badges.length) {
    $("#kidBadgeCards").innerHTML = emptyState("No earned badges to hand out yet.");
    return;
  }

  $("#kidBadgeCards").innerHTML = `
    <div class="badge-matrix-wrap" role="region" aria-label="${handoutMode ? "Badge handout tracking table" : summaryMode ? "Earned Ember badge summary table" : "Ember badge progress table"}">
      <table class="badge-matrix ${summaryMode ? "is-summary" : ""} ${handoutMode ? "is-handout" : ""}">
        <thead>
          <tr>
            <th class="sticky-col ember-col">Ember</th>
            <th class="patrol-col">Patrol</th>
            ${badges.map((badge) => `
              <th class="${isProgramAreaBadge(badge) ? "program-area-col" : ""}" style="--category-fill: ${categoryTheme(badge.area).fill}; --category-accent: ${categoryTheme(badge.area).accent};">
                <img src="${badgeImageSrc(badge)}" alt="" />
                <span>${escapeHtml(badge.name)}</span>
                <small>${escapeHtml(badge.area || "No area")}</small>
              </th>
            `).join("")}
          </tr>
        </thead>
        <tbody>
          ${kids.map((kid) => `
            <tr>
              <th class="sticky-col ember-col" scope="row">${escapeHtml(kid.name)}</th>
              <td class="patrol-col">${escapeHtml(kid.patrol || "")}</td>
              ${badges.map((badge) => {
                const progress = badgeProgress(kid.id, badge);
                const cellClass = [
                  progress.earned ? "is-earned" : "",
                  summaryMode && progress.earned ? "summary-earned-cell" : "",
                  summaryMode && !progress.earned ? "summary-empty-cell" : "",
                  isProgramAreaBadge(badge) ? "program-area-col" : "",
                ].filter(Boolean).join(" ");
                return `<td class="${cellClass}" style="--category-fill: ${categoryTheme(badge.area).fill}; --category-accent: ${categoryTheme(badge.area).accent};">${handoutMode ? badgeHandoutCell(kid, badge, progress) : summaryMode ? badgeSummaryCell(progress) : badgeMatrixCell(kid, badge, progress)}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function badgeSummaryCell(progress) {
  return progress.earned ? `<span class="summary-earned-label">Earned</span>` : `<span class="summary-blank-label"></span>`;
}

function badgeHandoutCell(kid, badge, progress) {
  if (!progress.earned) return `<span class="summary-blank-label">-</span>`;
  const checked = badgeHandedOut(kid.id, badge.id);
  return `
    <label class="handout-check ${checked ? "is-handed-out" : ""}">
      <input
        type="checkbox"
        ${checked ? "checked" : ""}
        data-handout-kid-id="${escapeAttr(kid.id)}"
        data-handout-badge-id="${escapeAttr(badge.id)}"
        aria-label="${escapeAttr(`${kid.name} ${badge.name} handed out`)}"
      />
      <span>${checked ? "Given" : "To give"}</span>
    </label>
  `;
}

function badgeMatrixScrollState() {
  const wrap = $(".badge-matrix-wrap");
  return wrap ? { left: wrap.scrollLeft, top: wrap.scrollTop, pageX: window.scrollX, pageY: window.scrollY } : null;
}

function restoreBadgeMatrixScroll(stateSnapshot) {
  if (!stateSnapshot) return;
  requestAnimationFrame(() => {
    const wrap = $(".badge-matrix-wrap");
    if (wrap) {
      wrap.scrollLeft = stateSnapshot.left;
      wrap.scrollTop = stateSnapshot.top;
    }
    window.scrollTo(stateSnapshot.pageX, stateSnapshot.pageY);
  });
}

function renderKidBadgesKeepingPosition() {
  const scrollState = badgeMatrixScrollState();
  renderKidBadges();
  restoreBadgeMatrixScroll(scrollState);
}

function patrolPointsScrollState() {
  const wrap = $("#patrolPointsSheet .badge-matrix-wrap");
  return wrap ? { left: wrap.scrollLeft, top: wrap.scrollTop, pageX: window.scrollX, pageY: window.scrollY } : null;
}

function restorePatrolPointsScroll(stateSnapshot) {
  if (!stateSnapshot) return;
  requestAnimationFrame(() => {
    const wrap = $("#patrolPointsSheet .badge-matrix-wrap");
    if (wrap) {
      wrap.scrollLeft = stateSnapshot.left;
      wrap.scrollTop = stateSnapshot.top;
    }
    window.scrollTo(stateSnapshot.pageX, stateSnapshot.pageY);
  });
}

function renderPatrolPointsSheetKeepingPosition() {
  const scrollState = patrolPointsScrollState();
  renderPatrolPointsSheet();
  restorePatrolPointsScroll(scrollState);
}

function badgeMatrixCell(kid, badge, progress) {
  if (isCriteriaBadge(badge)) return badgeCriteriaCell(kid, badge, progress);
  const max = progress.displayMax || progress.needed;
  return `
    <label class="matrix-count-editor ${manualBadgeAdjustment(kid.id, badge.id) ? "is-manual" : ""}">
      <input
        type="number"
        min="0"
        max="${escapeAttr(max)}"
        step="1"
        value="${escapeAttr(progress.completedCount)}"
        data-manual-kid-id="${escapeAttr(kid.id)}"
        data-manual-badge-id="${escapeAttr(badge.id)}"
        aria-label="${escapeAttr(`${kid.name} ${badge.name} progress`)}"
      />
      <span>/${escapeHtml(max)}</span>
    </label>
    ${progress.earned ? `<small class="matrix-earned-label">Earned</small>` : ""}
  `;
}

function badgeCriteriaCell(kid, badge, progress) {
  const selected = new Set(selectedCriteriaIds(kid.id, badge));
  const baseline = new Set(baselineRequirementIdsForKidBadge(kid.id, badge.id));
  const max = progress.displayMax || badge.requirements.length || progress.needed;
  return `
    <details class="criteria-badge-cell ${progress.earned ? "is-earned" : ""}">
      <summary>
        <span>${escapeHtml(progress.completedCount)}/${escapeHtml(max)}</span>
        ${progress.earned ? `<small>Earned</small>` : `<small>${escapeHtml(progress.needed)} needed</small>`}
      </summary>
      <div class="criteria-check-list">
        <div class="criteria-list-title">
          <strong>${escapeHtml(kid.name)}</strong>
          <span>${escapeHtml(badge.name)}</span>
        </div>
        ${(badge.requirements || []).map((requirement) => `
          <label class="criteria-check-row ${baseline.has(requirement.id) ? "is-baseline" : ""}">
            <input
              type="checkbox"
              data-criteria-kid-id="${escapeAttr(kid.id)}"
              data-criteria-badge-id="${escapeAttr(badge.id)}"
              data-criteria-requirement-id="${escapeAttr(requirement.id)}"
              aria-label="${escapeAttr(`${kid.name} ${badge.name}: ${requirement.title}`)}"
              ${selected.has(requirement.id) ? "checked" : ""}
            />
            <span>${escapeHtml(requirement.title)}</span>
          </label>
        `).join("")}
      </div>
    </details>
  `;
}

function badgeKnowledgeThemes() {
  return Array.isArray(window.EMBER_BADGE_KNOWLEDGE?.themes) ? window.EMBER_BADGE_KNOWLEDGE.themes : [];
}

function knowledgeForBadge(badge) {
  const name = badge.name.trim().toLowerCase();
  return badgeKnowledgeThemes().find((theme) => theme.theme.trim().toLowerCase() === name);
}

function normalizeTokens(text) {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "they", "them", "were", "from", "into", "about", "what", "could", "should", "would", "today", "event", "events", "badge", "badges", "activity", "activities"]);
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stop.has(token));
}

function badgeGroupStats(badge) {
  const rows = state.kids.map((kid) => badgeProgress(kid.id, badge));
  const earned = rows.filter((progress) => progress.earned).length;
  const inProgress = rows.filter((progress) => !progress.earned && progress.completedCount > 0).length;
  const remaining = rows.reduce((sum, progress) => sum + Math.max(0, progress.needed - Math.min(progress.completedCount, progress.needed)), 0);
  const avgPercent = rows.length ? Math.round(rows.reduce((sum, progress) => sum + progress.percent, 0) / rows.length) : 0;
  return {
    earned,
    inProgress,
    remaining,
    avgPercent,
    needCount: Math.max(0, state.kids.length - earned),
  };
}

function chatBadgeCandidates(prompt) {
  const promptLower = prompt.toLowerCase();
  const queryTokens = new Set(normalizeTokens(prompt));
  const planning = /\b(plan|idea|ideas|could do|should do|need|towards|toward|work on)\b/i.test(prompt);
  const candidates = state.badges
    .filter((badge) => !isProgramAreaBadge(badge))
    .map((badge) => {
      const knowledge = knowledgeForBadge(badge);
      const stats = badgeGroupStats(badge);
      const activities = knowledge?.activities || [];
      const topics = knowledge?.topics || [];
      const haystackParts = [
        badge.name,
        badge.area,
        ...(badge.requirements || []).map((requirement) => requirement.title),
        ...(knowledge ? [knowledge.description, ...topics, ...activities] : []),
      ];
      const haystack = haystackParts.join(" ").toLowerCase();
      const tokenHits = [...queryTokens].filter((token) => haystack.includes(token));
      const matchedActivities = activities
        .filter((activity) => {
          const lower = activity.toLowerCase();
          return promptLower.includes(lower) || normalizeTokens(activity).some((token) => queryTokens.has(token));
        })
        .slice(0, 5);
      let score = tokenHits.length;
      if (promptLower.includes(badge.name.toLowerCase())) score += 8;
      if (promptLower.includes(String(badge.area || "").toLowerCase())) score += 3;
      score += matchedActivities.length * 3;
      if (planning && stats.needCount) score += 1.5;
      if (planning && stats.inProgress) score += 1;
      if (isCustomBadge(badge) && !knowledge && score) score += 1;
      return { badge, knowledge, stats, score, tokenHits, matchedActivities };
    })
    .filter((row) => row.score > 0);

  if (candidates.length) {
    return candidates.sort((a, b) => b.score - a.score || b.stats.inProgress - a.stats.inProgress || b.stats.needCount - a.stats.needCount || compareBadges(a.badge, b.badge)).slice(0, 6);
  }

  return state.badges
    .filter((badge) => !isProgramAreaBadge(badge))
    .map((badge) => ({ badge, knowledge: knowledgeForBadge(badge), stats: badgeGroupStats(badge), score: 0, tokenHits: [], matchedActivities: [] }))
    .sort((a, b) => b.stats.inProgress - a.stats.inProgress || b.stats.needCount - a.stats.needCount || compareBadges(a.badge, b.badge))
    .slice(0, 6);
}

function chatActivityIdeas(candidate) {
  const activities = candidate.knowledge?.activities || candidate.badge.requirements.map((requirement) => requirement.title);
  if (!activities.length) return [];
  const promptTokens = new Set(candidate.tokenHits);
  const sorted = [...activities].sort((a, b) => {
    const aHits = normalizeTokens(a).filter((token) => promptTokens.has(token)).length;
    const bHits = normalizeTokens(b).filter((token) => promptTokens.has(token)).length;
    return bHits - aHits || a.localeCompare(b);
  });
  return sorted.slice(0, 4);
}

function chatResponseHtml(prompt) {
  const candidates = chatBadgeCandidates(prompt);
  const planning = /\b(plan|idea|ideas|could do|should do|need|towards|toward|work on)\b/i.test(prompt);
  const improving = /\b(improve|better|adapt|recommend|recommendation|suggest|change|more fun|make it|extend|simplify)\b/i.test(prompt);
  const source = window.EMBER_BADGE_KNOWLEDGE?.source?.programIndex || "Program Index";
  if (!candidates.length) {
    return `
      <p>I do not have a strong badge match yet, but I can still help shape the activity.</p>
      <p>Try adding the goal, supplies, location, or what the Embers will actually do. Then I can suggest possible badge fits and ways to make it easier to log.</p>
      <p class="muted">For badge credit, log it only for Embers marked present once the meeting happens.</p>
    `;
  }
  return `
    <p><strong>Best matches from ${escapeHtml(source)}:</strong></p>
    <div class="chat-match-list">
      ${candidates.slice(0, 4).map((candidate) => {
        const ideas = chatActivityIdeas(candidate);
        const matched = candidate.matchedActivities.length ? candidate.matchedActivities : ideas.slice(0, 2);
        return `
          <article class="chat-match">
            <header>
              <strong>${escapeHtml(candidate.badge.name)}</strong>
              <span>${escapeHtml(candidate.badge.area || "No area")}</span>
            </header>
            <p>${candidate.stats.needCount} Embers still need this. ${candidate.stats.inProgress ? `${candidate.stats.inProgress} already have progress.` : "No one has progress yet."}</p>
            ${matched.length ? `<div class="tag-row">${matched.map((activity) => `<span class="tag">${escapeHtml(activity)}</span>`).join("")}</div>` : ""}
            ${ideas.length && planning ? `<p class="muted">Ideas: ${ideas.map(escapeHtml).join("; ")}</p>` : ""}
            ${ideas.length && improving ? `<p class="muted">To strengthen it: add a quick choice, a hands-on piece, and a short reflection so it is clearer why this badge counts.</p>` : ""}
          </article>
        `;
      }).join("")}
    </div>
    <p class="muted">To count it, submit attendance, confirm the matching badge tiles, and complete the meeting for the Embers who should receive credit. If you are planning ahead, save it in Planning first; it will show on the calendar without adding badge credit.</p>
  `;
}

function textFromHtml(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  return wrap.textContent.trim();
}

function plainTextToHtml(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return `<p>I could not build a response yet. Try adding a few more details about the activity.</p>`;
  return normalized
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function chatOpenAiContext(prompt, conversation = chatHistory.slice(-10)) {
  const candidates = chatBadgeCandidates(prompt).slice(0, 8);
  const selectedBadges = [...selectedMeetingBadgeIds]
    .map((id) => state.badges.find((badge) => badge.id === id))
    .filter(Boolean)
    .map((badge) => ({ name: badge.name, area: badge.area, activitiesThisSession: selectedMeetingBadgeCredits.get(badge.id) || 1 }));
  return {
    prompt,
    meeting: {
      date: $("#meetingDate")?.value || today(),
      title: $("#meetingTitle")?.value.trim() || "",
      notes: $("#meetingNotes")?.value.trim() || "",
      selectedBadges,
    },
    conversation,
    plannedMeetings: (state.weeklyPlans || []).slice(-8).map((plan) => ({
      date: plan.date,
      title: plan.title,
      notes: plan.notes,
      badges: (plan.badgeIds || [])
        .map((id) => state.badges.find((badge) => badge.id === id))
        .filter(Boolean)
        .map((badge) => ({ name: badge.name, area: badge.area, activitiesPlanned: plan.badgeCredits?.[badge.id] || 1 })),
    })),
    group: {
      emberCount: state.kids.length,
      patrols: patrolNames(),
    },
    rules: window.EMBER_BADGE_KNOWLEDGE?.rules || [],
    availableBadgeAreas: [...new Set(state.badges.map((badge) => badge.area).filter(Boolean))],
    badgeMatches: candidates.map(({ badge, knowledge, stats, matchedActivities }) => ({
      name: badge.name,
      area: badge.area,
      earning: badgeEarnLabel(badge),
      currentGroupProgress: stats,
      topics: knowledge?.topics || [],
      matchingActivities: matchedActivities,
      sourceActivities: (knowledge?.activities || badge.requirements.map((requirement) => requirement.title)).slice(0, 18),
    })),
  };
}

async function openAiChatAnswer(prompt, conversation) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chatOpenAiContext(prompt, conversation)),
  });
  if (!response.ok) throw new Error(`OpenAI chat failed: ${response.status}`);
  const data = await response.json();
  if (!data.answer) throw new Error("OpenAI chat returned no answer.");
  return data.answer;
}

function appendChatMessage(role, html) {
  const wrap = $("#chatMessages");
  const article = document.createElement("article");
  article.className = `chat-message is-${role}`;
  article.innerHTML = html;
  wrap.append(article);
  wrap.scrollTop = wrap.scrollHeight;
  return article;
}

function resetChatMessages() {
  chatHistory = [];
  $("#chatMessages").innerHTML = "";
  appendChatMessage("assistant", `<p>Tell me what you are planning or what happened at a meeting. I can suggest badge fits, improve the activity, adapt it for Embers, or help plan next steps.</p>`);
}

function renderChatBadgeNeeds() {
  const wrap = $("#chatBadgeNeeds");
  if (!wrap) return;
  const rows = state.badges
    .filter((badge) => !isProgramAreaBadge(badge))
    .map((badge) => ({ badge, stats: badgeGroupStats(badge) }))
    .filter((row) => row.stats.needCount > 0)
    .sort((a, b) => b.stats.inProgress - a.stats.inProgress || b.stats.avgPercent - a.stats.avgPercent || compareBadges(a.badge, b.badge))
    .slice(0, 10);
  wrap.innerHTML = rows.map(({ badge, stats }) => `
    <article class="stack-item">
      <header>
        <div>
          <h3>${escapeHtml(badge.name)}</h3>
          <p class="muted">${escapeHtml(badge.area || "No area")} - ${stats.needCount} need it</p>
        </div>
        <span class="tag">${stats.avgPercent}%</span>
      </header>
      ${progressBar(stats.avgPercent)}
    </article>
  `).join("") || emptyState("All visible badges are earned.");
}

function patrolNames() {
  const names = [...new Set(state.kids.map((kid) => kid.patrol).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return names.length ? names : ["Lares", "Elves", "Sprites", "Fairies"];
}

function rankLabel(index) {
  return ["1st", "2nd", "3rd"][index] || `${index + 1}th`;
}

function normalizePatrolSpendEntry(entry = {}) {
  return {
    id: entry.id || uid("patrol-spend"),
    kidId: entry.kidId || "",
    date: entry.date || today(),
    amount: Math.max(0, Number(entry.amount) || 0),
    note: entry.note || "",
  };
}

function currentPatrolPointValues() {
  const values = {};
  $$("#patrolPointInputs input[data-patrol-kid-id]").forEach((input) => {
    const kid = state.kids.find((item) => item.id === input.dataset.patrolKidId);
    const patrol = kid?.patrol || "No patrol";
    values[patrol] = (values[patrol] || 0) + (Number(input.value) || 0);
  });
  return values;
}

function savedPatrolTotals() {
  const totals = Object.fromEntries(patrolNames().map((name) => [name, 0]));
  state.meetings.forEach((meeting) => {
    Object.entries(meeting.patrolPoints || {}).forEach(([name, value]) => {
      totals[name] = (totals[name] || 0) + (Number(value) || 0);
    });
  });
  return totals;
}

function collectPatrolPoints() {
  return currentPatrolPointValues();
}

function collectEmberPoints() {
  return Object.fromEntries(
    $$("#patrolPointInputs input[data-patrol-kid-id]")
      .map((input) => [input.dataset.patrolKidId, Number(input.value) || 0])
      .filter(([, value]) => value > 0)
  );
}

function renderPatrolPoints() {
  const inputWrap = $("#patrolPointInputs");
  if (!inputWrap) return;
  const groups = new Map();
  sortedKids().forEach((kid) => {
    const patrol = kid.patrol || "No patrol";
    if (!groups.has(patrol)) groups.set(patrol, []);
    groups.get(patrol).push(kid);
  });
  const groupOrder = [...groups.keys()].sort((a, b) => {
    if (a === "No patrol") return 1;
    if (b === "No patrol") return -1;
    return a.localeCompare(b);
  });
  inputWrap.innerHTML = groupOrder.map((patrol) => {
    const kids = groups.get(patrol) || [];
    return `
      <article class="patrol-point-group">
        <header>
          <strong>${escapeHtml(patrol)}</strong>
          <span>${kids.length} ${kids.length === 1 ? "Ember" : "Embers"}</span>
        </header>
        <div class="patrol-ember-points">
          ${kids.map((kid) => `
            <label class="patrol-point-input">
              <span>${escapeHtml(kid.name)}</span>
              <input type="number" min="0" step="1" value="0" data-patrol-kid-id="${escapeAttr(kid.id)}" aria-label="${escapeAttr(`${kid.name} patrol points`)}" />
            </label>
          `).join("")}
        </div>
      </article>
    `;
  }).join("") || emptyState("Add Embers to track patrol points.");
  renderPatrolPointTotals();
}

function renderPatrolPointTotals() {
  const totalsWrap = $("#patrolPointTotals");
  if (!totalsWrap) return;
  const saved = savedPatrolTotals();
  const current = currentPatrolPointValues();
  const names = [...new Set([...patrolNames(), ...Object.keys(saved), ...Object.keys(current)])];
  const rows = names
    .map((name) => ({ name, total: (saved[name] || 0) + (current[name] || 0), current: current[name] || 0 }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  totalsWrap.innerHTML = rows.map((row, index) => `
    <article class="patrol-standing">
      <strong>${rankLabel(index)}</strong>
      <span>${escapeHtml(row.name)}</span>
      <b>${row.total}</b>
      ${row.current ? `<small>+${row.current} today</small>` : `<small>Total</small>`}
    </article>
  `).join("");
}

function recalculateMeetingPatrolPoints(meeting) {
  const totals = {};
  Object.entries(meeting.emberPoints || {}).forEach(([kidId, value]) => {
    const kid = state.kids.find((item) => item.id === kidId);
    const patrol = kid?.patrol || "No patrol";
    totals[patrol] = (totals[patrol] || 0) + (Number(value) || 0);
  });
  meeting.patrolPoints = totals;
}

function meetingPointValue(meeting, kidId) {
  return Number((meeting.emberPoints || {})[kidId]) || 0;
}

function emberPointTotal(kidId) {
  return state.meetings.reduce((sum, meeting) => sum + meetingPointValue(meeting, kidId), 0);
}

function emberPointSpent(kidId) {
  return (state.patrolPointSpending || [])
    .filter((entry) => entry.kidId === kidId)
    .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function emberPointBalance(kidId) {
  return Math.max(0, emberPointTotal(kidId) - emberPointSpent(kidId));
}

function patrolPointTotal(patrol) {
  return state.kids
    .filter((kid) => (kid.patrol || "No patrol") === patrol)
    .reduce((sum, kid) => sum + emberPointTotal(kid.id), 0);
}

function renderPatrolSpendControls() {
  const select = $("#patrolSpendKid");
  if (!select) return;
  const current = select.value;
  select.innerHTML = sortedKids().map((kid) => `<option value="${escapeAttr(kid.id)}">${escapeHtml(kid.name)} - ${emberPointBalance(kid.id)} available</option>`).join("");
  select.value = state.kids.some((kid) => kid.id === current) ? current : (state.kids[0]?.id || "");
  if (!$("#patrolSpendDate").value) $("#patrolSpendDate").value = today();
}

function renderPatrolSpendHistory() {
  const wrap = $("#patrolSpendHistory");
  if (!wrap) return;
  const kidById = new Map(state.kids.map((kid) => [kid.id, kid]));
  const entries = [...(state.patrolPointSpending || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  wrap.innerHTML = `
    <div class="section-heading">
      <h3>Point spending history</h3>
      <span class="small-note">Cash-outs reduce the Ember balance only; patrol earned totals stay the same.</span>
    </div>
    ${entries.map((entry) => {
      const kid = kidById.get(entry.kidId);
      return `
        <article class="stack-item">
          <header>
            <div>
              <h3>${escapeHtml(kid?.name || "Removed Ember")}</h3>
              <p class="muted">${escapeHtml(formatDate(entry.date) || "No date")} - ${escapeHtml(entry.note || "No note")}</p>
            </div>
            <div class="inline-actions">
              <span class="tag warning">-${Number(entry.amount) || 0}</span>
              <button class="text-button" data-remove-patrol-spend="${escapeAttr(entry.id)}" type="button">Remove</button>
            </div>
          </header>
        </article>
      `;
    }).join("") || emptyState("No point spending recorded yet.")}
  `;
}

function renderPatrolPointsMode() {
  const earnedPanel = $("#patrolPointsEarnedPanel");
  const cashoutPanel = $("#patrolPointsCashoutPanel");
  const earnedActive = patrolPointsMode === "earned";
  const cashoutActive = patrolPointsMode === "cashout";
  $("#patrolPointsEarnedToggle")?.classList.toggle("is-active", patrolPointsMode === "earned");
  $("#patrolPointsCashoutToggle")?.classList.toggle("is-active", patrolPointsMode === "cashout");
  if (earnedPanel) {
    earnedPanel.hidden = !earnedActive;
    earnedPanel.classList.toggle("hidden", !earnedActive);
  }
  if (cashoutPanel) {
    cashoutPanel.hidden = !cashoutActive;
    cashoutPanel.classList.toggle("hidden", !cashoutActive);
  }
}

function renderPatrolPointsSheet() {
  const wrap = $("#patrolPointsSheet");
  if (!wrap) return;
  renderPatrolSpendControls();
  renderPatrolSpendHistory();
  renderPatrolPointsMode();
  const meetings = [...state.meetings].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
  if (!state.kids.length) {
    wrap.innerHTML = emptyState("Add Embers before tracking patrol points.");
    return;
  }
  if (!meetings.length) {
    wrap.innerHTML = emptyState("Submit attendance with patrol points to start the patrol points sheet.");
    return;
  }

  const patrols = [...new Set(sortedKids().map((kid) => kid.patrol || "No patrol"))].sort((a, b) => {
    if (a === "No patrol") return 1;
    if (b === "No patrol") return -1;
    return a.localeCompare(b);
  });

  wrap.innerHTML = `
    <div class="badge-matrix-wrap patrol-points-wrap" role="region" aria-label="Patrol points spreadsheet">
      <table class="badge-matrix patrol-points-matrix">
        <thead>
          <tr>
            <th class="sticky-col ember-col">Patrol / Ember</th>
            ${meetings.map((meeting) => `
              <th>
                <span>${escapeHtml(shortDate(meeting.date) || "Meeting")}</span>
                <small>${escapeHtml(meeting.title || "Untitled")}</small>
              </th>
            `).join("")}
            <th>Earned</th>
            <th>Spent</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          ${patrols.map((patrol) => {
            const kids = sortedKids().filter((kid) => (kid.patrol || "No patrol") === patrol);
            return `
              <tr class="patrol-total-row">
                <th class="sticky-col ember-col" scope="row">${escapeHtml(patrol)}</th>
                ${meetings.map((meeting) => {
                  const total = kids.reduce((sum, kid) => sum + meetingPointValue(meeting, kid.id), 0);
                  return `<td>${total}</td>`;
                }).join("")}
                <td><strong>${patrolPointTotal(patrol)}</strong></td>
                <td></td>
                <td></td>
              </tr>
              ${kids.map((kid) => `
                <tr>
                  <th class="sticky-col ember-col" scope="row">${escapeHtml(kid.name)}</th>
                  ${meetings.map((meeting) => `
                    <td>
                      <input
                        class="matrix-number-input"
                        data-patrol-point-meeting-id="${escapeAttr(meeting.id)}"
                        data-patrol-point-kid-id="${escapeAttr(kid.id)}"
                        type="number"
                        min="0"
                        step="1"
                        value="${escapeAttr(meetingPointValue(meeting, kid.id))}"
                        aria-label="${escapeAttr(`${kid.name} points for ${meeting.title || meeting.date}`)}"
                      />
                    </td>
                  `).join("")}
                  <td><strong>${emberPointTotal(kid.id)}</strong></td>
                  <td>${emberPointSpent(kid.id)}</td>
                  <td><strong>${emberPointBalance(kid.id)}</strong></td>
                </tr>
              `).join("")}
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderHistory() {
  const requirementMap = allRequirementMap();
  const badgeById = new Map(state.badges.map((badge) => [badge.id, badge]));
  const meetings = [...state.meetings].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $("#meetingHistory").innerHTML = meetings.map((meeting) => {
    const complete = meetingIsComplete(meeting);
    const displayBadgeIds = complete ? badgeIdsForMeeting(meeting) : meetingCandidateBadgeIds(meeting);
    const displayBadgeCredits = complete ? (meeting.badgeCredits || {}) : meetingCandidateBadgeCredits(meeting);
    const badges = displayBadgeIds.map((id) => badgeById.get(id)).filter(Boolean);
    return `
      <article class="history-item">
        <header>
          <div>
            <h3>${escapeHtml(meeting.title)}</h3>
            <p class="muted">${formatDate(meeting.date)} - ${meeting.presentKidIds?.length || 0} present - ${complete ? `${totalBadgeCredits(displayBadgeIds, displayBadgeCredits)} badge activities` : "attendance submitted, badge completion pending"}</p>
          </div>
          <div class="inline-actions">
            ${complete ? "" : `<button class="primary-button" data-complete-meeting="${escapeAttr(meeting.id)}" type="button">Complete meeting</button>`}
            <button class="text-button" data-remove-meeting="${escapeAttr(meeting.id)}" type="button">Delete</button>
          </div>
        </header>
        ${meeting.notes ? `<p>${escapeHtml(meeting.notes)}</p>` : ""}
        <div class="tag-row">${badges.map((badge) => `<span class="tag ${complete ? "" : "warning"}">${escapeHtml(badgeCreditTag(badge, displayBadgeCredits))}</span>`).join("") || (complete ? "" : `<span class="tag warning">No badge choices yet</span>`)}</div>
      </article>
    `;
  }).join("") || emptyState("No meeting history yet.");
}

function syncMeetingBadgePanelHeight() {
  const form = $("#meetingForm");
  if (!form) return;
  const details = form.querySelector(".surface:nth-child(1)");
  const badgePanel = form.querySelector(".surface:nth-child(2)");
  const patrolPoints = form.querySelector(".surface:nth-child(3)");
  if (!details || !badgePanel || !patrolPoints) return;
  if (!form.closest(".view.is-active")) {
    badgePanel.style.height = "";
    badgePanel.style.maxHeight = "";
    return;
  }
  if (window.matchMedia("(max-width: 980px)").matches) {
    badgePanel.style.height = "";
    badgePanel.style.maxHeight = "";
    return;
  }
  const rowGap = Number.parseFloat(getComputedStyle(form).rowGap) || 0;
  const targetHeight = Math.ceil(details.getBoundingClientRect().height + patrolPoints.getBoundingClientRect().height + rowGap);
  badgePanel.style.height = `${targetHeight}px`;
  badgePanel.style.maxHeight = `${targetHeight}px`;
}

function queueMeetingBadgePanelSync() {
  requestAnimationFrame(syncMeetingBadgePanelHeight);
}

function renderAll() {
  renderLogBadgeTiles();
  renderPatrolPoints();
  renderAttendanceGrid();
  renderAttendanceWorkflowCalendar();
  renderKids();
  renderAttendanceCalendar();
  renderBadges();
  renderKidBadges();
  renderPatrolPointsSheet();
  renderPlanning();
  renderNotes();
  renderCookieTracker();
  renderChatBadgeNeeds();
  renderHistory();
  if (document.querySelector("#attendance-entry.view.is-active") && selectedAttendanceEventId) applyAttendanceEventToForm(selectedAttendanceEventId);
  renderDriveSyncSettings();
  renderAppScriptSyncSettings();
  renderBranchCopy();
  queueMeetingBadgePanelSync();
}

function progressBar(percent) {
  return `<div class="progress-bar" aria-label="${percent}% complete"><span style="width: ${percent}%"></span></div>`;
}

function emptyState(message) {
  return `<div class="empty-state"><p class="muted">${escapeHtml(message)}</p></div>`;
}

function formatDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function monthKey(date) {
  if (!date) return "Date not listed";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Date not listed";
  return parsed.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function dateMonth(date) {
  if (!date) return "TBD";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "TBD";
  return parsed.toLocaleDateString(undefined, { month: "short" });
}

function dateDay(date) {
  if (!date) return "--";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleDateString(undefined, { day: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function linkifyText(value) {
  const urlPattern = /\b((?:https?:\/\/|www\.)[^\s<]+|(?:[a-z0-9-]+\.)+(?:com|ca|org|net|edu|gov|io|co|app|dev|cloud|drive|google|googleusercontent)(?:\/[^\s<]*)?)/gi;
  return escapeHtml(value).replace(urlPattern, (match) => {
    const trailing = match.match(/[).,!?;:]+$/)?.[0] || "";
    const clean = trailing ? match.slice(0, -trailing.length) : match;
    const href = clean.startsWith("http") ? clean : `https://${clean}`;
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${clean}</a>${trailing}`;
  });
}

function resetBadgeForm() {
  $("#badgeEditId").value = "";
  $("#badgeName").value = "";
  $("#badgeName").readOnly = false;
  $("#badgeArea").value = "";
  $("#badgeArea").readOnly = false;
  if ($("#badgeProgressMode")) $("#badgeProgressMode").value = "events";
  $("#badgeRequired").value = "1";
  $("#badgeRequirements").value = "";
  $("#badgeFormTitle").textContent = "Customize Badge/Award criteria";
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function backupFileName() {
  const base = unitTrackerDisplayName()
    .replace(/\btracker\b/ig, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "tracker";
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  return `${base}-tracker-backup-${stamp}.json`;
}

async function saveJsonBackup() {
  const filename = backupFileName();
  const content = JSON.stringify(trackerPayloadObject(), null, 2);
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "Tracker JSON backup",
          accept: { "application/json": [".json"] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      showToast("Backup saved.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  downloadFile(filename, content, "application/json");
  showToast("Backup downloaded.");
}

function exportJson() {
  saveJsonBackup();
}

async function importJsonBackup(file) {
  if (!file) return;
  if (!window.confirm("Restore this backup? It will replace the tracker currently open in this browser.")) return;
  const imported = JSON.parse(await file.text());
  state = normalizeState(imported);
  saveState();
  renderAll();
  switchTab("planning");
  showToast("Backup restored.");
}

function exportProgressCsv() {
  const rows = [["Ember", "Year", "Patrol", "Badge", "Program Area", "Completed", "Needed", "Status", "Handed Out", "Earned Date", "Completed Criteria"]];
  sortedKids().forEach((kid) => {
    state.badges.forEach((badge) => {
      const progress = badgeProgress(kid.id, badge);
      rows.push([
        kid.name,
        emberYearLabel(kid.year),
        kid.patrol || "",
        badge.name,
        badge.area || "",
        progress.completedCount,
        progress.needed,
        progress.earned ? "Earned" : "In progress",
        badgeHandedOut(kid.id, badge.id) ? "Yes" : "No",
        progress.earned ? earnedDate(kid.id, badge) : "",
        progress.completed.map((requirement) => requirement.title).join("; "),
      ]);
    });
  });
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadFile(`ember-badge-progress-${today()}.csv`, csv, "text/csv");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function openRemoveKidModal(kidId) {
  const kid = state.kids.find((item) => item.id === kidId);
  if (!kid) return;
  $("#removeKidId").value = kid.id;
  $("#removeKidTitle").textContent = `Remove ${kid.name}?`;
  $("#removeKidMessage").textContent = `This will permanently remove ${kid.name} and delete all tracker information connected to them, including attendance, badge corrections, cookie entries, and patrol point history.`;
  $("#removeKidModal").hidden = false;
}

function closeRemoveKidModal() {
  $("#removeKidId").value = "";
  $("#removeKidModal").hidden = true;
}

function removeKidAndConnectedData(kidId) {
  state.kids = state.kids.filter((kid) => kid.id !== kidId);
  if (state.cookieTracker?.rows) delete state.cookieTracker.rows[kidId];
  state.badgeHandouts = Object.fromEntries(Object.entries(state.badgeHandouts || {}).filter(([key]) => key.split("|")[0] !== kidId));
  state.manualBadgeAdjustments = Object.fromEntries(Object.entries(state.manualBadgeAdjustments || {}).filter(([key]) => key.split("|")[0] !== kidId));
  state.manualCriteriaSelections = Object.fromEntries(Object.entries(state.manualCriteriaSelections || {}).filter(([key]) => key.split("|")[0] !== kidId));
  state.baselineCredits = (state.baselineCredits || []).filter((entry) => entry.kidId !== kidId);
  state.patrolPointSpending = (state.patrolPointSpending || []).filter((entry) => entry.kidId !== kidId);
  state.meetings = state.meetings.map((meeting) => {
    const emberPoints = { ...(meeting.emberPoints || {}) };
    const attendanceStatus = { ...(meeting.attendanceStatus || {}) };
    delete emberPoints[kidId];
    delete attendanceStatus[kidId];
    const badgeKidIds = Object.fromEntries(Object.entries(meeting.badgeKidIds || {}).map(([badgeId, kidIds]) => [badgeId, (kidIds || []).filter((id) => id !== kidId)]));
    const pendingBadgeKidIds = Object.fromEntries(Object.entries(meeting.pendingBadgeKidIds || {}).map(([badgeId, kidIds]) => [badgeId, (kidIds || []).filter((id) => id !== kidId)]));
    const next = {
      ...meeting,
      presentKidIds: (meeting.presentKidIds || []).filter((id) => id !== kidId),
      attendanceStatus,
      badgeKidIds,
      pendingBadgeKidIds,
      emberPoints,
    };
    recalculateMeetingPatrolPoints(next);
    return next;
  });
  state.attendanceRecords = (state.attendanceRecords || []).map((record) => ({
    ...record,
    missingKidIds: (record.missingKidIds || []).filter((id) => id !== kidId),
  }));
  state.scheduledEvents = (state.scheduledEvents || []).map((record) => ({
    ...record,
    missingKidIds: (record.missingKidIds || []).filter((id) => id !== kidId),
  }));
}

document.addEventListener("click", (event) => {
  const tabTarget = event.target.closest("[data-tab-target]");
  if (tabTarget) switchTab(tabTarget.dataset.tabTarget);

  if (event.target.closest("[data-share-tracker]")) {
    shareDriveSyncFile()
      .then(() => showToast("Open Google Drive to share the tracker."))
      .catch((error) => {
        setDriveSyncStatus(`Share failed: ${error.message}`, "Needs setup");
        showToast("Create or load a sync file first.");
      });
    return;
  }

  if (event.target.closest("#switchTrackerTop")) {
    showTrackerCodeLogin();
    showToast("Enter another tracker code to switch units.");
    return;
  }

  if (event.target.closest("#returnFromItinerary")) {
    switchTab(itineraryReturnTab || "planning");
    return;
  }

  const openItineraryPlan = event.target.closest("[data-open-itinerary-plan]");
  if (openItineraryPlan) {
    openPlanItinerary(openItineraryPlan.dataset.openItineraryPlan);
    return;
  }

  const openItineraryEvent = event.target.closest("[data-open-itinerary-event]");
  if (openItineraryEvent) {
    openEventItinerary(openItineraryEvent.dataset.openItineraryEvent);
    return;
  }

  const removeKid = event.target.closest("[data-remove-kid]");
  if (removeKid) {
    openRemoveKidModal(removeKid.dataset.removeKid);
    return;
  }

  const editBadge = event.target.closest("[data-edit-badge]");
  if (editBadge) {
    const badge = state.badges.find((item) => item.id === editBadge.dataset.editBadge);
    if (!badge) return;
    $("#badgeEditId").value = badge.id;
    $("#badgeName").value = badge.name;
    $("#badgeName").readOnly = !isCustomBadge(badge);
    $("#badgeArea").value = badge.area || "";
    $("#badgeArea").readOnly = !isCustomBadge(badge);
    if ($("#badgeProgressMode")) $("#badgeProgressMode").value = isCriteriaBadge(badge) ? "criteria" : "events";
    $("#badgeRequired").value = Number(badge.requiredCount) || badge.requirements.length;
    $("#badgeRequirements").value = badge.requirements.map((requirement) => requirement.title).join("\n");
    $("#badgeFormTitle").textContent = "Edit badge criteria";
    switchTab("badges");
  }

  const removeBadge = event.target.closest("[data-remove-badge]");
  if (removeBadge) {
    const id = removeBadge.dataset.removeBadge;
    const badgeToRemove = state.badges.find((badge) => badge.id === id);
    if (!badgeToRemove || !isCustomBadge(badgeToRemove)) return;
    const requirementIds = new Set(badgeToRemove.requirements.map((req) => req.id) || []);
    state.badges = state.badges.filter((badge) => badge.id !== id);
    state.baselineCredits = (state.baselineCredits || []).filter((credit) => credit.badgeId !== id);
    state.manualBadgeAdjustments = Object.fromEntries(Object.entries(state.manualBadgeAdjustments || {}).filter(([key]) => key.split("|")[1] !== id));
    state.manualCriteriaSelections = Object.fromEntries(Object.entries(state.manualCriteriaSelections || {}).filter(([key]) => key.split("|")[1] !== id));
    state.badgeHandouts = Object.fromEntries(Object.entries(state.badgeHandouts || {}).filter(([key]) => key.split("|")[1] !== id));
    state.meetings = state.meetings.map((meeting) => ({
      ...meeting,
      badgeIds: (meeting.badgeIds || []).filter((badgeId) => badgeId !== id),
      pendingBadgeIds: (meeting.pendingBadgeIds || []).filter((badgeId) => badgeId !== id),
      badgeCredits: Object.fromEntries(Object.entries(meeting.badgeCredits || {}).filter(([badgeId]) => badgeId !== id)),
      pendingBadgeCredits: Object.fromEntries(Object.entries(meeting.pendingBadgeCredits || {}).filter(([badgeId]) => badgeId !== id)),
      badgeKidIds: Object.fromEntries(Object.entries(meeting.badgeKidIds || {}).filter(([badgeId]) => badgeId !== id)),
      pendingBadgeKidIds: Object.fromEntries(Object.entries(meeting.pendingBadgeKidIds || {}).filter(([badgeId]) => badgeId !== id)),
      requirementIds: (meeting.requirementIds || []).filter((reqId) => !requirementIds.has(reqId)),
    }));
    state.attendanceRecords = (state.attendanceRecords || []).map((record) => ({
      ...record,
      badgeIds: (record.badgeIds || []).filter((badgeId) => badgeId !== id),
      requirementIds: (record.requirementIds || []).filter((reqId) => !requirementIds.has(reqId)),
    }));
    state.scheduledEvents = (state.scheduledEvents || []).map((scheduled) => ({
      ...scheduled,
      badgeIds: (scheduled.badgeIds || []).filter((badgeId) => badgeId !== id),
      requirementIds: (scheduled.requirementIds || []).filter((reqId) => !requirementIds.has(reqId)),
    }));
    state.weeklyPlans = (state.weeklyPlans || []).map((plan) => ({
      ...plan,
      badgeIds: (plan.badgeIds || []).filter((badgeId) => badgeId !== id),
    }));
    saveState();
    renderAll();
    showToast("Badge removed.");
  }

  const removeMeeting = event.target.closest("[data-remove-meeting]");
  if (removeMeeting) {
    const meeting = state.meetings.find((item) => item.id === removeMeeting.dataset.removeMeeting);
    if (!meeting || !confirm(`Delete "${meeting.title || "this meeting"}"? Badge credits and patrol points from this meeting will be recalculated.`)) return;
    state.meetings = state.meetings.filter((meeting) => meeting.id !== removeMeeting.dataset.removeMeeting);
    selectedCalendarEventId = "";
    selectedAttendanceEventId = "";
    selectedPlanningEventId = "";
    saveState();
    renderAll();
    showToast("Meeting deleted and credits recalculated.");
  }

  const completeMeeting = event.target.closest("[data-complete-meeting]");
  if (completeMeeting) {
    openCompleteMeetingModal(completeMeeting.dataset.completeMeeting);
    return;
  }

  const attendanceEvent = event.target.closest("[data-attendance-event]");
  if (attendanceEvent) {
    if (event.detail > 1) {
      openAttendanceEntry(attendanceEvent.dataset.attendanceEvent);
      return;
    }
    selectAttendanceEvent(attendanceEvent.dataset.attendanceEvent);
    return;
  }

  const attendanceItinerary = event.target.closest("[data-open-attendance-itinerary]");
  if (attendanceItinerary) {
    openEventItinerary(attendanceItinerary.dataset.openAttendanceItinerary);
    return;
  }

  const attendanceEntry = event.target.closest("[data-open-attendance-entry]");
  if (attendanceEntry) {
    openAttendanceEntry(attendanceEntry.dataset.openAttendanceEntry);
    return;
  }

  const attendanceBadges = event.target.closest("[data-open-attendance-badges]");
  if (attendanceBadges) {
    const sourceEvent = eventSnapshot(attendanceBadges.dataset.openAttendanceBadges);
    const meeting = sourceEvent ? attendanceMeetingForEvent(sourceEvent) : null;
    if (!meeting) {
      showToast("Submit attendance before submitting badges.");
      return;
    }
    openCompleteMeetingModal(meeting.id);
    return;
  }

  const calendarEvent = event.target.closest("[data-calendar-event]");
  if (calendarEvent) {
    selectedCalendarEventId = calendarEvent.dataset.calendarEvent;
    openEventModal(selectedCalendarEventId);
  }

  const logBadge = event.target.closest("[data-log-badge-id]");
  if (logBadge) {
    const id = logBadge.dataset.logBadgeId;
    if (selectedMeetingBadgeIds.has(id)) {
      selectedMeetingBadgeIds.delete(id);
      selectedMeetingBadgeCredits.delete(id);
    } else {
      selectedMeetingBadgeIds.add(id);
      selectedMeetingBadgeCredits.set(id, 1);
    }
    renderLogBadgeTiles();
    renderAttendanceGrid();
  }

  const removeScheduled = event.target.closest("[data-remove-scheduled-event]");
  if (removeScheduled) {
    state.scheduledEvents = (state.scheduledEvents || []).filter((item) => item.id !== removeScheduled.dataset.removeScheduledEvent);
    selectedCalendarEventId = "";
    saveState();
    renderAll();
    showToast("Scheduled event deleted.");
  }

  const editPlan = event.target.closest("[data-edit-plan]");
  if (editPlan) {
    const plan = (state.weeklyPlans || []).find((item) => item.id === editPlan.dataset.editPlan);
    if (plan) loadPlanIntoForm(plan);
  }

  const removePlan = event.target.closest("[data-remove-plan]");
  if (removePlan) {
    state.weeklyPlans = (state.weeklyPlans || []).filter((item) => item.id !== removePlan.dataset.removePlan);
    if (selectedPlanningPlanId === removePlan.dataset.removePlan) selectedPlanningPlanId = "";
    selectedPlanningEventId = "";
    selectedPlanningDate = "";
    saveState();
    renderPlanning();
    showToast("Weekly plan deleted.");
  }

  const planningPlan = event.target.closest("[data-planning-plan]");
  if (planningPlan) {
    if (event.detail > 1) {
      openPlanItinerary(planningPlan.dataset.planningPlan);
      return;
    }
    selectedPlanningPlanId = planningPlan.dataset.planningPlan;
    selectedPlanningEventId = "";
    selectedPlanningDate = "";
    renderPlanningCalendar();
    return;
  }

  const planningEvent = event.target.closest("[data-planning-event]");
  if (planningEvent) {
    if (event.detail > 1) {
      openEventItinerary(planningEvent.dataset.planningEvent);
      return;
    }
    selectedPlanningEventId = planningEvent.dataset.planningEvent;
    selectedPlanningPlanId = "";
    selectedPlanningDate = "";
    renderPlanningCalendar();
    return;
  }

  const planningDate = event.target.closest("[data-planning-date]");
  if (planningDate) {
    selectPlanningCalendarDate(planningDate.dataset.planningDate);
  }
});

document.addEventListener("dblclick", (event) => {
  const attendanceEvent = event.target.closest("[data-attendance-event]");
  if (attendanceEvent) {
    event.preventDefault();
    openAttendanceEntry(attendanceEvent.dataset.attendanceEvent);
    return;
  }
  const planningPlan = event.target.closest("[data-planning-plan]");
  if (planningPlan) {
    event.preventDefault();
    openPlanItinerary(planningPlan.dataset.planningPlan);
    return;
  }
  const planningEvent = event.target.closest("[data-planning-event]");
  if (planningEvent) {
    event.preventDefault();
    openEventItinerary(planningEvent.dataset.planningEvent);
  }
});

document.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const attendanceEvent = event.target.closest("[data-attendance-event]");
  if (attendanceEvent) {
    event.preventDefault();
    openAttendanceEntry(attendanceEvent.dataset.attendanceEvent);
    return;
  }
  const planningDate = event.target.closest("[data-planning-date]");
  if (!planningDate || event.target.closest("[data-planning-plan], [data-planning-event]")) return;
  event.preventDefault();
  selectPlanningCalendarDate(planningDate.dataset.planningDate);
});

setDefaultMeetingDate();
$("#planningDate").value = today();

$("#meetingForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const pendingBadgeIds = [...selectedMeetingBadgeIds];
  const pendingBadgeCredits = badgeCreditsFromSelection(selectedMeetingBadgeIds, selectedMeetingBadgeCredits);
  const attendanceDraft = collectAttendanceDraftFromGrid();
  const presentKidIds = attendanceDraft.presentKidIds;
  const sourceEventId = $("#meetingEventId").value;
  const sourceEvent = eventSnapshot(sourceEventId);
  const sourceRef = eventRefById(sourceEventId);
  const linkedMeeting = linkedMeetingForEventId(sourceEventId);
  if (!state.kids.length) return showToast("Add Embers before submitting attendance.");
  if (!sourceEvent) return showToast("Choose a calendar event first.");
  if (!presentKidIds.length) return showToast("Mark at least one Ember present.");

  let meeting = null;
  if (linkedMeeting || sourceRef?.type === "logged") {
    meeting = linkedMeeting || sourceRef.item;
    meeting.date = $("#meetingDate").value;
    meeting.title = $("#meetingTitle").value.trim();
    meeting.notes = $("#meetingNotes").value.trim();
    meeting.presentKidIds = presentKidIds;
    meeting.attendanceStatus = attendanceDraft.statusByKid;
    meeting.patrolPoints = collectPatrolPoints();
    meeting.emberPoints = collectEmberPoints();
    meeting.attendanceSubmittedAt = meeting.attendanceSubmittedAt || new Date().toISOString();
    meeting.pendingBadgeIds = pendingBadgeIds;
    meeting.pendingBadgeCredits = pendingBadgeCredits;
    meeting.pendingBadgeKidIds = attendanceDraft.badgeKidIds;
    if (!meetingIsComplete(meeting)) {
      meeting.badgeIds = [];
      meeting.badgeCredits = {};
      meeting.requirementIds = [];
    }
  } else {
    meeting = {
      id: uid("meeting"),
      date: $("#meetingDate").value,
      title: $("#meetingTitle").value.trim(),
      notes: $("#meetingNotes").value.trim(),
      badgeIds: [],
      badgeCredits: {},
      pendingBadgeIds,
      pendingBadgeCredits,
      requirementIds: [],
      presentKidIds,
      attendanceStatus: attendanceDraft.statusByKid,
      pendingBadgeKidIds: attendanceDraft.badgeKidIds,
      patrolPoints: collectPatrolPoints(),
      emberPoints: collectEmberPoints(),
      sourceEventId,
      attendanceSubmittedAt: new Date().toISOString(),
      completedAt: "",
    };
    state.meetings.push(meeting);
  }
  saveState();
  setDefaultMeetingDate();
  selectedMeetingBadgeIds = new Set();
  selectedMeetingBadgeCredits = new Map();
  selectedCalendarEventId = `logged-attendance-${meeting.id}`;
  selectedAttendanceEventId = meeting.sourceEventId || `logged-attendance-${meeting.id}`;
  renderAll();
  applyAttendanceEventToForm(selectedAttendanceEventId);
  showToast(linkedMeeting || sourceRef?.type === "logged" ? "Attendance updated. Badge progress was not changed." : "Attendance submitted. Badge progress was not changed.");
});

$("#submitBadgesButton").addEventListener("click", () => {
  const eventId = $("#meetingEventId").value;
  const ref = eventRefById(eventId);
  const linkedMeeting = linkedMeetingForEventId(eventId);
  const meeting = linkedMeeting || (ref?.type === "logged" ? ref.item : null);
  if (!meeting) {
    showToast("Submit attendance before submitting badges.");
    return;
  }
  openCompleteMeetingModal(meeting.id);
});

$("#returnToAttendanceCalendar").addEventListener("click", () => {
  switchTab("log");
});

$("#kidForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#kidName").value.trim();
  if (!name) return;
  const patrol = selectedPatrolFromForm();
  state.kids.push({
    id: uid("kid"),
    name,
    patrol,
    year: emberYearValue($("#kidYear").value),
    leadership: leadershipValue($("#kidLeadership").value),
    membershipYear: membershipYearValue($("#kidMembershipYear").value),
    returningStatus: returningValue($("#kidReturningStatus").value),
  });
  saveState();
  event.currentTarget.reset();
  renderAll();
  showToast("Ember added.");
});

$("#kidPatrol")?.addEventListener("change", (event) => {
  const otherInput = $("#kidPatrolOther");
  setOtherPatrolInput(event.target, otherInput);
  if (event.target.value === OTHER_PATROL_VALUE) otherInput?.focus();
});

$("#kidTable").addEventListener("change", (event) => {
  const yearInput = event.target.closest("[data-kid-year]");
  const patrolInput = event.target.closest("[data-kid-patrol]");
  const patrolOtherInput = event.target.closest("[data-kid-patrol-other]");
  const leadershipInput = event.target.closest("[data-kid-leadership]");
  const membershipInput = event.target.closest("[data-kid-membership]");
  const returningInput = event.target.closest("[data-kid-returning]");
  const input = yearInput || patrolInput || patrolOtherInput || leadershipInput || membershipInput || returningInput;
  if (!input) return;
  const kidId = yearInput?.dataset.kidYear || patrolInput?.dataset.kidPatrol || patrolOtherInput?.dataset.kidPatrolOther || leadershipInput?.dataset.kidLeadership || membershipInput?.dataset.kidMembership || returningInput?.dataset.kidReturning;
  const kid = state.kids.find((item) => item.id === kidId);
  if (!kid) return;
  if (yearInput) kid.year = emberYearValue(input.value);
  if (patrolInput) {
    if (input.value === OTHER_PATROL_VALUE) {
      const otherInput = input.parentElement?.querySelector("[data-kid-patrol-other]");
      setOtherPatrolInput(input, otherInput);
      otherInput?.focus();
      return;
    }
    kid.patrol = input.value.trim();
  }
  if (patrolOtherInput) kid.patrol = input.value.trim();
  if (leadershipInput) kid.leadership = leadershipValue(input.value);
  if (membershipInput) kid.membershipYear = membershipYearValue(input.value);
  if (returningInput) kid.returningStatus = returningValue(input.value);
  saveState();
  renderAll();
  showToast("Roster updated.");
});

$("#badgeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const editId = $("#badgeEditId").value;
  const existingIndex = state.badges.findIndex((item) => item.id === editId);
  const existing = existingIndex >= 0 ? state.badges[existingIndex] : null;
  const requirementTitles = $("#badgeRequirements").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!requirementTitles.length) return showToast("Add at least one criterion.");
  const name = existing?.name || $("#badgeName").value.trim();
  if (!name) return showToast("Add a badge name.");
  const area = existing?.area || $("#badgeArea").value.trim() || "Custom Badges";
  const id = existing?.id || `custom-${slug(name) || uid("badge")}`;
  const badge = makeBadge(
    id,
    area,
    name,
    Math.max(1, Number($("#badgeRequired").value) || requirementTitles.length),
    requirementTitles,
    {
      imageUrl: existing?.imageUrl || "",
      progressMode: $("#badgeProgressMode")?.value === "criteria" ? "criteria" : "events",
    }
  );
  if (existingIndex >= 0) state.badges[existingIndex] = badge;
  else state.badges.push(badge);
  saveState();
  resetBadgeForm();
  renderAll();
  showToast(existingIndex >= 0 ? "Badge saved." : "Badge created and added to the end.");
});

$("#planningForm").addEventListener("submit", (event) => {
  event.preventDefault();
  readPlanningActivityInputs();
  normalizePlanningActivities();
  const id = $("#planningEditId").value || uid("plan");
  const plan = {
    id,
    date: $("#planningDate").value,
    title: $("#planningTitle").value.trim(),
    notes: $("#planningNotes").value.trim(),
    badgeIds: selectedPlanningBadgeIds(),
    badgeCredits: planningBadgeCreditObject(),
    activities: [...planningActivities],
  };
  if (!plan.title) return showToast("Add a meeting title.");
  const existingIndex = (state.weeklyPlans || []).findIndex((item) => item.id === id);
  if (existingIndex >= 0) state.weeklyPlans[existingIndex] = plan;
  else state.weeklyPlans = [...(state.weeklyPlans || []), plan];
  selectedCalendarEventId = `planned-${plan.id}`;
  selectedPlanningPlanId = plan.id;
  selectedPlanningEventId = "";
  selectedPlanningDate = "";
  calendarCursor = startOfMonth(new Date(`${plan.date}T12:00:00`));
  planningCalendarCursor = startOfMonth(new Date(`${plan.date}T12:00:00`));
  saveState();
  resetPlanningForm();
  renderPlanning();
  showToast(existingIndex >= 0 ? "Weekly plan updated." : "Weekly plan saved.");
});

$("#planningReset").addEventListener("click", resetPlanningForm);
$("#planningBadgeSearch").addEventListener("input", renderPlanningBadges);
$("#planningCalendarPrev").addEventListener("click", () => {
  planningCalendarCursor = addMonths(planningCalendarCursor, -1);
  selectedPlanningPlanId = "";
  selectedPlanningEventId = "";
  selectedPlanningDate = "";
  renderPlanningCalendar();
});
$("#planningCalendarNext").addEventListener("click", () => {
  planningCalendarCursor = addMonths(planningCalendarCursor, 1);
  selectedPlanningPlanId = "";
  selectedPlanningEventId = "";
  selectedPlanningDate = "";
  renderPlanningCalendar();
});
$("#planningCalendarToday").addEventListener("click", () => {
  planningCalendarCursor = startOfMonth(new Date());
  selectedPlanningPlanId = "";
  selectedPlanningEventId = "";
  selectedPlanningDate = "";
  renderPlanningCalendar();
});

$("#attendanceWorkflowPrev").addEventListener("click", () => {
  attendanceWorkflowCursor = addMonths(attendanceWorkflowCursor, -1);
  selectedAttendanceEventId = "";
  renderAttendanceWorkflowCalendar();
});

$("#attendanceWorkflowNext").addEventListener("click", () => {
  attendanceWorkflowCursor = addMonths(attendanceWorkflowCursor, 1);
  selectedAttendanceEventId = "";
  renderAttendanceWorkflowCalendar();
});

$("#attendanceWorkflowToday").addEventListener("click", () => {
  attendanceWorkflowCursor = startOfMonth(new Date());
  selectedAttendanceEventId = "";
  renderAttendanceWorkflowCalendar();
});

$("#planningBadgeChecklist").addEventListener("change", (event) => {
  const input = event.target.closest("input[name='planningBadge']");
  const creditInput = event.target.closest("[data-planning-badge-credit]");
  if (creditInput) {
    const badge = state.badges.find((item) => item.id === creditInput.dataset.planningBadgeCredit);
    if (!badge) return;
    creditInput.value = badgeCreditValue(badge, creditInput.value);
    planningBadgeCredits.set(badge.id, Number(creditInput.value));
    return;
  }
  if (!input) return;
  if (input.checked) {
    planningBadgeSelection.add(input.value);
    planningBadgeCredits.set(input.value, planningBadgeCredits.get(input.value) || 1);
  } else {
    planningBadgeSelection.delete(input.value);
    planningBadgeCredits.delete(input.value);
  }
  renderPlanningBadges();
});
$("#planningBadgeChecklist").addEventListener("input", (event) => {
  const input = event.target.closest("[data-planning-badge-credit]");
  if (!input) return;
  const badge = state.badges.find((item) => item.id === input.dataset.planningBadgeCredit);
  if (!badge) return;
  planningBadgeCredits.set(badge.id, badgeCreditValue(badge, input.value));
  renderPlanningActivityPlanner();
});
$("#planningActivityPlanner").addEventListener("input", readPlanningActivityInputs);
$("#planningSelectShown").addEventListener("click", () => {
  visiblePlanningBadges().forEach((badge) => {
    planningBadgeSelection.add(badge.id);
    planningBadgeCredits.set(badge.id, planningBadgeCredits.get(badge.id) || 1);
  });
  renderPlanningBadges();
});
$("#planningClearShown").addEventListener("click", () => {
  visiblePlanningBadges().forEach((badge) => {
    planningBadgeSelection.delete(badge.id);
    planningBadgeCredits.delete(badge.id);
  });
  renderPlanningBadges();
});

$("#addPlannerNote")?.addEventListener("click", createPlannerNote);

$("#deletePlannerNote")?.addEventListener("click", () => {
  const note = selectedPlannerNote();
  if (!note) return;
  state.notes = plannerNotes().filter((item) => item.id !== note.id);
  selectedNoteId = state.notes[0]?.id || "";
  saveState();
  renderNotes();
  showToast("Note page deleted.");
});

$("#notesList")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-note-id]");
  if (!button) return;
  selectedNoteId = button.dataset.noteId;
  renderNotes();
});

$("#noteTitle")?.addEventListener("input", scheduleNoteSave);
$("#noteContent")?.addEventListener("input", scheduleNoteSave);
$("#noteTitle")?.addEventListener("blur", flushNoteSave);
$("#noteContent")?.addEventListener("blur", flushNoteSave);

$("#cookieRows").addEventListener("input", handleCookieTrackerInput);
$("#cookieRows").addEventListener("change", handleCookieTrackerInput);
$("#cookieRows").addEventListener("submit", (event) => {
  const pickupForm = event.target.closest("[data-cookie-pickup-form]");
  const paymentForm = event.target.closest("[data-cookie-payment-form]");
  if (!pickupForm && !paymentForm) return;
  event.preventDefault();

  if (pickupForm) {
    const kidId = pickupForm.dataset.cookieKidId;
    const row = cookieRowForKid(kidId);
    const pickup = {
      id: uid("cookie"),
      date: pickupForm.elements.date.value || today(),
      orderId: pickupForm.elements.orderId.value || "",
      flavor: pickupForm.elements.flavor.value || "Mint",
      cases: cookieNumber(pickupForm.elements.cases.value),
      boxes: cookieNumber(pickupForm.elements.boxes.value),
      notes: pickupForm.elements.notes.value.trim(),
    };
    if (!pickup.cases && !pickup.boxes) return showToast("Enter cases or boxes for the pickup.");
    row.pickups.push(pickup);
    saveState();
    renderCookieTracker();
    showToast("Pickup saved.");
    return;
  }

  if (paymentForm) {
    const kidId = paymentForm.dataset.cookieKidId;
    const row = cookieRowForKid(kidId);
    const payment = {
      id: uid("cookie-payment"),
      date: paymentForm.elements.date.value || today(),
      orderId: paymentForm.elements.orderId.value || "",
      amount: cookieNumber(paymentForm.elements.amount.value),
      method: normalizeCookiePaymentMethod(paymentForm.elements.method.value),
      methodOther: paymentForm.elements.methodOther.value.trim(),
      notes: paymentForm.elements.notes.value.trim(),
    };
    if (!payment.amount) return showToast("Enter a payment amount.");
    row.payments.push(payment);
    saveState();
    renderCookieTracker();
    showToast("Payment saved.");
  }
});
$("#cookieRows").addEventListener("click", (event) => {
  const openKid = event.target.closest("[data-cookie-open-kid]");
  if (openKid) {
    state.cookieTracker.selectedKidId = openKid.dataset.cookieOpenKid;
    state.cookieTracker.view = "entry";
    saveState();
    renderCookieTracker();
    return;
  }

  const addPickup = event.target.closest("[data-cookie-add-pickup]");
  if (addPickup) {
    const row = cookieRowForKid(addPickup.dataset.cookieAddPickup);
    row.expanded = true;
    row.pickups.push(newCookiePickup());
    saveState();
    renderCookieTracker();
    return;
  }

  const removePickup = event.target.closest("[data-cookie-remove-pickup][data-cookie-kid-id]");
  if (removePickup) {
    openCookieRemoveModal("pickup", removePickup.dataset.cookieKidId, removePickup.dataset.cookieRemovePickup);
    return;
  }

  const addPayment = event.target.closest("[data-cookie-add-payment]");
  if (addPayment) {
    const row = cookieRowForKid(addPayment.dataset.cookieAddPayment);
    row.payments.push(newCookiePayment());
    saveState();
    renderCookieTracker();
    return;
  }

  const removePayment = event.target.closest("[data-cookie-remove-payment][data-cookie-kid-id]");
  if (removePayment) {
    openCookieRemoveModal("payment", removePayment.dataset.cookieKidId, removePayment.dataset.cookieRemovePayment);
  }
});

$("#cookieKidSelect").addEventListener("change", (event) => {
  state.cookieTracker.selectedKidId = event.target.value;
  state.cookieTracker.view = "entry";
  saveState();
  renderCookieTracker();
});

$("#cookieOrderForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#cookieOrderName").value.trim();
  const totalCost = cookieNumber($("#cookieOrderTotal").value);
  if (!name) return showToast("Name the cookie order.");
  cookieOrders().push(normalizeCookieOrder({
    name,
    totalCost,
    chocolateCases: $("#cookieOrderChocolateCases") ? cookieNumber($("#cookieOrderChocolateCases").value) : 0,
    mintCases: $("#cookieOrderMintCases") ? cookieNumber($("#cookieOrderMintCases").value) : 0,
    surplusChocolateCases: $("#cookieOrderSurplusChocolateCases") ? cookieNumber($("#cookieOrderSurplusChocolateCases").value) : 0,
    surplusMintCases: $("#cookieOrderSurplusMintCases") ? cookieNumber($("#cookieOrderSurplusMintCases").value) : 0,
  }));
  state.cookieTracker.view = "progress";
  saveState();
  event.currentTarget.reset();
  renderCookieTracker();
  showToast("Cookie order added.");
});

$("#cookieOrderProgress")?.addEventListener("change", handleCookieOrderInput);

$("#cookieOrderProgress")?.addEventListener("click", (event) => {
  const archive = event.target.closest("[data-archive-cookie-order]");
  if (archive) {
    const order = cookieOrders().find((item) => item.id === archive.dataset.archiveCookieOrder);
    if (order) {
      order.archived = true;
      saveState();
      renderCookieTracker();
      showToast("Cookie order archived.");
    }
    return;
  }

  const unarchive = event.target.closest("[data-unarchive-cookie-order]");
  if (unarchive) {
    const order = cookieOrders().find((item) => item.id === unarchive.dataset.unarchiveCookieOrder);
    if (order) {
      order.archived = false;
      saveState();
      renderCookieTracker();
      showToast("Cookie order restored.");
    }
    return;
  }

  const remove = event.target.closest("[data-remove-cookie-order]");
  if (!remove) return;
  openCookieRemoveModal("order", "", remove.dataset.removeCookieOrder);
});

$("#cookieEntryMode").addEventListener("click", () => {
  state.cookieTracker.view = "entry";
  saveState();
  renderCookieTracker();
});

$("#cookieProgressMode").addEventListener("click", () => {
  state.cookieTracker.view = "progress";
  saveState();
  renderCookieTracker();
});

$("#cookieSummaryMode").addEventListener("click", () => {
  state.cookieTracker.view = "summary";
  saveState();
  renderCookieTracker();
});

$("#resetBadgeForm").addEventListener("click", resetBadgeForm);
$("#badgeTileSearch").addEventListener("input", renderLogBadgeTiles);
$("#badgeTilePicker").addEventListener("input", (event) => {
  const input = event.target.closest("[data-log-badge-credit]");
  if (!input) return;
  const badge = state.badges.find((item) => item.id === input.dataset.logBadgeCredit);
  if (!badge) return;
  selectedMeetingBadgeCredits.set(badge.id, badgeCreditValue(badge, input.value));
});
$("#badgeTilePicker").addEventListener("change", (event) => {
  const input = event.target.closest("[data-log-badge-credit]");
  if (!input) return;
  const badge = state.badges.find((item) => item.id === input.dataset.logBadgeCredit);
  if (!badge) return;
  input.value = badgeCreditValue(badge, input.value);
  selectedMeetingBadgeCredits.set(badge.id, Number(input.value));
});
$("#badgeSearch").addEventListener("input", renderBadges);
$("#attendanceSearch").addEventListener("input", renderAttendanceCalendar);
$("#kidBadgeFilter").addEventListener("change", renderKidBadges);
$("#kidBadgeProgressToggle").addEventListener("click", () => {
  kidBadgeMode = "progress";
  renderKidBadgesKeepingPosition();
});
$("#kidBadgeSummaryToggle").addEventListener("click", () => {
  kidBadgeMode = "summary";
  renderKidBadgesKeepingPosition();
});
$("#kidBadgeHandoutToggle").addEventListener("click", () => {
  kidBadgeMode = "handouts";
  renderKidBadgesKeepingPosition();
});
$("#kidBadgeConfirmationToggle")?.addEventListener("change", (event) => {
  state.settings.badgeEditConfirmation = event.target.checked;
  saveState();
  renderKidBadgesKeepingPosition();
  showToast(event.target.checked ? "Badge confirmations turned on." : "Badge confirmations turned off.");
});

function handleManualBadgeEdit(event, options = {}) {
  const input = event.target.closest("[data-manual-kid-id][data-manual-badge-id]");
  if (!input) return false;
  setManualBadgeCount(input.dataset.manualKidId, input.dataset.manualBadgeId, input.value);
  saveState();
  if (options.render) renderKidBadgesKeepingPosition();
  return true;
}

function handleManualBadgeConfirmationRequest(event) {
  const input = event.target.closest("[data-manual-kid-id][data-manual-badge-id]");
  if (!input) return false;
  const editor = input.closest(".matrix-count-editor");
  editor?.querySelector(".badge-confirm-row")?.remove();
  const confirmRow = document.createElement("span");
  confirmRow.className = "badge-confirm-row";
  confirmRow.innerHTML = `
    <button class="primary-button" data-confirm-manual-badge data-confirm-kid-id="${escapeAttr(input.dataset.manualKidId)}" data-confirm-badge-id="${escapeAttr(input.dataset.manualBadgeId)}" data-confirm-count="${escapeAttr(input.value)}" type="button">Confirm</button>
    <button class="text-button" data-cancel-manual-badge type="button">Cancel</button>
  `;
  editor?.append(confirmRow);
  editor?.classList.add("is-pending");
  return true;
}

function handleCriteriaBadgeEdit(event, options = {}) {
  const input = event.target.closest("[data-criteria-kid-id][data-criteria-badge-id][data-criteria-requirement-id]");
  if (!input) return false;
  if (!badgeEditConfirmationEnabled()) {
    setCriteriaSelection(input.dataset.criteriaKidId, input.dataset.criteriaBadgeId, input.dataset.criteriaRequirementId, input.checked);
    saveState();
    if (options.render) renderKidBadgesKeepingPosition();
    return true;
  }
  const cell = input.closest(".criteria-badge-cell");
  cell?.querySelector(".criteria-confirm-row")?.remove();
  const confirmRow = document.createElement("span");
  confirmRow.className = "criteria-confirm-row";
  confirmRow.innerHTML = `
    <button class="primary-button" data-confirm-criteria="${escapeAttr(input.checked ? "yes" : "no")}" data-confirm-kid-id="${escapeAttr(input.dataset.criteriaKidId)}" data-confirm-badge-id="${escapeAttr(input.dataset.criteriaBadgeId)}" data-confirm-requirement-id="${escapeAttr(input.dataset.criteriaRequirementId)}" type="button">Confirm</button>
    <button class="text-button" data-cancel-criteria type="button">Cancel</button>
  `;
  input.closest(".criteria-check-row")?.append(confirmRow);
  cell?.classList.add("is-pending");
  return true;
}

function handleBadgeHandoutEdit(event, options = {}) {
  const input = event.target.closest("[data-handout-kid-id][data-handout-badge-id]");
  if (!input) return false;
  if (!badgeEditConfirmationEnabled()) {
    setBadgeHandedOut(input.dataset.handoutKidId, input.dataset.handoutBadgeId, input.checked);
    saveState();
    if (options.render) renderKidBadgesKeepingPosition();
    return true;
  }
  const current = badgeHandedOut(input.dataset.handoutKidId, input.dataset.handoutBadgeId);
  input.closest(".handout-check")?.querySelector(".handout-confirm-row")?.remove();
  const confirmRow = document.createElement("span");
  confirmRow.className = "handout-confirm-row";
  confirmRow.innerHTML = `
    <button class="primary-button" data-confirm-handout="${escapeAttr(input.checked ? "yes" : "no")}" data-confirm-kid-id="${escapeAttr(input.dataset.handoutKidId)}" data-confirm-badge-id="${escapeAttr(input.dataset.handoutBadgeId)}" type="button">Confirm</button>
    <button class="text-button" data-cancel-handout type="button">Cancel</button>
  `;
  input.closest(".handout-check")?.append(confirmRow);
  input.closest(".handout-check")?.classList.toggle("is-pending", input.checked !== current);
  return true;
}

$("#kidBadgeCards").addEventListener("change", (event) => {
  if (handleCriteriaBadgeEdit(event, { render: true })) {
    showToast(badgeEditConfirmationEnabled() ? "Confirm the criteria change." : "Badge criteria updated.");
    return;
  }
  if (handleBadgeHandoutEdit(event, { render: true })) {
    showToast(badgeEditConfirmationEnabled() ? "Confirm the badge handout change." : "Badge handout updated.");
    return;
  }
  if (badgeEditConfirmationEnabled() && handleManualBadgeConfirmationRequest(event)) {
    showToast("Confirm the badge progress change.");
    return;
  }
  if (handleManualBadgeEdit(event, { render: true })) showToast("Badge progress corrected.");
});

$("#kidBadgeCards").addEventListener("input", (event) => {
  if (!badgeEditConfirmationEnabled()) handleManualBadgeEdit(event);
});

$("#kidBadgeCards").addEventListener("click", (event) => {
  const criteriaConfirm = event.target.closest("[data-confirm-criteria]");
  if (criteriaConfirm) {
    setCriteriaSelection(
      criteriaConfirm.dataset.confirmKidId,
      criteriaConfirm.dataset.confirmBadgeId,
      criteriaConfirm.dataset.confirmRequirementId,
      criteriaConfirm.dataset.confirmCriteria === "yes"
    );
    saveState();
    renderKidBadgesKeepingPosition();
    showToast("Badge criteria updated.");
    return;
  }
  if (event.target.closest("[data-cancel-criteria]")) {
    renderKidBadgesKeepingPosition();
    showToast("Criteria change cancelled.");
    return;
  }
  const manualConfirm = event.target.closest("[data-confirm-manual-badge]");
  if (manualConfirm) {
    setManualBadgeCount(manualConfirm.dataset.confirmKidId, manualConfirm.dataset.confirmBadgeId, manualConfirm.dataset.confirmCount);
    saveState();
    renderKidBadgesKeepingPosition();
    showToast("Badge progress corrected.");
    return;
  }
  if (event.target.closest("[data-cancel-manual-badge]")) {
    renderKidBadgesKeepingPosition();
    showToast("Badge progress change cancelled.");
    return;
  }
  const confirm = event.target.closest("[data-confirm-handout]");
  if (confirm) {
    setBadgeHandedOut(confirm.dataset.confirmKidId, confirm.dataset.confirmBadgeId, confirm.dataset.confirmHandout === "yes");
    saveState();
    renderKidBadgesKeepingPosition();
    showToast("Badge handout updated.");
    return;
  }
  if (event.target.closest("[data-cancel-handout]")) {
    renderKidBadgesKeepingPosition();
    showToast("Badge handout change cancelled.");
  }
});

function handlePatrolPointSheetEdit(event, options = {}) {
  const input = event.target.closest("[data-patrol-point-meeting-id][data-patrol-point-kid-id]");
  if (!input) return;
  const meeting = state.meetings.find((item) => item.id === input.dataset.patrolPointMeetingId);
  if (!meeting) return;
  const value = Math.max(0, Number(input.value) || 0);
  meeting.emberPoints = meeting.emberPoints || {};
  if (value) meeting.emberPoints[input.dataset.patrolPointKidId] = value;
  else delete meeting.emberPoints[input.dataset.patrolPointKidId];
  recalculateMeetingPatrolPoints(meeting);
  saveState();
  if (options.render) {
    renderPatrolPointsSheetKeepingPosition();
    renderPatrolPoints();
  }
}

$("#patrolPointsSheet").addEventListener("input", handlePatrolPointSheetEdit);
$("#patrolPointsSheet").addEventListener("change", (event) => {
  handlePatrolPointSheetEdit(event, { render: true });
  showToast("Patrol points updated.");
});

$("#patrolPointsEarnedToggle")?.addEventListener("click", () => {
  patrolPointsMode = "earned";
  renderPatrolPointsMode();
});

$("#patrolPointsCashoutToggle")?.addEventListener("click", () => {
  patrolPointsMode = "cashout";
  renderPatrolPointsMode();
});

$("#patrolSpendForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const kidId = $("#patrolSpendKid").value;
  const amount = Math.max(0, Number($("#patrolSpendAmount").value) || 0);
  if (!kidId || !amount) return showToast("Choose an Ember and amount to cash out.");
  state.patrolPointSpending.push(normalizePatrolSpendEntry({
    kidId,
    date: $("#patrolSpendDate").value || today(),
    amount,
    note: $("#patrolSpendNote").value.trim(),
  }));
  saveState();
  event.currentTarget.reset();
  $("#patrolSpendDate").value = today();
  renderPatrolPointsSheetKeepingPosition();
  showToast("Point cash-out recorded.");
});

$("#patrolSpendHistory")?.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-patrol-spend]");
  if (!remove) return;
  state.patrolPointSpending = (state.patrolPointSpending || []).filter((entry) => entry.id !== remove.dataset.removePatrolSpend);
  saveState();
  renderPatrolPointsSheetKeepingPosition();
  showToast("Cash-out removed.");
});

$("#patrolPointInputs").addEventListener("input", renderPatrolPointTotals);

$("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = $("#chatInput").value.trim();
  if (!prompt) return;
  const conversationBeforeReply = chatHistory.slice(-10);
  appendChatMessage("user", `<p>${escapeHtml(prompt)}</p>`);
  chatHistory.push({ role: "user", content: prompt });
  $("#chatInput").value = "";
  const pending = appendChatMessage("assistant", `<p>Thinking through the badges, meeting context, and activity options...</p>`);
  try {
    const answer = await openAiChatAnswer(prompt, conversationBeforeReply);
    pending.innerHTML = plainTextToHtml(answer);
    chatHistory.push({ role: "assistant", content: answer });
  } catch {
    const fallback = chatResponseHtml(prompt);
    pending.innerHTML = fallback;
    chatHistory.push({ role: "assistant", content: textFromHtml(fallback) });
  }
  chatHistory = chatHistory.slice(-12);
  pending.scrollIntoView({ block: "nearest" });
});

$("#chatUseMeeting").addEventListener("click", () => {
  const selectedBadges = [...selectedMeetingBadgeIds]
    .map((id) => state.badges.find((badge) => badge.id === id)?.name)
    .filter(Boolean);
  $("#chatInput").value = [
    $("#meetingTitle").value.trim(),
    $("#meetingNotes").value.trim(),
    selectedBadges.length ? `Selected badges: ${selectedBadges.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  $("#chatInput").focus();
});

$("#chatClear").addEventListener("click", resetChatMessages);

function setAttendanceView(view) {
  attendanceView = view;
  const isCalendar = view === "calendar";
  const isRoster = view === "roster";
  $("#attendanceListToggle").classList.toggle("is-active", !isCalendar && !isRoster);
  $("#attendanceCalendarToggle").classList.toggle("is-active", isCalendar);
  $("#attendanceRosterToggle").classList.toggle("is-active", isRoster);
  $("#attendanceListPanel").classList.toggle("is-active", !isCalendar && !isRoster);
  $("#attendanceCalendarPanel").classList.toggle("is-active", isCalendar);
  $("#attendanceRosterPanel").classList.toggle("is-active", isRoster);
}

$("#attendanceListToggle").addEventListener("click", () => setAttendanceView("list"));
$("#attendanceCalendarToggle").addEventListener("click", () => setAttendanceView("calendar"));
$("#attendanceRosterToggle").addEventListener("click", () => setAttendanceView("roster"));
$("#calendarPrev").addEventListener("click", () => {
  calendarCursor = addMonths(calendarCursor, -1);
  selectedCalendarEventId = "";
  renderAttendanceCalendar();
});
$("#calendarNext").addEventListener("click", () => {
  calendarCursor = addMonths(calendarCursor, 1);
  selectedCalendarEventId = "";
  renderAttendanceCalendar();
});
$("#calendarToday").addEventListener("click", () => {
  calendarCursor = startOfMonth(new Date());
  selectedCalendarEventId = "";
  renderAttendanceCalendar();
});

$("#eventEditForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveEventModal();
});

$("#closeEventModal").addEventListener("click", closeEventModal);

$("#eventModal").addEventListener("click", (event) => {
  if (event.target.id === "eventModal") closeEventModal();
});

$("#completeMeetingForm").addEventListener("submit", (event) => {
  event.preventDefault();
  completeMeetingFromModal();
});

$("#closeCompleteMeeting").addEventListener("click", closeCompleteMeetingModal);

$("#completeMeetingModal").addEventListener("click", (event) => {
  if (event.target.id === "completeMeetingModal") closeCompleteMeetingModal();
});

$("#completeBadgeSearch").addEventListener("input", renderCompletionBadges);

$("#completeBadgeChecklist").addEventListener("change", (event) => {
  const creditInput = event.target.closest("[data-complete-badge-credit]");
  if (creditInput) {
    const badge = state.badges.find((item) => item.id === creditInput.dataset.completeBadgeCredit);
    if (!badge) return;
    creditInput.value = badgeCreditValue(badge, creditInput.value);
    completionBadgeCredits.set(badge.id, Number(creditInput.value));
    return;
  }
  const input = event.target.closest("input[name='completeBadge']");
  if (!input) return;
  const meeting = state.meetings.find((item) => item.id === completionMeetingId);
  if (input.checked) {
    completionBadgeSelection.add(input.value);
    completionBadgeCredits.set(input.value, completionBadgeCredits.get(input.value) || 1);
    if (!Array.isArray(completionBadgeKidIds[input.value])) completionBadgeKidIds[input.value] = [...(meeting?.presentKidIds || [])];
  } else {
    completionBadgeSelection.delete(input.value);
    completionBadgeCredits.delete(input.value);
    delete completionBadgeKidIds[input.value];
  }
  renderCompletionModal();
});

$("#completeBadgeChecklist").addEventListener("input", (event) => {
  const input = event.target.closest("[data-complete-badge-credit]");
  if (!input) return;
  const badge = state.badges.find((item) => item.id === input.dataset.completeBadgeCredit);
  if (!badge) return;
  completionBadgeCredits.set(badge.id, badgeCreditValue(badge, input.value));
});

$("#completeKidBadgeMatrix").addEventListener("change", (event) => {
  const input = event.target.closest("[data-complete-kid-id][data-complete-badge-id]");
  if (!input) return;
  const badgeId = input.dataset.completeBadgeId;
  const kidId = input.dataset.completeKidId;
  const selected = new Set(completionBadgeKidIds[badgeId] || []);
  if (input.checked) selected.add(kidId);
  else selected.delete(kidId);
  completionBadgeKidIds[badgeId] = [...selected];
  renderCompletionKidBadgeMatrix();
});

$("#completeAllPresent").addEventListener("click", () => {
  const meeting = state.meetings.find((item) => item.id === completionMeetingId);
  if (!meeting) return;
  [...completionBadgeSelection].forEach((badgeId) => {
    completionBadgeKidIds[badgeId] = [...(meeting.presentKidIds || [])];
  });
  renderCompletionKidBadgeMatrix();
});

$("#completeClearCredits").addEventListener("click", () => {
  [...completionBadgeSelection].forEach((badgeId) => {
    completionBadgeKidIds[badgeId] = [];
  });
  renderCompletionKidBadgeMatrix();
});

$("#saveAttendanceOnly").addEventListener("click", () => {
  completionBadgeSelection = new Set();
  completionBadgeCredits = new Map();
  completionBadgeKidIds = {};
  completeMeetingFromModal();
});

$("#closeSwitchTracker")?.addEventListener("click", closeSwitchTrackerModal);

$("#switchTrackerModal")?.addEventListener("click", (event) => {
  if (event.target.id === "switchTrackerModal") closeSwitchTrackerModal();
});

$("#cancelRemoveKid")?.addEventListener("click", closeRemoveKidModal);
$("#cancelRemoveKidTop")?.addEventListener("click", closeRemoveKidModal);
$("#removeKidModal")?.addEventListener("click", (event) => {
  if (event.target.id === "removeKidModal") closeRemoveKidModal();
});
$("#confirmRemoveKid")?.addEventListener("click", () => {
  const kidId = $("#removeKidId").value;
  if (!kidId) return closeRemoveKidModal();
  removeKidAndConnectedData(kidId);
  closeRemoveKidModal();
  saveState();
  renderAll();
  showToast("Ember and connected information removed.");
});

$("#cancelRemoveCookie")?.addEventListener("click", closeCookieRemoveModal);
$("#cancelRemoveCookieTop")?.addEventListener("click", closeCookieRemoveModal);
$("#removeCookieModal")?.addEventListener("click", (event) => {
  if (event.target.id === "removeCookieModal") closeCookieRemoveModal();
});
$("#confirmRemoveCookie")?.addEventListener("click", () => {
  const type = $("#removeCookieType").value;
  const kidId = $("#removeCookieKidId").value;
  const itemId = $("#removeCookieItemId").value;
  if (!type || !itemId) return closeCookieRemoveModal();
  const message = removeCookieItem(type, kidId, itemId);
  closeCookieRemoveModal();
  saveState();
  renderCookieTracker();
  showToast(message);
});

$("#refreshSwitchTrackers")?.addEventListener("click", async () => {
  try {
    $("#switchTrackerList").innerHTML = `<p class="muted">Refreshing unit trackers...</p>`;
    await ensureDriveToken(driveAccessToken ? "" : "consent");
    const files = await findDriveSyncFiles();
    renderSwitchTrackerList(files);
    showToast("Unit trackers refreshed.");
  } catch (error) {
    $("#switchTrackerList").innerHTML = `<p class="muted">Could not refresh unit trackers: ${escapeHtml(error.message)}</p>`;
  }
});

$("#switchTrackerList")?.addEventListener("click", async (event) => {
  if (event.target.closest("#switchTrackerPicker")) {
    try {
      const picked = await openDriveFilePicker();
      if (!picked) return;
      await loadDriveFileById(picked.id);
      closeSwitchTrackerModal();
    } catch (error) {
      setDriveSyncStatus(`Could not open tracker from Drive: ${error.message}`, "Needs setup");
      showToast("Could not open tracker from Drive.");
    }
    return;
  }
  const fileButton = event.target.closest("[data-switch-drive-file]");
  if (!fileButton) return;
  try {
    fileButton.disabled = true;
    fileButton.querySelector("span").textContent = "Loading this unit tracker...";
    await loadDriveFileById(fileButton.dataset.switchDriveFile);
    closeSwitchTrackerModal();
  } catch (error) {
    setDriveSyncStatus(`Could not switch tracker: ${error.message}`, "Needs setup");
    showToast("Could not switch unit tracker.");
    renderSwitchTrackerList();
  }
});

$("#eventBadgeSearch").addEventListener("input", renderEventModalBadges);

$("#eventBadgeChecklist").addEventListener("change", (event) => {
  const input = event.target.closest("input[name='eventBadge']");
  if (!input) return;
  if (input.checked) modalBadgeSelection.add(input.value);
  else modalBadgeSelection.delete(input.value);
});

$("#eventAllPresent").addEventListener("click", () => {
  $$("input[name='eventAbsentKid']").forEach((input) => {
    input.checked = false;
  });
});

$("#eventAllAbsent").addEventListener("click", () => {
  $$("input[name='eventAbsentKid']").forEach((input) => {
    input.checked = true;
  });
});

$("#deleteEventFromModal").addEventListener("click", () => {
  const ref = eventRefById($("#eventEditId").value);
  if (!ref || !confirm("Delete this event?")) return;
  if (ref.type === "logged") state.meetings.splice(ref.index, 1);
  if (ref.type === "excel") state.attendanceRecords.splice(ref.index, 1);
  if (ref.type === "scheduled") state.scheduledEvents.splice(ref.index, 1);
  if (ref.type === "planned") state.weeklyPlans.splice(ref.index, 1);
  selectedCalendarEventId = "";
  saveState();
  closeEventModal();
  renderAll();
  setAttendanceView("calendar");
  showToast("Event deleted.");
});

$("#selectShownBadges").addEventListener("click", () => {
  visibleLogBadges().filter((badge) => !isProgramAreaBadge(badge)).forEach((badge) => {
    selectedMeetingBadgeIds.add(badge.id);
    selectedMeetingBadgeCredits.set(badge.id, selectedMeetingBadgeCredits.get(badge.id) || 1);
  });
  renderLogBadgeTiles();
  renderAttendanceGrid();
});

$("#clearShownBadges").addEventListener("click", () => {
  visibleLogBadges().forEach((badge) => {
    selectedMeetingBadgeIds.delete(badge.id);
    selectedMeetingBadgeCredits.delete(badge.id);
  });
  renderLogBadgeTiles();
  renderAttendanceGrid();
});

$("#markAllPresent").addEventListener("click", () => {
  $$("[data-attendance-kid-id]").forEach((input) => {
    input.value = "present";
  });
  renderAttendanceGrid();
});

$("#markAllAbsent").addEventListener("click", () => {
  $$("[data-attendance-kid-id]").forEach((input) => {
    input.value = "absent";
  });
  renderAttendanceGrid();
});

$("#attendanceGrid").addEventListener("change", (event) => {
  if (event.target.closest("[data-attendance-kid-id]")) renderAttendanceGrid();
});

$("#clearData").addEventListener("click", () => {
  if (!confirm("Clear all Embers, badges, and meeting history from this browser?")) return;
  state = buildEmptyData();
  saveState();
  renderAll();
  showToast("All data cleared.");
});

$("#exportJson").addEventListener("click", saveJsonBackup);
$("#exportJsonTop").addEventListener("click", saveJsonBackup);
$("#saveJsonBackup")?.addEventListener("click", saveJsonBackup);
$("#exportCsv").addEventListener("click", exportProgressCsv);

$("#loginDriveLoad")?.addEventListener("click", async () => {
  try {
    await signInAndFindDriveFile();
  } catch (error) {
    setDriveSyncStatus(`Sign in failed: ${error.message}`, "Needs setup");
    showToast("Could not load Google Drive data.");
  }
});

$("#loginCodeOpen")?.addEventListener("click", async () => {
  try {
    await pullAppScriptTracker("login");
    switchTab("planning");
    showToast("Tracker opened by code.");
  } catch (error) {
    setAppScriptSyncStatus(`Could not open tracker code: ${error.message}`, "Needs setup");
    showToast("Could not open tracker code.");
  }
});

$("#loginCodeCreate")?.addEventListener("click", async () => {
  try {
    const created = await createAppScriptTracker("login-create");
    const sync = appScriptSyncSettings();
    if ($("#loginTrackerCode")) $("#loginTrackerCode").value = sync.trackerCode || created.code || "";
    if ($("#loginTrackerPin")) $("#loginTrackerPin").value = sync.pin || "";
    await pullAppScriptTracker("login");
    switchTab("planning");
    showToast(`Tracker code created: ${created.code}`);
  } catch (error) {
    setAppScriptSyncStatus(`Could not create tracker code: ${error.message}`, "Needs setup");
    showToast("Could not create tracker code.");
  }
});

["#loginCodeEndpoint", "#loginTrackerCode", "#loginTrackerPin"].forEach((selector) => {
  $(selector)?.addEventListener("change", () => saveAppScriptSyncSettingsFromForm("login"));
});

$("#loginBranch")?.addEventListener("change", (event) => {
  state.settings.branch = branchValue(event.target.value);
  renderBranchCopy();
});

$("#loginTrackerCode")?.addEventListener("input", (event) => {
  const title = event.target.value.trim().toUpperCase() || "Tracker";
  $("#appTitle").textContent = title;
  $("#loginAppTitle").textContent = title;
  document.title = title;
});

$("#loginDriveChooser")?.addEventListener("click", async (event) => {
  const fileButton = event.target.closest("[data-login-drive-file]");
  if (fileButton) {
    try {
      await loadDriveFileById(fileButton.dataset.loginDriveFile);
    } catch (error) {
      setDriveSyncStatus(`Could not load selected file: ${error.message}`, "Needs setup");
      showToast("Could not load selected file.");
    }
    return;
  }
  if (event.target.closest("#loginDrivePicker")) {
    try {
      const picked = await openDriveFilePicker();
      if (!picked) return;
      await loadDriveFileById(picked.id);
    } catch (error) {
      setDriveSyncStatus(`Could not open tracker from Drive: ${error.message}`, "Needs setup");
      showToast("Could not open tracker from Drive.");
    }
    return;
  }
  if (!event.target.closest("#loginDriveCreate")) return;
  try {
    saveDriveSyncSettingsFromForm("login");
    if (!driveAccessToken) await requestDriveAccessToken("consent");
    await createDriveSyncFile($("#loginDriveNewFileName")?.value || "");
    switchTab("planning");
    showToast("Shared Google Drive file created.");
  } catch (error) {
    setDriveSyncStatus(`Could not create shared file: ${error.message}`, "Needs setup");
    showToast("Could not create shared file.");
  }
});

$("#appScriptCreateTracker")?.addEventListener("click", async () => {
  try {
    const created = await createAppScriptTracker("data");
    showToast(`Tracker code created: ${created.code}`);
  } catch (error) {
    setAppScriptSyncStatus(`Create failed: ${error.message}`, "Needs setup");
    showToast("Could not create tracker code.");
  }
});

["#appScriptEndpoint", "#appScriptTrackerCode", "#appScriptPin", "#appScriptTrackerName", "#appScriptAdminPin", "#appScriptAutoPush"].forEach((selector) => {
  $(selector)?.addEventListener("change", () => saveAppScriptSyncSettingsFromForm("data"));
});

$("#appScriptPullTracker")?.addEventListener("click", async () => {
  try {
    await pullAppScriptTracker("data");
    showToast("Tracker code pulled.");
  } catch (error) {
    setAppScriptSyncStatus(`Pull failed: ${error.message}`, "Needs setup");
    showToast("Could not pull tracker code.");
  }
});

$("#appScriptPushTracker")?.addEventListener("click", async () => {
  try {
    saveAppScriptSyncSettingsFromForm("data");
    await pushAppScriptTracker();
  } catch (error) {
    setAppScriptSyncStatus(`Push failed: ${error.message}`, "Needs setup");
    showToast("Could not push tracker code.");
  }
});

$("#appScriptListTrackers")?.addEventListener("click", async () => {
  try {
    await listAppScriptTrackers();
  } catch (error) {
    setAppScriptSyncStatus(`List failed: ${error.message}`, "Needs setup");
    showToast("Could not list trackers.");
  }
});

$("#appScriptTrackerList")?.addEventListener("click", async (event) => {
  const tracker = event.target.closest("[data-app-script-tracker-code]");
  if (!tracker) return;
  try {
    const code = tracker.dataset.appScriptTrackerCode || "";
    const adminPin = $("#appScriptAdminPin")?.value.trim() || appScriptSyncSettings().adminPin || "";
    $("#appScriptTrackerCode").value = code;
    await adminOpenAppScriptTracker(code, adminPin);
    switchTab("planning");
    showToast("Tracker opened with admin access.");
  } catch (error) {
    setAppScriptSyncStatus(`Admin open failed: ${error.message}`, "Needs setup");
    showToast("Could not open tracker with admin access.");
  }
});

$("#driveOpenPicker")?.addEventListener("click", async () => {
  try {
    saveDriveSyncSettingsFromForm();
    const picked = await openDriveFilePicker();
    if (!picked) return;
    await loadDriveFileById(picked.id);
  } catch (error) {
    setDriveSyncStatus(`Open from Drive failed: ${error.message}`, "Needs setup");
    showToast("Could not open tracker from Drive.");
  }
});

$("#driveFileSelect")?.addEventListener("change", (event) => {
  const selected = driveTrackerFiles.find((file) => file.id === event.target.value);
  rememberSelectedDriveFile(selected || { id: event.target.value });
  suppressDriveAutoPush = true;
  saveState();
  suppressDriveAutoPush = false;
  renderDriveSyncSettings();
});

$("#driveRefreshFiles")?.addEventListener("click", async () => {
  try {
    saveDriveSyncSettingsFromForm();
    await ensureDriveToken(driveAccessToken ? "" : "consent");
    setDriveSyncStatus(`Refreshing ${DRIVE_SYNC_FOLDER_NAME}...`, "Working");
    const files = await findDriveSyncFiles();
    setDriveSyncStatus(files.length ? "Unit trackers refreshed. Choose the unit to load." : "No unit trackers found. Create a named unit tracker.", files.length ? "Connected" : "No unit found");
    showToast("Unit trackers refreshed.");
  } catch (error) {
    setDriveSyncStatus(`Refresh failed: ${error.message}`, "Needs setup");
    showToast("Could not refresh unit trackers.");
  }
});

$("#driveCreateNamedFile")?.addEventListener("click", async () => {
  try {
    saveDriveSyncSettingsFromForm();
    await ensureDriveToken(driveAccessToken ? "" : "consent");
    const created = await createDriveSyncFile($("#driveNewFileName")?.value || "");
    $("#driveNewFileName").value = "";
    showToast(`Created ${created.name || "unit tracker"}.`);
  } catch (error) {
    setDriveSyncStatus(`Create failed: ${error.message}`, "Needs setup");
    showToast("Could not create unit tracker.");
  }
});

$("#drivePullFile")?.addEventListener("click", async () => {
  try {
    saveDriveSyncSettingsFromForm();
    await ensureDriveToken(driveAccessToken ? "" : "consent");
    await pullDriveSyncFile();
    showToast("Selected unit tracker pulled.");
  } catch (error) {
    setDriveSyncStatus(`Pull failed: ${error.message}`, "Needs setup");
    showToast("Could not pull unit tracker.");
  }
});

$("#drivePushFile")?.addEventListener("click", async () => {
  try {
    saveDriveSyncSettingsFromForm();
    await ensureDriveToken(driveAccessToken ? "" : "consent");
    await pushDriveSyncFile();
    showToast("Current unit tracker pushed.");
  } catch (error) {
    setDriveSyncStatus(`Push failed: ${error.message}`, "Needs setup");
    showToast("Could not push unit tracker.");
  }
});

$("#loginOffline")?.addEventListener("click", () => {
  if (!window.confirm("Open without checking Google Drive? Use this only when you cannot get online.")) return;
  switchTab("planning");
  showToast("Opened offline. Pull latest when you reconnect.");
});

async function handleImportJsonChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importJsonBackup(file);
  } catch {
    showToast("That file was not a valid backup.");
  } finally {
    event.target.value = "";
  }
}

$("#importJson").addEventListener("change", handleImportJsonChange);
$("#backupImportJson")?.addEventListener("change", handleImportJsonChange);

window.addEventListener("resize", queueMeetingBadgePanelSync);
if ("ResizeObserver" in window) {
  const meetingPanelObserver = new ResizeObserver(queueMeetingBadgePanelSync);
  const meetingForm = $("#meetingForm");
  meetingForm?.querySelectorAll(".surface:nth-child(1), .surface:nth-child(3)").forEach((surface) => meetingPanelObserver.observe(surface));
}

renderAll();
resetChatMessages();
if (appScriptSyncSettings().trackerCode && appScriptSyncSettings().pin) {
  setAppScriptSyncStatus("Remembered tracker code and PIN. Click Open tracker to load the latest saved version.");
} else {
  setAppScriptSyncStatus("Enter a tracker code and PIN to open a unit tracker.");
}
