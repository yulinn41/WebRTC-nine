// server.js
// 簡單的 Express + WebSocket signaling：支援
// 1) 固定配對 A1<->A2, B1<->B2, C1<->C2, D1<->D2
// 2) Viewer 單向觀看任一 Peer（recvonly）
// 不做 SFU，皆為 P2P，一對一

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

const idToWS = new Map();     // id -> ws
const wsToId = new Map();     // ws -> id
const idToRole = new Map();   // id -> 'peer' | 'viewer'

// 固定配對表
const PAIRS = {
  "A1": "A2", "A2": "A1",
  "B1": "B2", "B2": "B1",
  "C1": "C2", "C2": "C1",
  "D1": "D2", "D2": "D1"
};

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function getPartnerId(id) {
  return PAIRS[id] || null;
}

wss.on("connection", (ws) => {
  console.log("[WS] client connected");

  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); }
    catch { return; }

    const { type } = data;

    // 使用者註冊：{ type:'register', id:'A1', role:'peer'|'viewer' }
    if (type === "register") {
      const { id, role } = data;
      if (!id || !role) return;

      // 若同 ID 已在線，先踢掉舊的
      const old = idToWS.get(id);
      if (old && old !== ws) {
        safeSend(old, { type: "forceDisconnect", reason: "duplicate_id_login" });
        try { old.close(); } catch {}
      }

      idToWS.set(id, ws);
      wsToId.set(ws, id);
      idToRole.set(id, role);

      console.log(`[REGISTER] ${id} as ${role}`);

      // 回覆註冊成功
      safeSend(ws, { type: "registered", id, role });

      // 如果這是 peer，且對應伙伴在線，請剛加入的這一方發起 offer
      if (role === "peer") {
        const partnerId = getPartnerId(id);
        if (partnerId && idToWS.has(partnerId)) {
          // 通知剛加入的 peer：開始與 partner 進行配對
          safeSend(ws, { type: "startPair", partnerId });
          // 同時通知對方：你可能會收到對方的 offer（僅提示用）
          safeSend(idToWS.get(partnerId), { type: "partnerOnline", partnerId: id });
        }
      }
      return;
    }

    // 轉送信令（peer <-> peer / viewer <-> peer）
    // 通用格式：{ type:'relay', to:'ID', payload:{ ... } }
    if (type === "relay") {
      const { to, payload } = data;
      if (!to || !payload) return;
      const target = idToWS.get(to);
      if (!target) {
        // 對方不在線
        safeSend(ws, { type: "peerOffline", to });
        return;
      }
      // 附上 from 以利對端識別
      payload.from = wsToId.get(ws);
      safeSend(target, { type: "relay", payload });
      return;
    }

    // Viewer 要求觀看誰（可選：也可走上方 relay 通用機制）
    // { type:'viewerSelect', viewerId:'Viewer01', targetId:'A1' }
    if (type === "viewerSelect") {
      const { viewerId, targetId } = data;
      const viewerWS = idToWS.get(viewerId);
      const targetWS = idToWS.get(targetId);
      if (!viewerWS) {
        safeSend(ws, { type: "error", message: "viewer not registered" });
        return;
      }
      if (!targetWS) {
        safeSend(viewerWS, { type: "error", message: `target ${targetId} offline` });
        return;
      }
      // 通知 viewer：目標在線
      safeSend(viewerWS, { type: "viewerTargetReady", targetId });
      return;
    }
  });

  ws.on("close", () => {
    const id = wsToId.get(ws);
    if (id) {
      idToWS.delete(id);
      idToRole.delete(id);
      wsToId.delete(ws);
      console.log(`[WS] ${id} disconnected`);
    } else {
      console.log("[WS] client disconnected (unregistered)");
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HTTP+WS server running on http://localhost:${PORT}`);
});
