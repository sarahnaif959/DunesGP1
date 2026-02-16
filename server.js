const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");
const admin = require("firebase-admin");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ======== FIREBASE (SERVER-SIDE) ========
// Provide ONE of the following in your .env:
// 1) FIREBASE_SERVICE_ACCOUNT_KEY_PATH=/absolute/or/relative/path/to/serviceAccount.json
// OR
// 2) FIREBASE_SERVICE_ACCOUNT_JSON={...full json...}
// Optional:
// FIREBASE_PROJECT_ID=your-project-id (only needed if not present in the JSON)
function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  let serviceAccount;
  if (keyPath) {
    const abs = path.isAbsolute(keyPath) ? keyPath : path.join(__dirname, keyPath);
    const fileText = fs.readFileSync(abs, "utf8");
    serviceAccount = JSON.parse(fileText);
  } else {
    if (!rawJson) {
      console.warn("⚠️ Firebase not configured: missing FIREBASE_SERVICE_ACCOUNT_KEY_PATH or FIREBASE_SERVICE_ACCOUNT_JSON");
      return;
    }
    serviceAccount = JSON.parse(rawJson);
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
  });

  console.log("✅ Firebase Admin initialized");
}

function getDb() {
  initFirebaseAdmin();
  if (!admin.apps.length) return null;
  return admin.firestore();
}

// ======== GOOGLE DRIVE FOLDER IDS ========
// Put your folder IDs here (already extracted from your links)
const SCREENSHOTS_FOLDER_ID = "1Vzpa_EQogbOhSzkhyuIKhiZHg3WCcMkQ";
const MASKS_FOLDER_ID = "1J9kRGU9W_K68ff1ENUIY42HH2a8JiG3m";

// Normalize filenames for pairing: ignore extension, trim, lowercase
function baseName(fileName) {
  const name = String(fileName || "").trim().toLowerCase();
  return name.replace(/\.[^/.]+$/, "");
}

// ======== MIDDLEWARE ========
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => { console.log("➡️", req.method, req.url); next(); });
app.use(express.static(path.join(__dirname, "public")));

// Optional but explicit:
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/__ping", (_req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});


// ======== API: SAVE LABEL/RESULT TO FIRESTORE ========
// Client should POST JSON like:
// {
//   "userName": "Sarah",
//   "acceptedTerms": true,
//   "isDune": true,
//   "pair": { "name": "...", "expertFileId": "...", "maskFileId": "...", "maskName": "..." }
// }
app.post("/api/results", async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: "Firebase is not configured on the server",
        message: "Set FIREBASE_SERVICE_ACCOUNT_KEY_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in .env",
      });
    }

    const { userName, acceptedTerms, isDune, pair } = req.body || {};

    // Basic validation
    if (!userName || typeof userName !== "string") {
      return res.status(400).json({ ok: false, error: "Missing userName" });
    }
    if (acceptedTerms !== true) {
      return res.status(400).json({ ok: false, error: "Terms must be accepted" });
    }
    if (typeof isDune !== "boolean") {
      return res.status(400).json({ ok: false, error: "Missing isDune boolean" });
    }
    if (!pair || typeof pair !== "object" || !pair.expertFileId || !pair.maskFileId) {
      return res.status(400).json({ ok: false, error: "Missing pair (expertFileId/maskFileId)" });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Create a stable doc id for (user + expertFileId + maskFileId)
    // This prevents duplicates if user clicks twice.
    const docId = `${userName.trim()}__${pair.expertFileId}__${pair.maskFileId}`.replace(/\s+/g, "_");

    await db.collection("results").doc(docId).set(
      {
        userName: userName.trim(),
        acceptedTerms: true,
        isDune,
        pair: {
          name: pair.name || null,
          expertFileId: pair.expertFileId,
          maskFileId: pair.maskFileId,
          maskName: pair.maskName || null,
        },
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    res.json({ ok: true, id: docId });
  } catch (err) {
    console.error("Firestore write error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to save result",
      message: err?.message || String(err),
    });
  }
});

