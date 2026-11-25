#!/usr/bin/env node
/**
 * The examples filter toolbar fits the rail it lives in.
 *
 * Search and all four filters fit on two rows at desktop and phone widths.
 *
 *   node scripts/verify-examples-filters.mjs http://127.0.0.1:PORT
 */
import {chromium} from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8711';
const fails = [];
const ok = [];
const check = (c, m, d = '') => {
    console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${d ? ` - ${d}` : ''}`);
    (c ? ok : fails).push(m);
};

const browser = await chromium.launch({args: ['--no-sandbox', '--disable-dev-shm-usage']});
try {
    for (const v of [
        {label: 'desktop', w: 1440, h: 900, mobile: false},
        {label: 'phone landscape', w: 930, h: 430, mobile: true},
    ]) {
        const ctx = await browser.newContext({
            viewport: {width: v.w, height: v.h},
            deviceScaleFactor: v.mobile ? 3 : 1,
            isMobile: v.mobile, hasTouch: v.mobile,
        });
        const page = await ctx.newPage();
        await page.goto(BASE, {waitUntil: 'domcontentloaded'});
        await page.waitForFunction("document.querySelectorAll('[data-canvas]').length > 0",
            null, {timeout: 30000, polling: 150}).catch(() => {});
        // Settle: the palette and examples list mount asynchronously.
        let last = -1;
        let stable = 0;
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline && stable < 3) {
            const n = await page.evaluate(() => document.querySelectorAll('button').length);
            stable = n === last ? stable + 1 : 0;
            last = n;
            await page.evaluate(() => new Promise(r => setTimeout(r, 180)));
        }

        const r = await page.evaluate(() => {
            const box = document.querySelector('[data-examples-selector-content]');
            if (!box) return {noBox: true};
            const bar = box.querySelector('[data-example-filters]');
            if (!bar) return {noBar: true, boxW: box.clientWidth};
            const bounds = box.getBoundingClientRect();
            const search = box.querySelector('input[type="text"]').getBoundingClientRect();
            const filters = [...bar.querySelectorAll('select')].map(select => select.getBoundingClientRect());
            return {
                total: filters.length,
                rows: new Set([search, ...filters].map(rect => Math.round(rect.top))).size,
                inside: filters.every(rect => rect.width > 0 && rect.left >= bounds.left - 1 &&
                    rect.right <= bounds.right + 1),
                overflow: bar.scrollWidth - bar.clientWidth
            };
        });
        check(r.total === 4, `${v.label}: all four filter selectors are present`);
        check(r.rows === 2, `${v.label}: search and filters occupy two rows`, String(r.rows));
        check(r.inside && r.overflow <= 1, `${v.label}: filters fit the rail without horizontal scrolling`);
        await ctx.close();
    }
} finally {
    await browser.close();
}
for (const m of ok) console.log(`  ok   ${m}`);
for (const m of fails) console.log(`  FAIL ${m}`);
console.log(`\n${ok.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
