const wsUrl = process.argv[2];
const ws = new WebSocket(wsUrl);
let id = 1;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = id++;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
});

async function screenshot(name) {
  await send('Runtime.evaluate', { expression: `document.querySelector('.wb-palette').scrollIntoView({block:'center'})` });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(`/mnt/data/Development/TAFE/electronics/cert_iii/${name}.png`, Buffer.from(shot.data, 'base64'));
  console.log('saved', name);
}

ws.addEventListener('open', async () => {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Runtime.evaluate', { expression: `doRestart()` });

  await screenshot('ff_initial');

  const midRes = await send('Runtime.evaluate', {
    expression: `
      (function(){
        function levelsToPieces(levels) {
          const pieces = [];
          let i = 0, level = 0;
          while (i < levels.length) {
            if (levels[i] !== level) {
              pieces.push(levels[i] === 1 ? {type:'rise'} : {type:'fall'});
              level = levels[i];
              i++;
              continue;
            }
            let run = 1;
            while (i + run < levels.length && levels[i+run] === level && run < 3) run++;
            pieces.push({type:'flat', width: run});
            i += run;
          }
          return pieces;
        }
        window.__target = correctQ.slice(0, 12).concat(correctQ.slice(12).map(v => 1 - v));
        window.__pieces = levelsToPieces(window.__target);
        // place only the first half now, to capture a mid-progress screenshot
        window.__pieces.slice(0, Math.ceil(window.__pieces.length/2)).forEach(p => pickPiece(p));
        return JSON.stringify({ cursorCol: wbCursor(builder).col });
      })()
    `,
  });
  console.log('mid-build:', midRes.result.value);
  await screenshot('ff_progress');

  const buildRes = await send('Runtime.evaluate', {
    expression: `
      (function(){
        window.__pieces.slice(Math.ceil(window.__pieces.length/2)).forEach(p => pickPiece(p));
        return JSON.stringify({ target: window.__target, cursorCol: wbCursor(builder).col, N });
      })()
    `,
  });
  console.log('build result:', buildRes.result.value);
  await screenshot('ff_filled_prechek');

  const checkRes = await send('Runtime.evaluate', { expression: `doCheck(); JSON.stringify(lastResult);` });
  console.log('check result:', checkRes.result.value);
  await screenshot('ff_checked');

  ws.close();
});
