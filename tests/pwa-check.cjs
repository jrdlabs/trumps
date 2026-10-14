const fs = require('node:fs');
const assert = require('node:assert/strict');
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
for (const file of ['index.html','trumps.html','dominoes.html','admin.html']) {
  const html = fs.readFileSync(file,'utf8');
  assert(html.includes('./manifest.webmanifest'));
  assert(html.includes('data-install'));
  assert(html.includes('./js/install.js'));
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"?]+)"/g)) {
    if (match[1] !== './') assert(fs.existsSync(match[1]), match[1]);
  }
}
const sw = fs.readFileSync('service-worker.js','utf8');
for (const asset of ['css/hub.css','css/install.css','js/install.js']) assert(sw.includes(asset));
assert(!fs.readFileSync('index.html','utf8').includes('There’s always room'));
console.log('PASS: shared manifest, installation hooks, page assets and service-worker cache entries.');
