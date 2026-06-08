# Tracker Code Sync Setup

This sync option avoids Google OAuth in the desktop app. Leaders use a shared tracker code and PIN instead of signing in with Google.

## Create the Google Apps Script backend

1. Go to https://script.google.com/.
2. Create a new project named `Embers Tracker Sync`.
3. Replace the default code with the contents of `apps-script/Code.gs`.
4. Click **Deploy > New deployment**.
5. Choose **Web app**.
6. Set **Execute as** to `Me`.
7. Set **Who has access** to `Anyone`.
8. Click **Deploy** and copy the web app URL ending in `/exec`.

The script stores tracker JSON files in a Google Drive folder named `Embers Tracker Cloud Sync` under the script owner's Google account.

## Use it in Embers Tracker

1. Open Embers Tracker.
2. Go to **Data > Tracker code sync**.
3. Paste the Apps Script web app URL.
4. Enter a tracker name and PIN.
5. Click **Create tracker code**.
6. Share the generated tracker code and PIN with other leaders.

Other leaders can open the same tracker from the login screen by entering the web app URL, tracker code, and PIN.

## Admin code

The Data page includes **List all trackers**. This uses an admin code so the script owner can see every tracker code created through the Apps Script backend.

- The first admin code entered becomes the admin code for that Apps Script deployment.
- After that, the same admin code is required to list all trackers.
- To reset the admin code, open the Apps Script project, go to **Project Settings > Script properties**, and delete `ADMIN_PIN_HASH`.

## Notes

- No Google sign-in is required inside Embers Tracker.
- Anyone with the web app URL, tracker code, and PIN can read or edit that tracker.
- Anyone with the web app URL and admin code can list tracker names and tracker codes.
- Keep the PIN private and use a different PIN for each unit tracker.
- If multiple leaders edit at the exact same time, the latest save can overwrite earlier changes.
