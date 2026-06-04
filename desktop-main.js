const path = require("node:path");
const { app, BrowserWindow, shell } = require("electron");

process.env.PORT = process.env.PORT || "8767";
process.env.AI_PROVIDER = process.env.AI_PROVIDER || "ollama";

require("./server");

const trackerUrl = `http://127.0.0.1:${process.env.PORT}/`;

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
        </style>
      </head>
      <body>
        <main>
          <h1>Embers Tracker</h1>
          <p>The tracker is running locally. It opens in your regular browser so Google Drive sign-in works correctly.</p>
          <button id="open">Open tracker</button>
          <p>Keep this window open while using the tracker.</p>
        </main>
        <script>
          document.getElementById("open").addEventListener("click", () => {
            location.href = "embextra://open";
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
  });

  shell.openExternal(trackerUrl);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
