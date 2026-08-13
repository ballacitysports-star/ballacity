import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('requestfailed', r => console.log('REQFAIL', r.url(), r.failure()?.errorText));
try {
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle', timeout: 20000 });
} catch (e) { console.log('GOTO ERROR', e.message); }
await page.waitForTimeout(3000);
console.log('BODY', (await page.content()).slice(0,500));
await browser.close();
