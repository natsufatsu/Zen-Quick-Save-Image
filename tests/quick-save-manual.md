# Quick Save Image: live Zen checks

The Node tests mock Firefox's chrome APIs. They verify control flow and use real
exclusive file creation, but do not verify Firefox's filename helpers, network
channels, download UI, or the native context menu. Run these checks in Zen after
loading this standalone mod. Test both with and without the original Tidy Downloads installed.

- Right-click a PNG, JPEG, or WebP: **Quick Save Image** appears directly above
  **Save Image As…**. It is absent on text, video, and canvas targets.
- Quick-save an image into Downloads with “Always ask where to save” enabled.
  No file picker appears. The original Save Image As command still opens it.
- Save `untitled.png` repeatedly and rapidly from two windows. Verify numbered
  names, valid image contents, and unchanged contents of a pre-existing file.
  If Tidy Downloads is installed, disable its AI rename for this naming check; re-enable it for the integration check.
- Check extensionless URLs, Content-Disposition filenames, non-ASCII filenames,
  data URLs, and blob URLs. Open the saved files to verify their format/content.
- Check an image requiring login and an image in a private/container tab.
  Verify the correct session is used and private downloads stay out of public
  history. Open another context menu immediately after saving to verify the
  original image is downloaded.
- Verify progress/completion in the browser download list and Tidy Downloads,
  including existing AI rename and undo behavior when enabled.
- Configure a missing or unwritable custom download folder: the command reports
  failure without opening a picker or saving elsewhere. Restore the folder setting.
- Trigger a network failure and cancel an in-progress save: check normal browser
  failure/cancel behavior and that errors are reported once. Retry through the
  download list. Files partially written by native downloads remain browser-owned.
- Reload the script and open/close browser windows: no duplicate command or
  listeners; closing a window before a save starts leaves no empty reservation.

Live checks have not been executed by the automated Node suite.

- With the original Tidy Downloads enabled, verify both menu actions, download cards, and AI settings work independently. Disable Quick Save Image and confirm Tidy Downloads remains operational.
