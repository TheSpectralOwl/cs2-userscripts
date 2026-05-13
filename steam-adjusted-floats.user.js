// ==UserScript==
// @name         Steam Adjusted Floats
// @namespace    https://github.com/TheSpectralOwl/cs2-userscripts
// @version      1.0.0
// @description  Displays the min/max float range and adjusted item float on Steam Community Market Beta listings and Steam inventory pages. Note that you should not trust the exact adjusted float calculations when it gets to many digits beyond the decimal point (ex. for crafting exact floats).
// @author       SpectralOwl
// @match        *://steamcommunity.com/market/listings/730/*
// @match        *://steamcommunity.com/id/*/inventory*
// @match        *://steamcommunity.com/profiles/*/inventory*
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/steam-adjusted-floats.user.js
// @downloadURL  https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/steam-adjusted-floats.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Config ---
    const SKINS_JSON_URL = 'https://raw.githubusercontent.com/zwolof/schema-gen/main/exported/weapon_skins.json';
    const CACHE_KEY = 'adjusted_floats_weapon_skins';
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    // --- Protobuf decoding ---
    // market_bucket_group_id is "G" + hex-encoded protobuf
    // Fields: 3=weapon_defindex, 4=paint_kit_index, 6=constant(4)

    function decodeVarint(bytes, offset) {
        let result = 0;
        let shift = 0;
        let i = offset;
        while (i < bytes.length) {
            const byte = bytes[i];
            result |= (byte & 0x7F) << shift;
            i++;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        return { value: result, nextOffset: i };
    }

    function decodeBucketGroupId(bucketId) {
        if (!bucketId || bucketId[0] !== 'G') return null;

        const hex = bucketId.slice(1);
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substr(i, 2), 16));
        }

        const fields = {};
        let offset = 0;
        while (offset < bytes.length) {
            const tag = bytes[offset];
            const fieldNumber = tag >> 3;
            const wireType = tag & 0x07;
            offset++;

            if (wireType === 0) { // varint
                const decoded = decodeVarint(bytes, offset);
                fields[fieldNumber] = decoded.value;
                offset = decoded.nextOffset;
            } else {
                // Unknown wire type -- bail
                break;
            }
        }

        if (fields[3] !== undefined && fields[4] !== undefined) {
            return { weaponDefindex: fields[3], paintKitIndex: fields[4] };
        }
        return null;
    }

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

    // --- Float range lookup ---

    function getFloatRangeById(skinsData, weaponDefindex, paintKitIndex) {
        const weapon = skinsData[String(weaponDefindex)];
        if (!weapon || !weapon.paints) return null;

        const paint = weapon.paints[String(paintKitIndex)];
        if (!paint || !paint.float) return null;

        return { min: paint.float.min, max: paint.float.max };
    }

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
        // Item name format: "StatTrak™ MP5-SD | Picnic" or "Souvenir M4A1-S | Nightmare" or "AK-47 | Redline"
        // Strip prefixes
        let name = itemName
            .replace(/^StatTrak™\s*/i, '')
            .replace(/^Souvenir\s*/i, '')
            .replace(/^★\s*/, '')
            .replace(/^★\s*StatTrak™\s*/i, '');

        const parts = name.split(' | ');
        if (parts.length !== 2) return null;

        const index = buildNameIndex(skinsData);
        const key = parts[0].trim().toLowerCase() + '|' + parts[1].trim().toLowerCase();
        return index[key] || null;
    }

    // --- Extract bucket group ID from page (market only) ---

    function getBucketGroupId() {
        // Try extracting from SSR hydration data
        try {
            const ctx = window.SSR?.renderContext;
            if (ctx) {
                const str = typeof ctx === 'string' ? ctx : JSON.stringify(ctx);
                const match = str.match(/"market_bucket_group_id"\s*:\s*"(G[0-9A-Fa-f]+)"/);
                if (match) return match[1];
            }
        } catch { /* fall through */ }

        // Fallback: extract from URL path
        const urlMatch = window.location.pathname.match(/\/market\/listings\/730\/(G[0-9A-Fa-f]+)/);
        if (urlMatch) return urlMatch[1];

        return null;
    }

    // --- Shared DOM helpers ---

    function calculateAdjustedFloat(actualFloat, minFloat, maxFloat) {
        if (maxFloat - minFloat === 0) return null;
        if (minFloat === 0 && maxFloat === 1) return actualFloat;
        return (actualFloat - minFloat) / (maxFloat - minFloat);
    }

    function injectAdjustedFloat(wearDiv, floatRange) {
        const { min: minFloat, max: maxFloat } = floatRange;

        const valueSpan = wearDiv.querySelector('span');
        if (!valueSpan) return;

        const actualFloat = parseFloat(valueSpan.textContent);
        if (isNaN(actualFloat)) return;

        // Check if already processed
        if (wearDiv.nextElementSibling?.classList.contains('adjusted-float-display')) return;

        const adjustedFloat = calculateAdjustedFloat(actualFloat, minFloat, maxFloat);
        const adjustedValue = adjustedFloat !== null
            ? adjustedFloat.toFixed(10)
            : 'N/A';

        const container = wearDiv.cloneNode(false);
        container.className = wearDiv.className + ' adjusted-float-display';
        container.textContent = '';
        container.innerHTML = `Adjusted Float<!-- -->: <span class="${valueSpan.className}" style="${valueSpan.getAttribute('style') || ''}">${adjustedValue} (Range ${minFloat}\u2013${maxFloat})</span>`;

        wearDiv.insertAdjacentElement('afterend', container);
    }

    function findWearRatingDivs() {
        const results = [];
        const divs = document.querySelectorAll('div[style*="--text-color"]');
        divs.forEach(div => {
            if (div.textContent.startsWith('Wear Rating')) {
                results.push(div);
            }
        });
        return results;
    }

    // --- Market page logic ---
    // All listings share the same skin, so we resolve the float range once.

    function runMarketPage(skinsData) {
        const bucketId = getBucketGroupId();
        if (!bucketId) {
            console.log('[Adjusted Floats] No bucket group ID found');
            return;
        }

        const decoded = decodeBucketGroupId(bucketId);
        if (!decoded) {
            console.log('[Adjusted Floats] Failed to decode bucket group ID:', bucketId);
            return;
        }

        const floatRange = getFloatRangeById(skinsData, decoded.weaponDefindex, decoded.paintKitIndex);
        if (!floatRange) {
            console.log('[Adjusted Floats] No float range found for weapon', decoded.weaponDefindex, 'paint', decoded.paintKitIndex);
            return;
        }

        console.log(`[Adjusted Floats] Market: ${bucketId} -> weapon=${decoded.weaponDefindex} paint=${decoded.paintKitIndex} range=${floatRange.min}-${floatRange.max}`);

        function update() {
            findWearRatingDivs().forEach(div => injectAdjustedFloat(div, floatRange));
        }

        startObserver(update);
        update();
    }

    // --- Inventory page logic ---
    // Each item can be a different skin. We find the item name from the detail panel
    // and look up the float range per item.

    function runInventoryPage(skinsData) {
        console.log('[Adjusted Floats] Inventory mode');

        function update() {
            // Steam's native Wear Rating display
            findWearRatingDivs().forEach(wearDiv => {
                if (wearDiv.nextElementSibling?.classList.contains('adjusted-float-display')) return;

                // Walk up to find the item detail panel, then find the item name <h1>
                // The panel structure has an <h1> containing a <span> with the item name
                const panel = wearDiv.closest('div[style*="--border"]') || wearDiv.closest('[id^="iteminfo"]');
                if (!panel) return;

                const h1 = panel.querySelector('h1');
                if (!h1) return;

                // The name is in a <span> inside the <h1>, or directly in the <h1>
                const nameSpan = h1.querySelector('span');
                const itemName = (nameSpan || h1).textContent.trim();
                if (!itemName || !itemName.includes(' | ')) return;

                const floatRange = getFloatRangeByName(skinsData, itemName);
                if (!floatRange) return;

                injectAdjustedFloat(wearDiv, floatRange);
            });

            // CSFloat extension companion display
            injectNextToCsFloat(skinsData);
        }

        startObserver(update);
        update();
    }

    // --- CSFloat extension companion ---
    // CSFloat uses a closed shadow root so we can't inject inside it.
    // Instead, we place our display as a sibling right after the
    // <csfloat-selected-item-info> element in the regular DOM.
    // We read the item name and wear rating from Steam's native panel.

    function injectNextToCsFloat(skinsData) {
        const csfloatElements = document.querySelectorAll('csfloat-selected-item-info');

        csfloatElements.forEach(csfloatEl => {
            // Check if already processed
            if (csfloatEl.nextElementSibling?.classList.contains('adjusted-float-csfloat')) return;

            // Find the item panel containing this element
            const panel = csfloatEl.closest('[id^="iteminfo"]') || csfloatEl.parentElement;
            if (!panel) return;

            // Get item name from <h1>
            const h1 = panel.querySelector('h1');
            if (!h1) return;
            const nameSpan = h1.querySelector('span');
            const itemName = (nameSpan || h1).textContent.trim();
            if (!itemName || !itemName.includes(' | ')) return;

            // Get float range from skin data
            const floatRange = getFloatRangeByName(skinsData, itemName);
            if (!floatRange) return;

            // Get actual float from Steam's Wear Rating line in the same panel
            const wearDiv = [...panel.querySelectorAll('div[style*="--text-color"]')]
                .find(d => d.textContent.startsWith('Wear Rating'));
            if (!wearDiv) return;

            const valueSpan = wearDiv.querySelector('span');
            if (!valueSpan) return;
            const actualFloat = parseFloat(valueSpan.textContent);
            if (isNaN(actualFloat)) return;

            const { min: minFloat, max: maxFloat } = floatRange;
            const adjustedFloat = calculateAdjustedFloat(actualFloat, minFloat, maxFloat);
            const adjustedValue = adjustedFloat !== null
                ? adjustedFloat.toFixed(10)
                : 'N/A';

            const container = document.createElement('div');
            container.className = 'adjusted-float-csfloat';
            container.style.cssText = 'color: #8f98a0; font-size: 13px; margin: 4px 0;';
            container.textContent = `Adjusted Float: ${adjustedValue} (Range ${minFloat}\u2013${maxFloat})`;

            csfloatEl.insertAdjacentElement('afterend', container);
        });
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

    // --- Page detection and main ---

    function isMarketPage() {
        return window.location.pathname.startsWith('/market/listings/730/');
    }

    function isInventoryPage() {
        return window.location.pathname.includes('/inventory');
    }

    async function main() {
        let skinsData;
        try {
            skinsData = await fetchSkinsData();
        } catch (err) {
            console.error('[Adjusted Floats] Failed to fetch skins data:', err);
            return;
        }

        if (isMarketPage()) {
            runMarketPage(skinsData);
        } else if (isInventoryPage()) {
            runInventoryPage(skinsData);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

})();
