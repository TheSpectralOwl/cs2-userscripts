// ==UserScript==
// @name         Hide "Test skin in server" on browse
// @namespace    https://github.com/TheSpectralOwl/cs2-userscripts
// @version      1.0.0
// @description  Removes the "Test skin in server" (gs-inspect) button from the CSFloat search/browse listings while keeping it on individual item pages.
// @author       SpectralOwl
// @match        *://*.csfloat.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/hide-test-skin-button.user.js
// @downloadURL  https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/hide-test-skin-button.user.js
// ==/UserScript==

(function () {
    'use strict';

    // On an individual item page (/item/<id>) we keep the button, so do nothing.
    function isItemPage() {
        return /^\/item\//.test(window.location.pathname);
    }

    function hideTestSkinButtons() {
        if (isItemPage()) return;

        // The "Test skin in server" control is an icon button using the gs-inspect SVG icon.
        document.querySelectorAll('mat-icon[svgicon="gs-inspect"]').forEach(icon => {
            const control = icon.closest('.mat-mdc-tooltip-trigger, button, a') || icon;
            if (control.dataset.testSkinHidden === '1') return;
            control.style.setProperty('display', 'none', 'important');
            control.dataset.testSkinHidden = '1';
        });
    }

    const observerConfig = { childList: true, subtree: true };

    const observer = new MutationObserver(() => {
        observer.disconnect();
        hideTestSkinButtons();
        observer.observe(document.body, observerConfig);
    });

    observer.observe(document.body, observerConfig);
    window.addEventListener('load', hideTestSkinButtons);
    hideTestSkinButtons();

})();
