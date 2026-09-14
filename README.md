# Quick Save Image

A standalone Zen Browser mod that adds **Quick Save Image** above **Save Image
As…** in the image context menu. It saves directly to your configured Downloads
folder without opening a file picker, even when “Always ask where to save” is on.

Existing files are preserved: saving `untitled.png` again creates
`untitled (1).png`, then `untitled (2).png`. Filename numbering works without AI.
The original **Save Image As…** command remains available.

## Using it with Tidy Downloads

This mod has its own ID, script, menu item, and startup/cleanup lifecycle. It does
not load Tidy Downloads code, change its preferences or styles, or replace browser
save functions. It works with or without the original Tidy Downloads installed.

Saved images go through the normal browser download list. If Tidy Downloads is
installed, it can display and rename them according to its existing settings.

If you installed our earlier experimental Tidy Downloads copy with Quick Save
built in, switch back to the original Tidy Downloads before enabling this mod.
Otherwise that experimental copy will also add its own Quick Save command.

## Installation

Requires a browser-chrome JavaScript loader, such as Sine or fx-autoconfig. This
is not a webpage userscript or a regular WebExtension.

- **Existing fx-autoconfig setup:** copy `quick-save-image.uc.js` into the profile's
  configured userscript directory (normally `chrome/JS`), then restart the browser.
- **Sine:** `theme.json` describes this standalone mod and its script. A private
  GitHub repository requires authenticated access; do not assume pasting its URL
  into a mod manager grants access. Use your loader's local installation workflow
  or install the script through an existing fx-autoconfig setup.

Install the script through only one loader to keep updates predictable. No files
from the Tidy Downloads repository are needed.

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

Extracted from the Quick Save Image addition developed in our personal copy of
[Vertex-Mods/Zen-Tidy-Downloads](https://github.com/Vertex-Mods/Zen-Tidy-Downloads).
The Tidy Downloads implementation and UI are not bundled here.
