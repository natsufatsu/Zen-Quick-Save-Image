// Run with: node --test tests/quick-save.test.cjs
// Exercises the userscript through its menu events, with real exclusive file
// creation and mocked Firefox chrome APIs. Live Zen checks are still required.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname,
  "../quick-save-image.uc.js"), "utf8");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zen-quick-save-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("zen-quick-save-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  class File {
    initWithPath(value) { this.path = value; }
    clone() { const file = new File(); file.path = this.path; return file; }
    append(name) { this.path = path.join(this.path, name); }
    exists() { return fs.existsSync(this.path); }
    isDirectory() { return fs.statSync(this.path).isDirectory(); }
    get fileSize() { return fs.statSync(this.path).size; }
    create(type, mode) {
      if (state.denied) throw Object.assign(new Error("Permission denied"), { result: "EACCES" });
      try { fs.closeSync(fs.openSync(this.path, "wx", mode)); }
      catch (error) { error.result = error.code; throw error; }
    }
    remove() { fs.unlinkSync(this.path); }
  }
  const views = new Set();
  const history = [];
  const list = {
    addView(view) { views.add(view); history.forEach(dl => view.onDownloadAdded(dl)); },
    removeView(view) { views.delete(view); }
  };
  const state = { directory, calls: [], errors: [], listTypes: [], views, history, fail: false };
  state.emit = (event, download) => {
    for (const view of [...views]) view[event]?.(download);
  };
  state.makeWindow = (ready = true) => {
    const windowListeners = new Map();
    const observers = new Set();
    const elements = new Map();
    function element(id) {
      const listeners = new Map();
      return {
        id, hidden: false, disabled: false, listeners,
        setAttribute(key, value) { this[key] = value; },
        addEventListener(event, listener) { listeners.set(event, listener); },
        removeEventListener(event) { listeners.delete(event); },
        before(child) { elements.set(child.id, child); },
        remove() { elements.delete(this.id); },
        fire(event, target = this) { return listeners.get(event)?.({ target }); }
      };
    }
    const menu = element("contentAreaContextMenu");
    const nativeItem = element("context-saveimage");
    elements.set(menu.id, menu);
    elements.set(nativeItem.id, nativeItem);
    const Downloads = {
      PUBLIC: "public", PRIVATE: "private",
      getPreferredDownloadsDirectory: async () => state.directory,
      getList: async type => { state.listTypes.push(type); return list; }
    };
    const window = {
      gBrowserInit: { delayedStartupFinished: ready },
      addEventListener: (event, listener) => windowListeners.set(event, listener),
      removeEventListener: event => windowListeners.delete(event),
      gContextMenu: {
        onImage: true, onCanvas: false, mediaURL: "https://example.test/untitled.png",
        principal: { origin: "https://example.test" }, browser: { private: false },
        contentData: { contentType: "image/png", contentDisposition: "inline",
          referrerInfo: {}, cookieJarSettings: {} }
      },
      urlSecurityCheck(url, principal) {
        assert.ok(principal);
        if (state.securityError) throw new Error("Blocked source");
      },
      FileInfo: function (name) { this.suggestedFileName = name; },
      initFileInfo(info, url, charset, doc, type, disposition) {
        state.filenameArgs = { url, type, disposition };
        info.uri = { spec: url };
        info.fileName = state.filename || "untitled.png";
      },
      internalSave(...args) {
        if (state.fail) throw new Error("Native startup failure");
        assert.equal(fs.statSync(args[8].file.path).size, 0);
        state.calls.push(args);
        const download = { target: { path: args[8].file.path }, stopped: false };
        state.emit("onDownloadAdded", download);
        state.lastDownload = download;
      }
    };
    const sandbox = vm.createContext({
      window, location: { href: "chrome://browser/content/browser.xhtml" },
      document: { getElementById: id => elements.get(id), createXULElement: () => element() },
      Components: {
        classes: { "@mozilla.org/file/local;1": { createInstance: () => new File() } },
        interfaces: { nsIFile: { NORMAL_FILE_TYPE: 0 } },
        results: { NS_ERROR_FILE_ALREADY_EXISTS: "EEXIST" }
      },
      ChromeUtils: { importESModule: () => ({ Downloads,
        PrivateBrowsingUtils: { isBrowserPrivate: browser => browser.private } }) },
      Services: {
        obs: {
          addObserver: observer => observers.add(observer),
          removeObserver: observer => observers.delete(observer)
        },
        prefs: {
          getIntPref: () => state.customDirectory ? 2 : 1,
          getComplexValue: () => ({ path: state.customDirectory })
        },
        prompt: { alert: (...args) => state.errors.push(args) }
      },
      console: { error() {} }
    });
    vm.runInContext(source, sandbox);
    const api = window.zenQuickSaveImage;
    const controller = ready ? api.init() : null;
    t.after(() => api.destroy());
    return { window, controller, menu, nativeItem, elements, observers, windowListeners,
      reload: () => vm.runInContext(source, sandbox),
      save: () => elements.get("zen-quick-save-image-command").fire("command") };
  };
  return state;
}

