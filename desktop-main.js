const path = require("node:path");
const { app, BrowserWindow, dialog, shell } = require("electron");

process.env.PORT = process.env.PORT || "8767";
process.env.AI_PROVIDER = process.env.AI_PROVIDER || "ollama";

const localServer = require("./server");

const UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/AidenCarr5/embersguide/main/update.json";
const RELEASE_API_URL = "https://api.github.com/repos/AidenCarr5/embersguide/releases/latest";
const RELEASES_URL = "https://github.com/AidenCarr5/embersguide/releases/latest";

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
  if (release?.assets && !Array.isArray(release.assets)) {
    const url = release.assets[process.platform];
    if (!url) return null;
    return {
      name: path.basename(new URL(url).pathname),
      browser_download_url: url,
    };
  }
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const extension = process.platform === "darwin" ? ".dmg" : ".exe";
  return assets.find((asset) => String(asset.name || "").toLowerCase().endsWith(extension));
}

function releaseVersion(release) {
  return String(release?.version || release?.tag_name || "").replace(/^v/i, "");
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

async function showManualUpdateMessage(win, message, detail = "") {
  if (!win || win.isDestroyed()) return;
  await dialog.showMessageBox(win, {
    type: "info",
    buttons: ["OK"],
    title: "Update check",
    message,
    detail,
  });
}

async function openReleasesPage(win, message, detail = "") {
  const choice = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Open downloads page", "OK"],
    defaultId: 0,
    cancelId: 1,
    title: "Update check",
    message,
    detail,
  });
  if (choice.response === 0) {
    const openError = await shell.openExternal(RELEASES_URL);
    if (openError) throw new Error(openError);
  }
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`, {
    headers: { "User-Agent": "Embers-Tracker-Updater", ...headers },
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  return response.json();
}

async function latestReleaseInfo() {
  try {
    return await fetchJson(UPDATE_MANIFEST_URL);
  } catch {
    return fetchJson(RELEASE_API_URL, { Accept: "application/vnd.github+json" });
  }
}

async function checkForUpdates(win, { manual = false } = {}) {
  if (!app.isPackaged && !manual) return;
  try {
    setLauncherStatus(win, "Checking for updates...");
    const release = await latestReleaseInfo();
    const latestVersion = releaseVersion(release);
    if (!latestVersion || compareVersions(latestVersion, app.getVersion()) <= 0) {
      setLauncherStatus(win, manual ? "You already have the latest version." : "Ready.");
      if (manual) {
        await showManualUpdateMessage(
          win,
          "You already have the latest version.",
          `Installed version: ${app.getVersion()}\nLatest release: ${latestVersion || "unknown"}`
        );
      }
      return;
    }
    const asset = installerAssetForPlatform(release);
    if (!asset) {
      setLauncherStatus(win, `Version ${latestVersion} is available, but no installer was attached.`);
      if (manual) {
        await showManualUpdateMessage(
          win,
          `Version ${latestVersion} is available, but no installer was attached.`,
          "The GitHub release exists, but this computer needs an installer asset for its platform."
        );
      }
      return;
    }
    const choice = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Download update", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `Embers Tracker ${latestVersion} is available.`,
      detail: "Download the newest installer in your web browser? The tracker data is stored in your unit tracker, so updating the app will not erase it.",
    });
    if (choice.response !== 0) {
      setLauncherStatus(win, "Update skipped for now.");
      return;
    }
    setLauncherStatus(win, "Opening download in your browser...");
    const openError = await shell.openExternal(asset.browser_download_url);
    if (openError) throw new Error(openError);
    setLauncherStatus(win, `Download opened for ${asset.name}. Run the installer after it finishes downloading.`);
  } catch (error) {
    setLauncherStatus(win, manual ? `Update check failed: ${error.message}` : "Ready.");
    if (manual) {
      await openReleasesPage(
        win,
        "Update check failed.",
        `${error.message || "Unknown error."}\n\nYou can still open the downloads page and install the latest version manually.`
      );
    }
  }
}

async function createWindow() {
  let trackerUrl = "http://127.0.0.1:8767/";
  try {
    await localServer.ready;
    trackerUrl = localServer.getUrl();
  } catch (error) {
    await dialog.showErrorBox("Tracker server failed to start", error.message || "Unknown server error.");
  }

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
            const status = document.getElementById("status");
            if (status) status.textContent = "Checking for updates...";
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
