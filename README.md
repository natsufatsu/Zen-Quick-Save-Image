# Quick Save Image

A standalone Zen Browser mod that adds **Quick Save Image** above **Save Image
As…** in the image context menu. It saves directly to your configured Downloads
folder without opening a file picker, even when “Always ask where to save” is on.

Existing files are preserved: saving `untitled.png` again creates
`untitled (1).png`, then `untitled (2).png`. Filename numbering works without AI.
The original **Save Image As…** command remains available.

## Compatibility

This mod has its own ID, script, menu item, and startup/cleanup lifecycle. It uses
the browser's normal download list and does not replace browser save functions,
so it can run alongside other download or context-menu customizations.

## Installation

Requires a browser-chrome JavaScript loader, such as Sine or fx-autoconfig. This
is not a webpage userscript or a regular WebExtension.

- **Existing fx-autoconfig setup:** copy `quick-save-image.uc.js` into the profile's
  configured userscript directory (normally `chrome/JS`), then restart the browser.
- **Sine:** `theme.json` describes this standalone mod and its script. A private
  GitHub repository requires authenticated access; do not assume pasting its URL
  into a mod manager grants access. Use your loader's local installation workflow
or install the script through an existing fx-autoconfig setup.

Install the script through only one loader to keep updates predictable.

## Behavior and limitations

- Uses the browser's configured download destination, including custom folders.
- Reports unavailable folders and failed saves instead of silently saving elsewhere.
- Retains browser security checks, cookies, referrer information, and private mode.
- Supports image targets; canvas elements are not included.
- Requires live verification against your Zen version because it uses Firefox's
  internal browser APIs. The automated tests mock those APIs.

## Development

Run `node --test tests/quick-save.test.cjs` and
`node --check quick-save-image.uc.js`. See
[the live verification checklist](tests/quick-save-manual.md) for browser checks.
