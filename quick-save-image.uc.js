// ==UserScript==
// @include   main
// @ignorecache
// ==/UserScript==

(function () {
  "use strict";

  if (location.href !== "chrome://browser/content/browser.xhtml") return;
  if (window.zenQuickSaveImage) return;

  const { classes: Cc, interfaces: Ci, results: Cr } = Components;
  let controller = null;
  let disposed = false;
  let startupObserver = null;

  const api = window.zenQuickSaveImage = {
    init() {
      if (disposed) return null;
      if (controller) return controller;
      const menu = document.getElementById("contentAreaContextMenu");
      const nativeItem = document.getElementById("context-saveimage");
      if (!menu || !nativeItem) throw new Error("Image context menu is unavailable");

      const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
      const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
        "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
      );
      const item = document.createXULElement("menuitem");
      item.id = "zen-quick-save-image-command";
      item.setAttribute("label", "Quick Save Image");
      item.hidden = true;
      nativeItem.before(item);

      let destroyed = false;
      const watchers = new Set();

      function reportFailure(error) {
        console.error("[Quick Save Image] Quick Save Image failed:", error);
        if (destroyed) return;
        const message = "Could not quick-save the image. Check your Downloads folder and try again.";
        Services.prompt.alert(window, "Quick Save Image", message);
      }

      function canSave(context) {
        return context?.onImage && !context.onCanvas && !!context.mediaURL &&
          /^(https?|file|data|blob):/i.test(context.mediaURL) &&
          !nativeItem.hidden && !nativeItem.disabled;
      }

      function onPopupShowing(event) {
        if (event.target !== menu) return;
        item.hidden = !canSave(window.gContextMenu);
      }

      // nsIFile.create is exclusive: competing windows cannot claim the same
      // name. Checking exists() followed by saving would leave a race here.
      function reserveFile(directory, filename) {
        const dot = filename.lastIndexOf(".");
        const base = dot > 0 ? filename.slice(0, dot) : filename;
        const extension = dot > 0 ? filename.slice(dot) : "";
        for (let number = 0; number < 10000; number++) {
          const file = directory.clone();
          file.append(number ? `${base} (${number})${extension}` : filename);
          try {
            file.create(Ci.nsIFile.NORMAL_FILE_TYPE, 0o600);
            return file;
          } catch (error) {
            if (error.result !== Cr.NS_ERROR_FILE_ALREADY_EXISTS) throw error;
          }
        }
        throw new Error("Too many files with the same image name");
      }

      // Native saves are reported through Downloads, including asynchronous
      // network failures. internalSave's completion callback has no error value.
      function watchDownload(list, path) {
        let removed = false;
        let armed = false;
        let target = null;
        const stop = () => {
          if (removed) return;
          removed = true;
          watchers.delete(stop);
          Promise.resolve(list.removeView(view)).catch(console.error);
        };
        const observe = download => {
          if (removed || download !== target) return;
          if (download.error) {
            stop();
            reportFailure(download.error);
          } else if (download.succeeded || (download.canceled && download.stopped)) {
            stop();
          }
        };
        const view = {
          onDownloadAdded(download) {
            // addView replays old history, including deleted files whose names
            // are available again. Only track the transfer started after arming.
            if (!armed || removed || target || download.target?.path !== path) return;
            target = download;
            observe(download);
          },
          onDownloadChanged: observe,
          onDownloadRemoved(download) {
            if (download === target) stop();
          }
        };
        watchers.add(stop);
        return { view, stop, arm() { armed = true; } };
      }

      async function saveImage() {
        let reserved = null;
        let watcher = null;
        try {
          const context = window.gContextMenu;
          if (!canSave(context) || destroyed) return;
          // The context menu can close or target another image while resolving
          // the directory. Never read gContextMenu again after this snapshot.
          const source = {
            url: context.mediaURL,
            principal: context.principal,
            contentType: context.contentData.contentType,
            contentDisposition: context.contentData.contentDisposition,
            referrerInfo: context.contentData.referrerInfo,
            cookieJarSettings: context.contentData.cookieJarSettings,
            isPrivate: PrivateBrowsingUtils.isBrowserPrivate(context.browser)
          };
          window.urlSecurityCheck(source.url, source.principal);
          if (typeof window.internalSave !== "function" ||
              typeof window.initFileInfo !== "function" ||
              typeof window.FileInfo !== "function") {
            throw new Error("Firefox image-saving helpers are unavailable");
          }
          const info = new window.FileInfo("untitled");
          window.initFileInfo(info, source.url, null, null,
            source.contentType, source.contentDisposition);
          if (!info.uri || !info.fileName || /[/\\]/.test(info.fileName) ||
              info.fileName === "." || info.fileName === "..") {
            throw new Error("Could not determine a safe image filename");
          }

          // Firefox's preferred-directory helper silently falls back when a
          // custom folder is unavailable. Honor an explicit custom path instead.
          const directoryPath = Services.prefs.getIntPref("browser.download.folderList", 1) === 2
            ? Services.prefs.getComplexValue("browser.download.dir", Ci.nsIFile).path
            : await Downloads.getPreferredDownloadsDirectory();
          const list = await Downloads.getList(source.isPrivate ? Downloads.PRIVATE : Downloads.PUBLIC);
          if (destroyed) return;
          const directory = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          directory.initWithPath(directoryPath);
          if (!directory.exists() || !directory.isDirectory()) {
            throw new Error("Downloads folder is unavailable");
          }
          reserved = reserveFile(directory, info.fileName);
          watcher = watchDownload(list, reserved.path);
          await list.addView(watcher.view);
          if (destroyed) throw new Error("Browser window closed before saving");
          watcher.arm();

          // Supplying chosen data skips the picker regardless of useDownloadDir.
          // Firefox replaces only our exclusively created, empty reservation and
          // creates its normal transfer (history, progress and privacy).
          window.internalSave(
            source.url, null, null, info.fileName,
            source.contentDisposition, source.contentType, false,
            "SaveImageTitle", { file: reserved, uri: info.uri },
            source.referrerInfo, source.cookieJarSettings, null,
            true, null, source.isPrivate, source.principal
          );
          reserved = null; // Native download now owns this file, including retry/cancel.
        } catch (error) {
          watcher?.stop();
          // Only clean up a startup reservation; never remove partial downloads.
          if (reserved) {
            try {
              if (reserved.exists() && reserved.fileSize === 0) reserved.remove(false);
            } catch (cleanupError) {
              console.error("[Quick Save Image] Could not remove image reservation:", cleanupError);
            }
          }
          reportFailure(error);
        }
      }

      menu.addEventListener("popupshowing", onPopupShowing);
      item.addEventListener("command", saveImage);
      controller = {
        destroy() {
          if (destroyed) return;
          destroyed = true;
          menu.removeEventListener("popupshowing", onPopupShowing);
          item.removeEventListener("command", saveImage);
          item.remove();
          for (const stop of [...watchers]) stop();
          controller = null;
        }
      };
      return controller;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      removeStartupObserver();
      window.removeEventListener("unload", api.destroy);
      controller?.destroy();
      delete window.zenQuickSaveImage;
    }
  };

  function removeStartupObserver() {
    if (!startupObserver) return;
    Services.obs.removeObserver(startupObserver, "browser-delayed-startup-finished");
    startupObserver = null;
  }

  function start() {
    removeStartupObserver();
    if (disposed) return;
    try {
      api.init();
    } catch (error) {
      console.error("[Quick Save Image] Initialization failed:", error);
    }
  }

  // Initialize independently of any other mod, after browser chrome is ready.
  window.addEventListener("unload", api.destroy, { once: true });
  if (window.gBrowserInit?.delayedStartupFinished) {
    start();
  } else {
    startupObserver = subject => {
      if (subject === window) start();
    };
    Services.obs.addObserver(startupObserver, "browser-delayed-startup-finished");
  }
})();
