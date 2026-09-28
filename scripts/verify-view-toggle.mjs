#!/usr/bin/env node
/**
 * All three circuit views can be chosen.
 *
 * The toggle is an inline-flex of three 34px buttons in a flex row that
 * overflows. With the default flex-shrink it was squeezed from its declared
 * 104px to a measured clientWidth of 68 — exactly two buttons — and its own
 * `overflow: hidden` clipped the third away. Board (PCB) view was outside the
 * box and not clickable at EVERY width measured: 430x930, 930x430, 1024x768
 * and 1440x900. This is a clipping failure, not an overlap one: the button is
 * visible to checkVisibility and simply outside its parent's clip, so a
 * covered-centre test does not see it.
 *
 *   node scripts/verify-view-toggle.mjs http://127.0.0.1:PORT
 */
import {chromium} from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8711';
const fails = [];
const ok = [];
const check = (c, m) => (c ? ok : fails).push(m);

const browser = await chromium.launch();
try {
    for (const v of [
        {label: 'phone portrait', w: 430, h: 930, mobile: true},
        {label: 'phone landscape', w: 930, h: 430, mobile: true},
        {label: 'desktop', w: 1440, h: 900, mobile: false},
    ]) {
        const ctx = await browser.newContext({
            viewport: {width: v.w, height: v.h},
            deviceScaleFactor: v.mobile ? 3 : 1,
            isMobile: v.mobile, hasTouch: v.mobile,
        });
        const page = await ctx.newPage();
        await page.goto(BASE, {waitUntil: 'domcontentloaded'});
        await page.waitForFunction("document.querySelectorAll('[data-canvas]').length > 0",
            null, {timeout: 30000, polling: 100}).catch(() => {});

        // NARROW TOOLBARS PUT THE TOGGLE IN THE ⋯ MENU, BY DESIGN. BoardCanvas
        // has a `toolbarCramped` branch that moves it there rather than letting
        // the row collide. So "the toggle is not on screen" is not a failure at
        // 430 — failing to REACH it would be. Open the menu when it is not out.
        let present = await page.evaluate(() =>
            document.querySelectorAll('[data-circuit-view-toggle]').length > 0);
        let viaMenu = false;
        if (!present) {
            const more = page.locator('button', {hasText: '⋯'}).first();
            if (await more.count()) {
                await more.click({timeout: 5000}).catch(() => {});
                present = await page.waitForFunction(
                    "document.querySelectorAll('[data-circuit-view-toggle]').length > 0",
                    null, {timeout: 8000, polling: 100}).then(() => true).catch(() => false);
                viaMenu = present;
            }
        }
        check(present, `${v.label}: the view toggle is reachable${viaMenu ? ' (via the ⋯ menu, as the cramped layout intends)' : ''}`);
        if (!present) { await ctx.close(); continue; }

        const r = await page.evaluate(() => {
            const t = document.querySelector('[data-circuit-view-toggle]');
            const tb = t.getBoundingClientRect();
            return {
                clientW: t.clientWidth, scrollW: t.scrollWidth,
                buttons: [...t.querySelectorAll('button')].map(k => {
                    const r = k.getBoundingClientRect();
                    const top = document.elementFromPoint(
                        r.left + (r.width / 2), r.top + (r.height / 2));
                    return {
                        name: (k.getAttribute('aria-label') || '').replace(' view', ''),
                        insideBox: r.right <= tb.right + 1,
                        hittable: !!(top && (top === k || k.contains(top))),
                    };
                }),
            };
        });
        // The container must not be narrower than its own content: that is the
        // condition under which `overflow: hidden` eats a button.
        check(r.scrollW <= r.clientW + 1,
            `${v.label}: the toggle is not narrower than its buttons (client ${r.clientW}, content ${r.scrollW})`);
        check(r.buttons.length === 3, `${v.label}: all three views are offered (${r.buttons.length})`);
        for (const btn of r.buttons) {
            check(btn.insideBox && btn.hittable,
                `${v.label}: "${btn.name}" is inside the toggle and clickable`
                + (btn.insideBox && btn.hittable ? '' : ` (inside=${btn.insideBox} hittable=${btn.hittable})`));
        }

        // It really switches — and you can come back. Board view renders a
        // different panel that carries its own view buttons and NOT
        // [data-circuit-view-toggle], so this asks by accessible name rather
        // than by container: the question is whether the reader can leave.
        const board = page.getByRole('radio', {name: 'Board view'}).first();
        if (await board.count()) {
            await board.click({timeout: 5000}).catch(() => {});
            await page.waitForFunction(
                "!!document.querySelector('[aria-label=\"Realistic view\"]')",
                null, {timeout: 8000, polling: 100}).catch(() => {});
            const back = await page.evaluate(() => {
                const el = document.querySelector('[aria-label="Realistic view"]');
                if (!el) return {found: false};
                const r = el.getBoundingClientRect();
                const top = document.elementFromPoint(
                    r.left + (r.width / 2), r.top + (r.height / 2));
                return {found: true, hittable: !!(top && (top === el || el.contains(top)))};
            });
            check(back.found && back.hittable,
                `${v.label}: Board view is not a one-way door — Realistic is still reachable from it`,
                JSON.stringify(back));
        }
        await ctx.close();
    }
} finally {
    await browser.close();
}
for (const m of ok) console.log(`  ok   ${m}`);
for (const m of fails) console.log(`  FAIL ${m}`);
console.log(`\n${ok.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
