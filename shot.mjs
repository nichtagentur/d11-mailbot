import { createRequire } from 'module';
import fs from 'fs';
import { execSync } from 'child_process';
const APP = (process.env.MAILBOT_APP_URL || 'https://d11-wien-chat.nichtagentur.workers.dev').replace(/\/?$/, '/');

function pw() {
  try { return createRequire(import.meta.url)('playwright'); } catch {}
  const root = execSync('npm root -g').toString().trim();
  return createRequire(root + '/')('playwright');
}

export async function screenshot(question, outPath) {
  const { chromium } = pw();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1.5 });
    await page.goto(APP + '?q=' + encodeURIComponent(question), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const started = await page.evaluate(() => document.querySelectorAll('.msg.user').length > 0).catch(() => false);
    if (!started) {
      await page.fill('#input', question);
      await page.press('#input', 'Enter');
    }
    await page.waitForSelector('text=/Kosten dieser Antwort|Cost of this answer/', { timeout: 60000 });
    await page.waitForTimeout(2000);
    try {
      await page.addStyleTag({ content: '.chips-bar,#chips-bar,.composer,.footer,.header{display:none!important} html,body,#app{height:auto!important;overflow:visible!important} #chat{height:auto!important;max-height:none!important;overflow:visible!important}' });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(500);
      await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-loaded').length > 4, null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const box = async () => page.evaluate(() => {
        const bots = [...document.querySelectorAll('.msg.bot')].filter(e => !e.classList.contains('error') && !e.querySelector('.thinking'));
        const last = bots[bots.length - 1];
        if (!last) return null;
        const els = [last];
        for (let n = last.nextElementSibling; n; n = n.nextElementSibling) if (n.classList.contains('viz')) els.push(n);
        let x1 = 1e9, y1 = 1e9, x2 = 0, y2 = 0;
        for (const e of els) { const r = e.getBoundingClientRect(); x1 = Math.min(x1, r.left + scrollX); y1 = Math.min(y1, r.top + scrollY); x2 = Math.max(x2, r.right + scrollX); y2 = Math.max(y2, r.bottom + scrollY); }
        return { x: Math.max(0, x1 - 8), y: Math.max(0, y1 - 8), width: x2 - x1 + 16, height: y2 - y1 + 16 };
      });
      let c = await box();
      if (!c) throw new Error('no bubble');
      c.width = Math.min(c.width, 900 - c.x);
      await page.screenshot({ path: outPath, clip: c, fullPage: true });
      if (fs.statSync(outPath).size > 1.5e6) {
        const jpg = outPath.replace(/\.png$/, '.jpg');
        await page.screenshot({ path: jpg, clip: c, type: 'jpeg', quality: 80, fullPage: true });
        fs.renameSync(jpg, outPath); // same name, JPEG data
      }
    } catch {
      await page.screenshot({ path: outPath });
    }
  } catch (e) {
    try { const pages = browser.contexts()[0].pages(); if (pages[0]) await pages[0].screenshot({ path: outPath }); } catch {}
    throw e;
  } finally { await browser.close(); }
  return outPath;
}
