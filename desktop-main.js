const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { app, BrowserWindow, dialog, shell } = require("electron");

process.env.PORT = process.env.PORT || "8767";
process.env.AI_PROVIDER = process.env.AI_PROVIDER || "ollama";

require("./server");

const trackerUrl = `http://127.0.0.1:${process.env.PORT}/`;
const RELEASE_API_URL = "https://api.github.com/repos/AidenCarr5/embersguide/releases/latest";

function compareVersions(left, right) {
  const leftParts = String(left || "").replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "").replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff) return diff;
  }
  return 0;
}

function installerAssetForPlatform(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const extension = process.platform === "darwin" ? ".dmg" : ".exe";
  return assets.find((asset) => String(asset.name || "").toLowerCase().endsWith(extension));
}

function setLauncherStatus(win, message) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`
    {
      const status = document.getElementById("status");
      if (status) status.textContent = ${JSON.stringify(message)};
    }
  `).catch(() => {});
}

async function downloadReleaseAsset(asset) {
  const response = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "Embers-Tracker-Updater" },
  });
  if (!response.ok) throw new Error(`Download failed with status ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const destination = path.join(os.tmpdir(), asset.name || `Embers-Tracker-Update-${Date.now()}`);
  await fs.writeFile(destination, bytes);
  return destination;
}

async function checkForUpdates(win, { manual = false } = {}) {
  if (!app.isPackaged && !manual) return;
  try {
    setLauncherStatus(win, "Checking for updates...");
    const response = await fetch(RELEASE_API_URL, {
      headers: { "User-Agent": "Embers-Tracker-Updater" },
    });
    if (response.status === 404) {
      setLauncherStatus(win, manual ? "No GitHub release has been published yet." : "Ready.");
      return;
    }
    if (!response.ok) throw new Error(`GitHub returned status ${response.status}.`);
    const release = await response.json();
    const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
    if (!latestVersion || compareVersions(latestVersion, app.getVersion()) <= 0) {
      setLauncherStatus(win, manual ? "You already have the latest version." : "Ready.");
      return;
    }
    const asset = installerAssetForPlatform(release);
    if (!asset) {
      setLauncherStatus(win, `Version ${latestVersion} is available, but no installer was attached.`);
      return;
    }
    const choice = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Download update", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `Embers Tracker ${latestVersion} is available.`,
      detail: "Download the newest installer now? The tracker data is stored in your unit tracker, so updating the app will not erase it.",
    });
    if (choice.response !== 0) {
      setLauncherStatus(win, "Update skipped for now.");
      return;
    }
    setLauncherStatus(win, `Downloading ${asset.name}...`);
    const installerPath = await downloadReleaseAsset(asset);
    setLauncherStatus(win, "Opening installer...");
    const openError = await shell.openPath(installerPath);
    if (openError) throw new Error(openError);
    app.quit();
  } catch (error) {
    setLauncherStatus(win, manual ? `Update check failed: ${error.message}` : "Ready.");
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 460,
    height: 300,
    resizable: false,
    title: "Embers Tracker",
    icon: path.join(__dirname, "assets", "girl-guides-trefoil-icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Embers Tracker</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            color: #081925;
            background: linear-gradient(180deg, #dff8fd, #f8fdff);
            font-family: "Segoe UI", Arial, sans-serif;
          }
          main {
            width: min(360px, calc(100vw - 40px));
            display: grid;
            gap: 14px;
            padding: 24px;
            border: 1px solid #c8dce4;
            border-radius: 8px;
            background: white;
            box-shadow: 0 16px 38px rgba(8, 25, 37, 0.14);
          }
          h1 { margin: 0; font-size: 28px; }
          p { margin: 0; color: #5b6d78; line-height: 1.45; }
          button {
            min-height: 42px;
            border: 1px solid #004f78;
            border-radius: 8px;
            color: white;
            background: #075f91;
            font: inherit;
            font-weight: 800;
            cursor: pointer;
          }
          .secondary {
            color: #075f91;
            background: white;
            border-color: #c8dce4;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Embers Tracker</h1>
          <p>The tracker is running locally. It opens in your regular browser so tracker-code sync works correctly.</p>
          <button id="open">Open tracker</button>
          <button class="secondary" id="update">Check for updates</button>
          <p id="status">Ready.</p>
          <p>Keep this window open while using the tracker.</p>
        </main>
        <script>
          document.getElementById("open").addEventListener("click", () => {
            location.href = "embextra://open";
          });
          document.getElementById("update").addEventListener("click", () => {
            location.href = "embextra://update";
          });
        </script>
      </body>
    </html>
  `)}`);

  win.webContents.on("will-navigate", (event, url) => {
    if (url === "embextra://open") {
      event.preventDefault();
      shell.openExternal(trackerUrl);
    }
    if (url === "embextra://update") {
      event.preventDefault();
      checkForUpdates(win, { manual: true });
    }
  });

  shell.openExternal(trackerUrl);
  setTimeout(() => checkForUpdates(win), 4000);
  setInterval(() => checkForUpdates(win), 1000 * 60 * 60 * 6);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
