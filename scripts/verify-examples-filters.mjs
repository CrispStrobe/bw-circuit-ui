#!/usr/bin/env node
/**
 * The examples filter toolbar fits the rail it lives in.
 *
 * Its four groups — category, Level, Parts, Target — were laid out in a single
 * `flex-wrap: nowrap` row with `overflow-x: auto`, inside a rail whose content
 * box is 172px. Measured: the toolbar was 838px wide, 4.9 screens of sideways
 * scrolling, with only 3 of its 11 buttons inside the rail at rest. Identical at
 * 1440, 1024 and on a phone, because the rail is ~190px at every screen size —
 * this was never a small-screen bug, which is why the gate checks a desktop
 * viewport too.
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
            // The toolbar is the flex row that holds BOTH the Level and Target
            // groups; identified by content rather than by class, because the
            // classes here are inline styles with no stable hook.
            const bars = [...box.querySelectorAll('div')].filter(e => {
                const s = getComputedStyle(e);
                return s.display === 'flex' &&
                    /Level/.test(e.innerText || '') && /Target/.test(e.innerText || '');
            });
            const bar = bars[bars.length - 1];
            if (!bar) return {noBar: true, boxW: box.clientWidth};
            const b = box.getBoundingClientRect();
            const btns = [...bar.querySelectorAll('button')];
            const inside = btns.filter(x => {
                const r = x.getBoundingClientRect();
                return r.width > 0 && r.left >= b.left - 1 && r.right <= b.right + 1;
            }).length;
            return {
                boxW: box.clientWidth,
                barSW: bar.scrollWidth, barCW: bar.clientWidth,
                wrap: getComputedStyle(bar).flexWrap,
                buttons: btns.length, inside,
            };
        });
        check(!r.noBox && !r.noBar,
            `${v.label}: the examples filter toolbar is present`,
            r.noBox ? 'no selector content' : (r.noBar ? `no toolbar in a ${r.boxW}px box` : ''));
        if (r.noBox || r.noBar) { await ctx.close(); continue; }

        check(r.barSW <= r.barCW + 1,
            `${v.label}: the toolbar does not overflow its rail`,
            `${r.barSW}px of content in ${r.barCW}px (${(r.barSW / Math.max(r.barCW, 1)).toFixed(1)} screens)`);
        // The consequence that matters: a filter you cannot see is a filter you
        // will not use. Overflow alone could be excused as "scrollable".
        check(r.inside === r.buttons && r.buttons > 0,
            `${v.label}: every filter button sits inside the rail`,
            `${r.inside}/${r.buttons}`);
        check(r.wrap === 'wrap',
            `${v.label}: the toolbar wraps rather than scrolling sideways`,
            `flex-wrap: ${r.wrap}`);
        await ctx.close();
    }
} finally {
    await browser.close();
}
for (const m of ok) console.log(`  ok   ${m}`);
for (const m of fails) console.log(`  FAIL ${m}`);
console.log(`\n${ok.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
