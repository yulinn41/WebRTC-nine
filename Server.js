// server.js
// Node.js + Express 靜態檔案 + WebSocket Signaling
// - 首頁顯示使用說明
// - 維護 peers 與 viewers 線上清單
// - 註冊即自動配對（A1<->A2, B1<->B2, C1<->C2, D1<->D2）
// - 中繼 viewer 與 peer 的 SDP / ICE

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static("public"));

// 首頁說明（避免 Cannot GET /）
app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>WebRTC Nine</title></head>
<body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Arial;">
  <h2>請選擇角色</h2>
  <ul>
    <li><a href="/peer.html?id=A1">Peer A1</a></li>
    <li><a href="/peer.html?id=A2">Peer A2</a></li>
    <li><a href="/peer.html?id=B1">Peer B1</a></li>
    <li><a href="/peer.html?id=B2">Peer B2</a></li>
    <li><a href="/peer.html?id=C1">Peer C1</a></li>
    <li><a href="/peer.html?id=C2">Peer C2</a></li>
    <li><a href="/peer.html?id=D1">Peer D1</a></li>
    <li><a href="/peer.html?id=D2">Peer D2</a></li>
    <li><a href="/viewer.html">Viewer（查詢端）</a></li>
  </ul>
  <p>Peer 端請務必使用上方帶 <code>?id=</code> 的連結（A1～D2）。</p>
</body>
</html>`);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const peers = {};   // id -> ws （A1..D2）
const viewers = {}; // id -> ws （viewer-xxxxx）

const PAIRS = { A1:"A2", A2:"A1", B1:"B2", B2:"B1", C1:"C2", C2:"C1", D1:"D2", D2:"D1" };

function safeSend(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch {}
}

function broadcastPeerList() {
  const online = Object.keys(peers);
  Object.values(viewers).forEach(vws => {
    safeSend(vws, { type: "peerList", peers: online });
  });
}

function tryPair(id) {
  const partner = PAIRS[id];
  if (!partner) return;
  if (peers[id] && peers[partner]) {
    // 同步通知雙方開始配對
    safeSend(peers[id],      { type: "startPair", partnerId: partner });
    safeSend(peers[partner], { type: "startPair", partnerId: id });
    console.log(`配對成功：${id} <--> ${partner}`);
  }
}

wss.on("connection", (ws) => {
  ws.meta = { id: null, role: null };

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    // 註冊
    if (msg.type === "register") {
      const { id, role } = msg;
      ws.meta.id = id;
      ws.meta.role = role;

      if (role === "peer") {
        peers[id] = ws;
        console.log("Peer registered:", id);
        safeSend(ws, { type: "registered", id });
        broadcastPeerList();
        tryPair(id); // ✅ 註冊當下就嘗試配對
        return;
      }
      if (role === "viewer") {
        viewers[id] = ws;
        console.log("Viewer registered:", id);
        safeSend(ws, { type: "registered", id });
        broadcastPeerList(); // 告知目前線上 peers
        return;
      }
    }

    // 中繼（viewer/peer 互相傳 offer/answer/candidate）
    if (msg.type === "relay") {
      const { to, payload } = msg;
      const fromId = ws.meta.id;
      payload.from = fromId;

      if (peers[to]) { safeSend(peers[to], { type: "relay", payload }); return; }
      if (viewers[to]) { safeSend(viewers[to], { type: "relay", payload }); return; }

      // 目標不在線，若是 viewer 的請求，就提示
      if (ws.meta.role === "viewer") {
        safeSend(ws, { type: "peerOffline", to });
      }
      return;
    }
  });

  ws.on("close", () => {
    const { id, role } = ws.meta;
    if (role === "peer" && peers[id] === ws) {
      delete peers[id];
      console.log("Peer disconnected:", id);
      broadcastPeerList();
    }
    if (role === "viewer" && viewers[id] === ws) {
      delete viewers[id];
      console.log("Viewer disconnected:", id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
