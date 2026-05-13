// ==UserScript==
// @name         New Float floats
// @namespace    https://github.com/TheSpectralOwl/cs2-userscripts
// @version      1.0.1
// @description  Displays the min/max float range and adjusted item float below the float bar on CSFloat. Note that you should not trust the exact adjusted float calculations when it gets to many digits beyond the decimal point (ex. for crafting exact floats).
// @author       SpectralOwl
// @match        *://*.csfloat.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/new-float-floats.user.js
// @downloadURL  https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/new-float-floats.user.js
// ==/UserScript==

(function () {
    'use strict';

    function addFloatInfo() {
        // Find all float bars on the page
        const floatBars = document.querySelectorAll('.mat-mdc-tooltip-trigger.float-bar');

        floatBars.forEach(bar => {
            // Get the tooltip ID and find the tooltip element
            const tooltipId = bar.getAttribute('aria-describedby');
            if (!tooltipId) return;

            const tooltip = document.getElementById(tooltipId);
            if (!tooltip) return;

            // Get the text: e.g., "Represents the float range of the skin (0-0.597321)"
            const text = tooltip.textContent;

            // Extract the min/max numbers
            const match = text.match(/\((\d+\.?\d*)-(\d+\.?\d*)\)/);
            if (!match || !match[1] || !match[2]) return;

            const minFloat = parseFloat(match[1]);
            const maxFloat = parseFloat(match[2]);

            // Find the parent container for this bar
            const parentContainer = bar.parentElement;
            if (!parentContainer) return;

            // Check if we've already added the min/max display
            if (!parentContainer.querySelector('.min-max-float-display')) {
                const minMaxElement = document.createElement('div');
                minMaxElement.className = 'min-max-float-display';
                minMaxElement.style.color = '#aaa';
                minMaxElement.style.fontSize = '11px';
                minMaxElement.style.marginTop = '4px';
                minMaxElement.innerHTML = `
                <span>Min: <strong>${minFloat}</strong></span>
                <span style="float: right;">Max: <strong>${maxFloat}</strong></span>
            `;
                // Insert it right after the float bar
                bar.insertAdjacentElement('afterend', minMaxElement);
            }

            // Find the sibling 'text-info' div
            const infoDiv = parentContainer.querySelector('.text-info.ng-star-inserted');
            if (!infoDiv) return;

            // Find the 'wear' element inside it
            const wearElement = infoDiv.querySelector('.wear');
            if (!wearElement) return;

            // Get the actual float value as a number
            const actualFloat = parseFloat(wearElement.textContent);

            // Perform the calculation (and avoid division by zero)
            let adjustedFloat = 0;
            if (maxFloat - minFloat !== 0) {
                if (minFloat == 0 && maxFloat == 1)
                    adjustedFloat = actualFloat;
                else {
                    adjustedFloat = (actualFloat - minFloat) / (maxFloat - minFloat);
                }
            }

            // Check if we've already added this new calculation
            if (parentContainer.querySelector('.wear-percent-display')) {
                return;
            }

            // Create the new element
            const newCalcElement = document.createElement('div');
            newCalcElement.className = 'wear-percent-display';
            newCalcElement.style.color = '#999';
            newCalcElement.style.fontSize = '14px';
            newCalcElement.style.marginTop = '5px';
            // The 'text-info' div doesn't have bottom padding, so we add it here
            newCalcElement.style.padding = '0 0 8px';
            newCalcElement.innerHTML = `
            ${(adjustedFloat).toFixed(14)} adjusted
            `;

            // Insert it right after the 'text-info' div
            infoDiv.insertAdjacentElement('afterend', newCalcElement);
        });
    }

    const observerConfig = { childList: true, subtree: true };

    // We use a MutationObserver to detect when new items are loaded
    const observer = new MutationObserver(() => {
        // Disconnect before modifying DOM to avoid triggering ourselves
        observer.disconnect();
        addFloatInfo();
        observer.observe(document.body, observerConfig);
    });

    // Start observing the entire page for changes
    observer.observe(document.body, observerConfig);

    // Run it once when the page first loads
    window.addEventListener('load', addFloatInfo);

})();