// Quick health check for Firebase
app.get("/api/firebase/ping", async (_req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: "Firebase is not configured on the server",
      });
    }
    // Lightweight call
    const info = await db.collection("__meta").doc("ping").get();
    res.json({ ok: true, hasPingDoc: info.exists });
  } catch (err) {
    res.status(500).json({ ok: false, error: "firebase ping failed", message: err?.message || String(err) });
  }
});



// ======== GOOGLE DRIVE CONNECTION ========
function getDrive() {
  // Recommended: point to the downloaded service account key file.
  // In .env set: GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/absolute/path/to/key.json
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let creds;

  if (keyPath) {
    const abs = path.isAbsolute(keyPath) ? keyPath : path.join(__dirname, keyPath);
    const fileText = fs.readFileSync(abs, "utf8");
    creds = JSON.parse(fileText);
  } else {
    if (!rawJson) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_PATH (recommended) or GOOGLE_SERVICE_ACCOUNT_JSON in .env");
    // If you store JSON in env, it MUST be valid JSON (no surrounding quotes issues)
    creds = JSON.parse(rawJson);
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

async function listFolderFiles(drive, folderId) {
  const files = [];
  let pageToken;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: 1000,
      pageToken,
    });

    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return files;
}

// ======== API: GET MATCHED IMAGE PAIRS ========
app.get("/api/pairs", async (req, res) => {
  try {
    const drive = getDrive();

    const [shots, masks] = await Promise.all([
      listFolderFiles(drive, SCREENSHOTS_FOLDER_ID),
      listFolderFiles(drive, MASKS_FOLDER_ID),
    ]);

    // Build maps keyed by base filename (ignoring extension)
    const shotsMap = new Map();
    for (const f of shots) {
      const key = baseName(f.name);
      if (!key) continue;
      if (!shotsMap.has(key)) shotsMap.set(key, { id: f.id, name: f.name });
    }

    const masksMap = new Map();
    for (const f of masks) {
      const key = baseName(f.name);
      if (!key) continue;
      if (!masksMap.has(key)) masksMap.set(key, { id: f.id, name: f.name });
    }

    const pairs = [];
    for (const [key, shot] of shotsMap.entries()) {
      const second = masksMap.get(key);
      if (second) {
        pairs.push({
          name: shot.name,
          expertFileId: shot.id,
          maskFileId: second.id,
          maskName: second.name,
        });
      }
    }

    pairs.sort((a, b) => baseName(a.name).localeCompare(baseName(b.name)));
    res.json(pairs);
  } catch (err) {
    console.error("Drive error:", err);
    res.status(500).json({
      error: "Failed to load pairs",
      message: err?.message || String(err),
    });
  }
});

// ======== API: STREAM IMAGE FROM GOOGLE DRIVE ========
app.get("/api/file/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const drive = getDrive();

    const meta = await drive.files.get({ fileId, fields: "mimeType,name" });
    const mimeType = meta.data.mimeType || "application/octet-stream";

    const fileResp = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    res.setHeader("Content-Type", mimeType);
    fileResp.data.pipe(res);
  } catch (err) {
    console.error("File stream error:", err);
    res.status(500).json({
      error: "Failed to load file",
      message: err?.message || String(err),
    });
  }
});

app.get("/api/debug", async (_req, res) => {
  try {
    const drive = getDrive();

    const shots = await listFolderFiles(drive, SCREENSHOTS_FOLDER_ID);
    const masks = await listFolderFiles(drive, MASKS_FOLDER_ID);

    res.json({
      screenshots_count: shots.length,
      masks_count: masks.length,
      screenshots_sample: shots.slice(0, 10).map(f => f.name),
      masks_sample: masks.slice(0, 10).map(f => f.name),
    });
  } catch (err) {
    res.status(500).json({ error: "debug failed", message: err?.message || String(err) });
  }
});

const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
server.on("error", (err) => {
  console.error("❌ Listen error:", err);
});