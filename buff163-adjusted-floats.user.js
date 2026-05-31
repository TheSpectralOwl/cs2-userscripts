// ==UserScript==
// @name         Buff163 Adjusted Floats
// @namespace    https://github.com/TheSpectralOwl/cs2-userscripts
// @version      1.0.0
// @description  Displays the min/max float range and adjusted item float on Buff163 goods listing pages and item detail popups. Note that you should not trust the exact adjusted float calculations when it gets to many digits beyond the decimal point (ex. for crafting exact floats).
// @author       SpectralOwl
// @match        *://buff.163.com/goods/*
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/buff163-adjusted-floats.user.js
// @downloadURL  https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/buff163-adjusted-floats.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Config ---
    const SKINS_JSON_URL = 'https://raw.githubusercontent.com/zwolof/schema-gen/main/exported/weapon_skins.json';
    const CACHE_KEY = 'buff163_adjusted_floats_weapon_skins';
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    // --- Skin data fetching with cache ---

    function getCachedSkins() {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (!cached) return null;

            const { timestamp, data } = JSON.parse(cached);
            if (Date.now() - timestamp > CACHE_TTL) {
                localStorage.removeItem(CACHE_KEY);
                return null;
            }
            return data;
        } catch {
            localStorage.removeItem(CACHE_KEY);
            return null;
        }
    }

    function cacheSkins(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                data: data
            }));
        } catch {
            // localStorage full or unavailable -- continue without caching
        }
    }

    function fetchSkinsData() {
        return new Promise((resolve, reject) => {
            const cached = getCachedSkins();
            if (cached) {
                resolve(cached);
                return;
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url: SKINS_JSON_URL,
                onload: function (response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            cacheSkins(data);
                            resolve(data);
                        } catch {
                            reject(new Error('Failed to parse weapon skins JSON'));
                        }
                    } else {
                        reject(new Error(`HTTP ${response.status} fetching skins data`));
                    }
                },
                onerror: function () {
                    reject(new Error('Network error fetching skins data'));
                }
            });
        });
    }

    // --- Float range lookup by name ---

    // Build a name-based lookup index: { "weapon|paint": { min, max } }
    let nameIndex = null;

    function buildNameIndex(skinsData) {
        if (nameIndex) return nameIndex;
        nameIndex = {};
        for (const weaponId of Object.keys(skinsData)) {
            const weapon = skinsData[weaponId];
            if (!weapon.name || !weapon.paints) continue;
            const weaponName = weapon.name.toLowerCase();
            for (const paintId of Object.keys(weapon.paints)) {
                const paint = weapon.paints[paintId];
                if (!paint.name || !paint.float) continue;
                const key = weaponName + '|' + paint.name.toLowerCase();
                nameIndex[key] = { min: paint.float.min, max: paint.float.max };
            }
        }
        return nameIndex;
    }

    function getFloatRangeByName(skinsData, itemName) {
        // Item name format: "StatTrak™ MP5-SD | Picnic" or "★ Karambit | Doppler (Factory New)"
        // Strip prefixes and wear condition suffix
        let name = itemName
            .replace(/^StatTrak™\s*/i, '')
            .replace(/^Souvenir\s*/i, '')
            .replace(/^★\s*StatTrak™\s*/i, '')
            .replace(/^★\s*/, '')
            .replace(/\s*\([^)]+\)\s*$/, ''); // strip trailing "(Factory New)" etc.

        const parts = name.split(' | ');
        if (parts.length !== 2) return null;

        const index = buildNameIndex(skinsData);
        const key = parts[0].trim().toLowerCase() + '|' + parts[1].trim().toLowerCase();
        return index[key] || null;
    }

    // --- Adjusted float calculation ---

    function calculateAdjustedFloat(actualFloat, minFloat, maxFloat) {
        if (maxFloat - minFloat === 0) return null;
        if (minFloat === 0 && maxFloat === 1) return actualFloat;
        return (actualFloat - minFloat) / (maxFloat - minFloat);
    }

    // --- Item name resolution ---

    // On a buff163 goods page the item name is in the breadcrumb and in the
    // data-goods-info JSON attribute on each sell order row.
    // The page-level name (breadcrumb) is the canonical skin name used for all rows.

    function getPageItemName() {
        // Breadcrumb: <span class="cru-goods">★ Flip Knife | Doppler (Factory New)</span>
        const cruGoods = document.querySelector('.cru-goods');
        if (cruGoods) return cruGoods.textContent.trim();
        return null;
    }

    function getItemNameFromRow(row) {
        try {
            const goodsInfo = JSON.parse(row.dataset.goodsInfo || row.getAttribute('data-goods-info') || '{}');
            return goodsInfo.name || goodsInfo.market_hash_name || null;
        } catch {
            return null;
        }
    }

    // --- Injection: listing table rows ---
    // Each row has a .wear-value div with text "Float: 0.xxxx"
    // We insert an adjusted float line right after it.

    function injectIntoRow(row, floatRange) {
        const wearValueEl = row.querySelector('.wear-value');
        if (!wearValueEl) return;

        // Guard against double-injection
        if (wearValueEl.nextElementSibling?.classList.contains('buff-adjusted-float-row')) return;

        const rawText = wearValueEl.textContent || '';
        // Text is "Float: 0.123456789"
        const match = rawText.match(/[\d.]+$/);
        if (!match) return;

        const actualFloat = parseFloat(match[0]);
        if (isNaN(actualFloat)) return;

        const { min: minFloat, max: maxFloat } = floatRange;
        const adjustedFloat = calculateAdjustedFloat(actualFloat, minFloat, maxFloat);
        const adjustedValue = adjustedFloat !== null ? adjustedFloat.toFixed(10) : 'N/A';

        const el = document.createElement('div');
        el.className = 'buff-adjusted-float-row';
        el.style.cssText = 'color: #90969c; font-size: 12px; margin-top: 2px;';
        el.textContent = `Adjusted: ${adjustedValue} (${minFloat}\u2013${maxFloat})`;

        wearValueEl.insertAdjacentElement('afterend', el);
    }

    // --- Injection: item detail popup ---
    // The popup renders .scope-wear .wear-title containing span.c_White (the float value)
    // and optionally a .des (ranking). We insert our line after .wear-title.

    function injectIntoPopup(floatRange) {
        const wearTitleEls = document.querySelectorAll('.scope-wear .wear-title');

        wearTitleEls.forEach(wearTitle => {
            // Guard against double-injection
            if (wearTitle.nextElementSibling?.classList.contains('buff-adjusted-float-popup')) return;

            const floatSpan = wearTitle.querySelector('.c_White');
            if (!floatSpan) return;

            const actualFloat = parseFloat(floatSpan.textContent);
            if (isNaN(actualFloat)) return;

            const { min: minFloat, max: maxFloat } = floatRange;
            const adjustedFloat = calculateAdjustedFloat(actualFloat, minFloat, maxFloat);
            const adjustedValue = adjustedFloat !== null ? adjustedFloat.toFixed(10) : 'N/A';

            const el = document.createElement('div');
            el.className = 'buff-adjusted-float-popup';
            el.style.cssText = 'color: #90969c; font-size: 13px; margin-top: 4px;';
            el.textContent = `Adjusted Float: ${adjustedValue} (Range ${minFloat}\u2013${maxFloat})`;

            wearTitle.insertAdjacentElement('afterend', el);
        });
    }

    // --- Main update function ---

    function update(skinsData, pageFloatRange) {
        // Inject into listing table rows
        const rows = document.querySelectorAll('tr.selling');
        rows.forEach(row => {
            // Each row may be a different skin on some pages, but on a goods page
            // all rows are the same skin. We use pageFloatRange if available,
            // otherwise fall back to per-row name lookup.
            let floatRange = pageFloatRange;
            if (!floatRange) {
                const rowName = getItemNameFromRow(row);
                if (rowName) floatRange = getFloatRangeByName(skinsData, rowName);
            }
            if (floatRange) injectIntoRow(row, floatRange);
        });

        // Inject into any open detail popup(s)
        if (pageFloatRange) {
            injectIntoPopup(pageFloatRange);
        }
    }

    // --- Shared observer ---

    function startObserver(updateFn) {
        const observerConfig = { childList: true, subtree: true };
        let debounceTimer = null;

        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                observer.disconnect();
                updateFn();
                observer.observe(document.body, observerConfig);
            }, 200);
        });

        observer.observe(document.body, observerConfig);
    }

    // --- CSS injection ---
    // Our injected adjusted float line adds height to the cell. Compensate by
    // removing the bottom padding from the .name-cont wrapper inside t_Left cells
    // that contain our element, so the row height stays the same.

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .list_tb td:has(.buff-adjusted-float-row) {
                padding-bottom: 4px !important;
                padding-top: 4px !important;
            }
        `;
        document.head.appendChild(style);
    }

    // --- Entry point ---

    async function main() {
        injectStyles();

        let skinsData;
        try {
            skinsData = await fetchSkinsData();
        } catch (err) {
            console.error('[Buff163 Adjusted Floats] Failed to fetch skins data:', err);
            return;
        }

        // Resolve float range for this goods page using the breadcrumb name.
        // All sell orders on a goods page are for the same skin.
        const pageName = getPageItemName();
        let pageFloatRange = null;
        if (pageName) {
            pageFloatRange = getFloatRangeByName(skinsData, pageName);
            if (pageFloatRange) {
                console.log(`[Buff163 Adjusted Floats] "${pageName}" -> range ${pageFloatRange.min}–${pageFloatRange.max}`);
            } else {
                console.log(`[Buff163 Adjusted Floats] No float range found for "${pageName}"`);
            }
        }

        const updateFn = () => update(skinsData, pageFloatRange);
        startObserver(updateFn);
        updateFn();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

})();
