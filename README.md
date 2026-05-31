# CS2 Userscripts

A collection of userscripts for Counter-Strike 2.

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/) (or another userscript manager)
2. Click the install link for the script you want -- Violentmonkey will prompt you to confirm
3. Navigate to the relevant site -- the script runs automatically

## Scripts

### Adjusted Float Scripts

Most CS2 skins don't use the full 0-1 float range. A skin with range 0-0.7 and a float of 0.35 is actually at the 50% mark of its possible wear. These scripts display that **adjusted float** alongside the normal wear value.

The adjusted float normalizes the actual wear value to a 0-1 scale within the skin's range:

```
adjusted = (actual - min) / (max - min)
```

| Skin | Range | Actual Float | Adjusted Float |
|------|-------|-------------|----------------|
| USP-S Neo-Noir | 0 - 0.7 | 0.35 | 0.50 |
| AK-47 Redline | 0.1 - 0.7 | 0.25 | 0.25 |
| AWP Asiimov | 0.18 - 1.0 | 0.18 | 0.00 |

**Note:** Do not rely on the exact adjusted float values to many decimal places (e.g. for crafting exact floats). Floating point precision limits apply.

#### Steam Adjusted Floats

> [Install](https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/steam-adjusted-floats.user.js)

Adds an "Adjusted Float" line below the Wear Rating on the [Steam Community Market Beta](https://steamcommunity.com/market/) and on Steam inventory pages. Float ranges are looked up from [zwolof/schema-gen](https://github.com/zwolof/schema-gen) and cached locally for 24 hours.

Requires `GM_xmlhttpRequest` support (Violentmonkey, Tampermonkey, etc.).

#### Buff163 Adjusted Floats

> [Install](https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/buff163-adjusted-floats.user.js)

Adds an adjusted float line below each listing's float value on [Buff163](https://buff.163.com/) goods pages (`/goods/*`). Works on both the sell order table and the item detail popup. Float ranges are looked up from [zwolof/schema-gen](https://github.com/zwolof/schema-gen) and cached locally for 24 hours.

Requires `GM_xmlhttpRequest` support (Violentmonkey, Tampermonkey, etc.).

#### CSFloat Adjusted Floats

> [Install](https://raw.githubusercontent.com/TheSpectralOwl/cs2-userscripts/main/new-float-floats.user.js)

Adds min/max float range and adjusted float below the float bar on [CSFloat](https://csfloat.com/) listings. Float range data is read directly from CSFloat's existing UI -- no external requests needed.

Works with any userscript manager (`@grant none`).

## License

[MIT](LICENSE)