test("repeated and concurrent saves across windows preserve existing files", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, "untitled.png"), "original");
  const a = f.makeWindow(), b = f.makeWindow();
  await Promise.all([a.save(), b.save(), a.save()]);
  assert.deepEqual(f.calls.map(args => path.basename(args[8].file.path)),
    ["untitled (1).png", "untitled (2).png", "untitled (3).png"]);
  assert.equal(fs.readFileSync(path.join(f.directory, "untitled.png"), "utf8"), "original");
});

test("captures source context and private list before asynchronous work", async t => {
  const f = fixture(t), a = f.makeWindow();
  const original = a.window.gContextMenu;
  original.browser.private = true;
  const pending = a.save();
  a.window.gContextMenu = null;
  await pending;
  const args = f.calls[0];
  assert.equal(args[0], original.mediaURL);
  assert.equal(args[9], original.contentData.referrerInfo);
  assert.equal(args[10], original.contentData.cookieJarSettings);
  assert.equal(args[12], true);
  assert.equal(args[14], true);
  assert.equal(args[15], original.principal);
  assert.equal(args[8].uri.spec, original.mediaURL);
  assert.deepEqual(f.listTypes, ["private"]);
});

test("startup errors remove empty reservations; absent folders and blocked sources fail", async t => {
  const f = fixture(t), a = f.makeWindow();
  f.fail = true;
  await a.save();
  assert.deepEqual(fs.readdirSync(f.directory), []);
  assert.equal(f.views.size, 0);
  f.directory = path.join(f.directory, "missing");
  await a.save();
  f.securityError = true;
  await a.save();
  assert.equal(f.errors.length, 3);
  assert.equal(f.calls.length, 0);
});

test("ignores stale history; reports a new transfer failure only once", async t => {
  const f = fixture(t), a = f.makeWindow();
  const old = { target: { path: path.join(f.directory, "untitled.png") }, succeeded: true };
  f.history.push(old);
  await a.save();
  assert.equal(f.views.size, 1);
  f.emit("onDownloadChanged", old);
  assert.equal(f.views.size, 1);
  fs.writeFileSync(f.lastDownload.target.path, "partial");
  f.lastDownload.error = new Error("Network failure");
  f.emit("onDownloadChanged", f.lastDownload);
  f.emit("onDownloadChanged", f.lastDownload);
  assert.equal(f.errors.length, 1);
  assert.equal(f.views.size, 0);
  assert.equal(fs.readFileSync(f.lastDownload.target.path, "utf8"), "partial");
});

