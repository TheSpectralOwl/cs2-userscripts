// ==UserScript==
// @name         Steam Market Adjusted Floats
// @namespace    https://github.com/TheSpectralOwl/cs2-userscripts
// @version      1.0.0
// @description  Displays the min/max float range and adjusted item float on Steam Community Market Beta CS2 listings. Note that you should not trust the exact adjusted float calculations when it gets to many digits beyond the decimal point (ex. for crafting exact floats).
// @author       SpectralOwl
// @match        *://steamcommunity.com/market/listings/730/*
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
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

    function getFloatRange(skinsData, weaponDefindex, paintKitIndex) {
        const weapon = skinsData[String(weaponDefindex)];
        if (!weapon || !weapon.paints) return null;

        const paint = weapon.paints[String(paintKitIndex)];
        if (!paint || !paint.float) return null;

        return { min: paint.float.min, max: paint.float.max };
    }

    // --- Extract bucket group ID from page ---

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

    // --- DOM manipulation ---

    function calculateAdjustedFloat(actualFloat, minFloat, maxFloat) {
        if (maxFloat - minFloat === 0) return null;
        if (minFloat === 0 && maxFloat === 1) return actualFloat;
        return (actualFloat - minFloat) / (maxFloat - minFloat);
    }

    function addFloatInfoToListings(floatRange) {
        if (!floatRange) return;

        const { min: minFloat, max: maxFloat } = floatRange;

        // The wear rating is rendered as:
        //   <div style="--text-color:...">Wear Rating<!-- -->: <span style="--white-space:pre-wrap">0.306740046</span></div>
        // We find the "Wear Rating" divs by checking text content of small leaf-ish divs,
        // then extract the float from the child span.

        // Get all divs with the text-color style (property rows)
        const propertyDivs = document.querySelectorAll('div[style*="--text-color"]');

        propertyDivs.forEach(div => {
            // Quick text check -- childNodes[0] is the text node "Wear Rating: "
            if (!div.textContent.startsWith('Wear Rating')) return;

            // Extract the float value from the child span
            const valueSpan = div.querySelector('span');
            if (!valueSpan) return;

            const actualFloat = parseFloat(valueSpan.textContent);
            if (isNaN(actualFloat)) return;

            // Check if already processed (look at next sibling)
            if (div.nextElementSibling?.classList.contains('adjusted-float-display')) return;

            const adjustedFloat = calculateAdjustedFloat(actualFloat, minFloat, maxFloat);

            const adjustedValue = adjustedFloat !== null
                ? adjustedFloat.toFixed(10)
                : 'N/A';

            // Clone the Wear Rating div's classes and style to match formatting
            const container = div.cloneNode(false);
            container.className = div.className + ' adjusted-float-display';
            container.textContent = '';
            container.innerHTML = `Adjusted Float<!-- -->: <span class="${valueSpan.className}" style="${valueSpan.getAttribute('style') || ''}">${adjustedValue} (Range ${minFloat}\u2013${maxFloat})</span>`;

            // Insert right after the Wear Rating div
            div.insertAdjacentElement('afterend', container);
        });
    }

    // --- Main ---

    async function main() {
        const bucketId = getBucketGroupId();
        if (!bucketId) {
            console.log('[Adjusted Floats] No bucket group ID found on this page');
            return;
        }

        const decoded = decodeBucketGroupId(bucketId);
        if (!decoded) {
            console.log('[Adjusted Floats] Failed to decode bucket group ID:', bucketId);
            return;
        }

        let skinsData;
        try {
            skinsData = await fetchSkinsData();
        } catch (err) {
            console.error('[Adjusted Floats] Failed to fetch skins data:', err);
            return;
        }

        const floatRange = getFloatRange(skinsData, decoded.weaponDefindex, decoded.paintKitIndex);
        if (!floatRange) {
            console.log('[Adjusted Floats] No float range found for weapon', decoded.weaponDefindex, 'paint', decoded.paintKitIndex);
            return;
        }

        console.log(`[Adjusted Floats] ${bucketId} -> weapon=${decoded.weaponDefindex} paint=${decoded.paintKitIndex} range=${floatRange.min}-${floatRange.max}`);

        // Observe for dynamically loaded/hydrated listings
        const observerConfig = { childList: true, subtree: true };
        let debounceTimer = null;

        function debouncedUpdate() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                observer.disconnect();
                addFloatInfoToListings(floatRange);
                observer.observe(document.body, observerConfig);
            }, 200);
        }

        const observer = new MutationObserver(debouncedUpdate);
        observer.observe(document.body, observerConfig);

        // Also run once now in case DOM is already ready
        addFloatInfoToListings(floatRange);
    }

    // Wait for page to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

})();
