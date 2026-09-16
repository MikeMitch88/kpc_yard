/**
 * Lightweight in-memory Realtime-Database emulator.
 *
 * Exposes a `ref(path)` factory with an API subset compatible with the
 * Firebase Admin RTDB refs used across the services, so the backend runs in a
 * local sandbox/test environment without provisioning real credentials. When real
 * Firebase credentials are supplied (see config/firebase.js) this module is
 * bypassed entirely.
 */

function clone(value) {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map(clone);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

function getPath(root, segments) {
  let cur = root;
  for (const seg of segments) {
    if (cur && typeof cur === "object" && seg in cur) cur = cur[seg];
    else return null;
  }
  return cur;
}

export function createMemoryStore() {
  const root = {};
  const listeners = new Map();

  function notify(flatPath) {
    const dotPath = flatPath.replace(/\//g, ".");
    for (const [listenerPath, cb] of listeners) {
      if (dotPath === listenerPath || dotPath.startsWith(listenerPath + ".")) {
        const segments = listenerPath.split(".");
        cb(new Snapshot(makeRef(segments), getPath(root, segments)));
      }
    }
  }

  function setPath(segments, value) {
    if (segments.length === 0) {
      if (value === null || value === undefined) {
        for (const k of Object.keys(root)) delete root[k];
      } else {
        for (const k of Object.keys(root)) delete root[k];
        Object.assign(root, clone(value));
      }
      notify("");
      return;
    }
    writeNested(root, segments, value);
    notify(segments.join("."));
  }

  function writeNested(obj, segments, value) {
    const [head, ...rest] = segments;
    if (rest.length === 0) {
      if (value === null || value === undefined) delete obj[head];
      else {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          // nested-object merge (used by update semantics)
          obj[head] = { ...(typeof obj[head] === "object" && obj[head] ? obj[head] : {}), ...clone(value) };
        } else {
          obj[head] = clone(value);
        }
      }
      return;
    }
    if (!obj[head] || typeof obj[head] !== "object") obj[head] = {};
    writeNested(obj[head], rest, value);
  }

  function applyUpdate(segments, patch) {
    for (const [k, v] of Object.entries(patch)) {
      writeNested(root, [...segments, ...k.split("/").filter(Boolean)], v);
      notify([...segments, k].join("."));
    }
    notify(segments.join("."));
  }

  let counter = 0;
  function id() {
    counter += 1;
    return `mem_${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeRef(segments) {
    const self = {
      get key() {
        return segments.length ? segments[segments.length - 1] : null;
      },
      child(path) {
        return makeRef([...segments, ...path.split("/").filter(Boolean)]);
      },
      path() {
        return segments.join("/");
      },
      async set(value) {
        setPath(segments, value);
        return { key: self.key };
      },
      async remove() {
        setPath(segments, null);
        return { key: self.key };
      },
      async push(value) {
        const key = id();
        setPath([...segments, key], value);
        return { key };
      },
      async update(patch) {
        applyUpdate(segments, patch);
        return new Snapshot(self, getPath(root, segments)).val();
      },
      async get() {
        return new Snapshot(self, getPath(root, segments));
      },
      async once() {
        return this.get();
      },
      on(type, callback) {
        if (type === "value") {
          listeners.set(segments.join("/"), callback);
          callback(new Snapshot(self, getPath(root, segments)));
        }
        return () => listeners.delete(segments.join("/"));
      },
      off() {
        listeners.delete(segments.join("/"));
      },
    };
    return self;
  }

  class Snapshot {
    constructor(ref, value) {
      this._ref = ref;
      this._value = clone(value);
    }
    val() {
      return this._value;
    }
    exists() {
      return this._value !== null && this._value !== undefined;
    }
    key() {
      return this._ref.key;
    }
    child(path) {
      const segs = path.split("/").filter(Boolean);
      return new Snapshot(this._ref.child(path), getPath(root, [...segs]));
    }
  }

  const store = {
    root,
    ref: (path) => makeRef(path.split("/").filter(Boolean)),
    listeners,
  };
  return store;
}

export function generateKey(prefix = "") {
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.round(Math.random() * 1e6).toString(36).toUpperCase()}`;
}