test("unavailable custom folders never fall back; permission failures do not retry", async t => {
  const f = fixture(t), a = f.makeWindow();
  f.customDirectory = path.join(f.directory, "unavailable-custom-folder");
  await a.save();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(fs.readdirSync(f.directory), []);
  f.customDirectory = f.directory;
  f.denied = true;
  await a.save();
  assert.equal(f.calls.length, 0);
  assert.equal(f.errors.length, 2);
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test("completion after filename changes and cancellation detach watchers", async t => {
  const f = fixture(t), a = f.makeWindow();
  await a.save();
  f.lastDownload.target.path += ".renamed";
  f.lastDownload.succeeded = true;
  f.emit("onDownloadChanged", f.lastDownload);
  assert.equal(f.views.size, 0);
  await a.save();
  Object.assign(f.lastDownload, { canceled: true, stopped: true });
  f.emit("onDownloadChanged", f.lastDownload);
  assert.equal(f.views.size, 0);
  assert.equal(f.errors.length, 0);
});

test("menu visibility, duplicate loading, and teardown preserve the native command", async t => {
  const f = fixture(t), a = f.makeWindow();
  const item = a.elements.get("zen-quick-save-image-command");
  a.menu.fire("popupshowing");
  assert.equal(item.hidden, false);
  a.window.gContextMenu.onCanvas = true;
  a.menu.fire("popupshowing");
  assert.equal(item.hidden, true);
  a.window.gContextMenu.onCanvas = false;
  a.nativeItem.disabled = true;
  a.menu.fire("popupshowing");
  assert.equal(item.hidden, true);
  a.reload();
  assert.equal(a.window.zenQuickSaveImage.init(), a.controller);
  assert.equal(a.elements.size, 3);
  a.nativeItem.disabled = false;
  const pending = a.save();
  a.controller.destroy();
  await pending;
  assert.equal(f.calls.length, 0);
  assert.equal(a.elements.has("context-saveimage"), true);
  assert.equal(a.elements.has("zen-quick-save-image-command"), false);
  assert.equal(a.menu.listeners.size, 0);
});

test("passes image URL schemes and MIME metadata through Firefox helpers", async t => {
  const f = fixture(t), a = f.makeWindow();
  for (const [url, type, name] of [
    ["https://example.test/image.jpg", "image/jpeg", "image.jpg"],
    ["https://example.test/image", "image/webp", "image.webp"],
    ["data:image/png;base64,AA==", "image/png", "untitled.png"],
    ["blob:https://example.test/id", "image/png", "blob.png"]
  ]) {
    a.window.gContextMenu.mediaURL = url;
    a.window.gContextMenu.contentData.contentType = type;
    f.filename = name;
    await a.save();
    assert.equal(f.calls.at(-1)[0], url);
    assert.equal(f.calls.at(-1)[5], type);
    assert.equal(path.basename(f.calls.at(-1)[8].file.path), name);
    assert.equal(f.filenameArgs.type, type);
  }
});

test("starts independently after browser startup and removes pending observers on unload", t => {
  const f = fixture(t), a = f.makeWindow(false);
  assert.equal(a.elements.has("zen-quick-save-image-command"), false);
  assert.equal(a.observers.size, 1);
  a.reload();
  assert.equal(a.observers.size, 1);
  for (const observer of [...a.observers]) observer({});
  assert.equal(a.elements.has("zen-quick-save-image-command"), false);
  for (const observer of [...a.observers]) observer(a.window);
  assert.equal(a.elements.has("zen-quick-save-image-command"), true);
  assert.equal(a.observers.size, 0);
  a.windowListeners.get("unload")();
  assert.equal(a.elements.has("zen-quick-save-image-command"), false);
  assert.equal(a.window.zenQuickSaveImage, undefined);

  const b = f.makeWindow(false);
  b.windowListeners.get("unload")();
  assert.equal(b.observers.size, 0);
  assert.equal(b.windowListeners.size, 0);
  assert.equal(b.elements.has("zen-quick-save-image-command"), false);
});

test("leaves other mods, native save functions and download observers intact", async t => {
  const f = fixture(t), a = f.makeWindow();
  const tidy = Object.freeze({ enabled: true });
  Object.defineProperty(a.window, "zenTidyDownloads", {
    get() { throw new Error("Quick Save must not access Tidy Downloads"); }
  });
  a.window.zenTidyDownloadsToasts = tidy;
  const nativeSave = a.window.internalSave;
  const nativeSecurityCheck = a.window.urlSecurityCheck;
  let tidyNotifications = 0;
  const tidyView = { onDownloadAdded() { tidyNotifications++; } };
  f.views.add(tidyView);
  await a.save();
  assert.equal(tidyNotifications, 1);
  f.lastDownload.error = new Error("Network failure");
  f.emit("onDownloadChanged", f.lastDownload);
  assert.equal(f.errors.length, 1);
  assert.equal(a.window.zenTidyDownloadsToasts, tidy);
  assert.equal(a.window.internalSave, nativeSave);
  assert.equal(a.window.urlSecurityCheck, nativeSecurityCheck);
  a.window.zenQuickSaveImage.destroy();
  assert.equal(f.views.has(tidyView), true);
  assert.equal(a.elements.has("context-saveimage"), true);
});
