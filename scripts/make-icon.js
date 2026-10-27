'use strict';
// 빌드용 앱 아이콘(256x256 PNG)을 만든다: 웹앱 사이드바색 바탕에 흰 "R"과 주황 점.
// 사용: electron scripts/make-icon.js  →  build/icon.png  (electron-builder 가 .ico 로 변환)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const HTML = `<!doctype html><meta charset="utf-8"><body style="margin:0;width:256px;height:256px;background:#0f3d44;position:relative;overflow:hidden">
<div style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:800 168px/1 'Segoe UI','Malgun Gothic',system-ui,sans-serif;letter-spacing:-6px">R</div>
<div style="position:absolute;top:36px;right:40px;width:34px;height:34px;border-radius:50%;background:#f4a27a"></div></body>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, useContentSize: true, show: false, frame: false });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: 256, height: 256 }).toPNG());
  console.log('wrote', out, img.getSize());
  app.quit();
});
