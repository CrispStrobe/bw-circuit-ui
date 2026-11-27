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

const browser = await chromium.launch(
    process.env.BW_CHROMIUM_EXECUTABLE ? {executablePath: process.env.BW_CHROMIUM_EXECUTABLE} : {});
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

        // NARROW TOOLBARS PUT THE VIEWS IN THE ⋯ MENU, BY DESIGN. BoardCanvas
        // has a `toolbarCramped` branch that drops the inline toggle rather
        // than letting the row collide. Since 723e3ee ("Expose circuit toolbar
        // views, mode and power as labeled overflow commands") the menu no
        // longer re-hosts the 104px [data-circuit-view-toggle] box: it lists
        // each view as a labelled role="menuitemradio" row. So at 430 the
        // question is whether the same three views are REACHABLE as menu
        // commands — each present, visible, hittable, exactly one checked.
        const VIEWS = ['Realistic view', 'Schematic view', 'Board view'];
        const inline = await page.evaluate(() =>
            document.querySelectorAll('[data-circuit-view-toggle]').length > 0);
        let viaMenu = false;
        let menuRows = null;
        if (!inline) {
            const more = page.getByRole('button', {name: 'More circuit controls', exact: true});
            if (await more.count()) {
                await more.first().click({timeout: 5000}).catch(() => {});
                await page.waitForFunction(
                    "!!document.querySelector('[role=\"menuitemradio\"][title^=\"Board view\"]')",
                    null, {timeout: 8000, polling: 100}).catch(() => {});
                menuRows = await page.evaluate(views => views.map(name => {
                    const rows = [...document.querySelectorAll('[role="menuitemradio"]')]
                        .filter(k => k.querySelector('.circuit-menu-label')?.textContent === name);
                    if (rows.length !== 1) return {name, count: rows.length};
                    const k = rows[0];
                    // The ⋯ menu is a scrolling list taller than a phone
                    // screen; a row below its fold is reached by scrolling
                    // the MENU, which is what a finger does. Scroll it the
                    // way a reader would, then require it on screen and on top.
                    k.scrollIntoView({block: 'nearest', inline: 'nearest'});
                    const r = k.getBoundingClientRect();
                    const top = document.elementFromPoint(r.left + (r.width / 2), r.top + (r.height / 2));
                    return {
                        name, count: 1, checked: k.getAttribute('aria-checked') === 'true',
                        visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1
                            && r.left >= 0 && r.right <= innerWidth + 1,
                        hittable: !!(top && (top === k || k.contains(top))),
                        disabled: k.disabled,
                    };
                }), VIEWS);
                viaMenu = menuRows.every(row => row.count === 1);
            }
        }
        const present = inline || viaMenu;
        check(present, `${v.label}: the view toggle is reachable${viaMenu ? ' (as ⋯ menu commands, as the cramped layout intends)' : ''}`);
        if (!present) { await ctx.close(); continue; }

        if (viaMenu) {
            check(menuRows.filter(row => row.checked).length === 1,
                `${v.label}: exactly one view is checked in the menu (${menuRows.filter(row => row.checked).map(row => row.name).join(', ')})`);
            for (const row of menuRows) {
                check(row.visible && row.hittable && !row.disabled,
                    `${v.label}: "${row.name.replace(' view', '')}" menu command is on screen and clickable`
                    + (row.visible && row.hittable && !row.disabled ? '' : ` (visible=${row.visible} hittable=${row.hittable} disabled=${row.disabled})`));
            }
        } else {
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
        }

        // It really switches — and you can come back. Board view renders a
        // different panel that carries its own view buttons and NOT
        // [data-circuit-view-toggle], so this asks by accessible name rather
        // than by container: the question is whether the reader can leave.
        const board = viaMenu
            ? page.locator('[role="menuitemradio"]', {has: page.locator('.circuit-menu-label', {hasText: /^Board view$/})}).first()
            : page.getByRole('radio', {name: 'Board view'}).first();
        if (await board.count()) {
            await board.click({timeout: 5000}).catch(() => {});
            await page.waitForFunction(
                "!!document.querySelector('[data-schematic-escape] [aria-label=\"Realistic view\"]')",
                null, {timeout: 8000, polling: 100}).catch(() => {});
            const back = await page.evaluate(() => {
                // Scoped to the Board/Schematic escape bar, so the check also
                // proves the Board choice really left the realistic canvas.
                const el = document.querySelector('[data-schematic-escape] [aria-label="Realistic view"]');
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
