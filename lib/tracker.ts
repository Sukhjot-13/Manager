export const TRACKER_VERSION = 1;

export const TRACKER_PATH = "/t.js";

export const TRACKER_SOURCE = `/* Manager tracker v1 - zero dependencies, no eval, no inline handlers.
 * Auto pageviews (SPA safe), click map, custom events. One request per batch, no
 * external calls, no cookies, no cross-site identifier.
 * Opt out: navigator.doNotTrack === "1", navigator.globalPrivacyControl === true,
 * localStorage.mgr_optout === "1", or window.__mgrOptOut = true before this script runs.
 * Opt back in: localStorage.setItem("mgr_optout", "0") or window.__mgr("optonin").
 * API: window.__mgr("event", name, props) | ("pageview") | ("optout") | ("optonin")
 */
(function () {
  "use strict";
  try {
    var VERSION = ${TRACKER_VERSION};
    var MAX_BATCH = 20;
    var MAX_QUEUE = 60;
    var FLUSH_MS = 5000;
    var TEXT_LIMIT = 100;
    var NAME_LIMIT = 120;
    var PATH_LIMIT = 512;
    var OPT_OUT_STORE = "mgr_optout";
    var SESSION_STORE = "mgr_sid";
    var UTM_KEYS = ["source", "medium", "campaign", "term", "content"];

    if (window.__mgrLoaded) {
      return;
    }

    function findSelf() {
      if (document.currentScript) {
        return document.currentScript;
      }
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i -= 1) {
        if ((all[i].src || "").indexOf("/t.js") !== -1) {
          return all[i];
        }
      }
      return null;
    }

    var el = findSelf();
    if (!el) {
      return;
    }
    var src = el.src || "";
    var cut = src.indexOf("/t.js");
    if (cut < 1) {
      return;
    }
    var endpoint = src.slice(0, cut);
    var key = el.getAttribute("data-key") || "";
    var app = el.getAttribute("data-app") || location.hostname;
    if (key === "" || endpoint === "") {
      return;
    }
    var asked = (src.split("?v=")[1] || "").split("&")[0];
    var wanted = parseInt(asked, 10);
    if (!isNaN(wanted) && wanted > 0 && wanted < VERSION) {
      return;
    }
    window.__mgrLoaded = true;

    function store() {
      try {
        return window.localStorage;
      } catch (e) {
        return null;
      }
    }

    function optedOut() {
      try {
        if (window.__mgrOptOut === true) {
          return true;
        }
        if (navigator.doNotTrack === "1" || window.doNotTrack === "1") {
          return true;
        }
        if (navigator.globalPrivacyControl === true) {
          return true;
        }
        var s = store();
        if (s !== null && s.getItem(OPT_OUT_STORE) === "1") {
          return true;
        }
      } catch (e) {
        return true;
      }
      return false;
    }

    var queue = [];
    var lastUrl = "";
    var lastReferrer = "";

    function sessionId() {
      try {
        var s = window.sessionStorage;
        var id = s.getItem(SESSION_STORE);
        if (!id) {
          id =
            Math.random().toString(36).slice(2, 10) +
            Date.now().toString(36).slice(-6);
          s.setItem(SESSION_STORE, id);
        }
        return id;
      } catch (e) {
        return "";
      }
    }

    function path() {
      var p = location.pathname + location.search;
      return p.length > PATH_LIMIT ? p.slice(0, PATH_LIMIT) : p;
    }

    function utm() {
      var out = {};
      try {
        if (location.search.length < 2) {
          return out;
        }
        var params = new URLSearchParams(location.search);
        for (var i = 0; i < UTM_KEYS.length; i += 1) {
          var value = params.get("utm_" + UTM_KEYS[i]);
          if (value) {
            out[UTM_KEYS[i]] = value.slice(0, 120);
          }
        }
      } catch (e) {
        return {};
      }
      return out;
    }

    function send(beacon) {
      try {
        if (queue.length === 0) {
          return;
        }
        var batch = queue.slice(0, MAX_QUEUE);
        queue = [];
        var body = JSON.stringify({ key: key, events: batch });
        var url = endpoint + "/api/ingest/events";
        if (beacon && navigator.sendBeacon) {
          try {
            navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
            return;
          } catch (e) {
            void 0;
          }
        }
        try {
          fetch(url, {
            method: "POST",
            body: body,
            headers: { "content-type": "application/json" },
            keepalive: true,
            mode: "cors",
            credentials: "omit"
          }).catch(function () {});
        } catch (e) {
          return;
        }
      } catch (e) {
        return;
      }
    }

    function track(type, name, props) {
      try {
        if (optedOut()) {
          return;
        }
        var entry = {
          type: type,
          name: (name || "").slice(0, NAME_LIMIT),
          path: path(),
          referrer: (type === "pageview" ? lastReferrer : "").slice(0, PATH_LIMIT),
          utm: utm(),
          sessionId: sessionId(),
          ts: Date.now()
        };
        if (props) {
          try {
            if (JSON.stringify(props).length <= 1000) {
              entry.props = props;
            }
          } catch (e) {
            void 0;
          }
        }
        queue.push(entry);
        if (queue.length >= MAX_BATCH) {
          send(false);
        }
      } catch (e) {
        return;
      }
    }

    function pageview() {
      try {
        var url = location.pathname + location.search;
        if (url === lastUrl) {
          return;
        }
        lastReferrer = lastUrl === "" ? document.referrer || "" : lastUrl;
        lastUrl = url;
        track("pageview", app, null);
      } catch (e) {
        return;
      }
    }

    function describe(node) {
      var text = node.innerText || node.textContent || node.value || "";
      text = String(text).replace(/\\s+/g, " ").trim();
      if (text.length > TEXT_LIMIT) {
        text = text.slice(0, TEXT_LIMIT);
      }
      var selector = "";
      if (node.id) {
        selector = "#" + node.id;
      }
      var cls = node.className;
      if (typeof cls === "string" && cls.trim() !== "") {
        selector +=
          (selector === "" ? "" : " ") +
          "." +
          cls.trim().split(/\\s+/).slice(0, 2).join(".");
      }
      if (selector === "") {
        selector = (node.tagName || "div").toLowerCase();
      }
      return "[" + path() + "] " + text + " (" + selector + ")";
    }

    function onClick(event) {
      try {
        var node = event.target;
        if (!node || !node.tagName) {
          return;
        }
        if (node.closest) {
          var link = node.closest("a,button,[role=button],[data-mgr]");
          if (link) {
            node = link;
          }
        }
        track("click", describe(node), null);
      } catch (e) {
        return;
      }
    }

    function onRoute() {
      try {
        if (queue.length > 0) {
          send(false);
        }
        pageview();
      } catch (e) {
        return;
      }
    }

    function patch(name) {
      try {
        var original = history[name];
        if (typeof original !== "function") {
          return;
        }
        history[name] = function () {
          var result = original.apply(this, arguments);
          try {
            pageview();
          } catch (e) {
            void 0;
          }
          return result;
        };
      } catch (e) {
        return;
      }
    }

    window.__mgr = function (command, name, props) {
      try {
        if (command === "event") {
          if (typeof name === "string" && name !== "") {
            track("custom", name, props);
          }
          return;
        }
        if (command === "pageview") {
          lastUrl = "";
          pageview();
          return;
        }
        var s = store();
        if (s === null) {
          return;
        }
        if (command === "optout") {
          s.setItem(OPT_OUT_STORE, "1");
          queue = [];
          return;
        }
        if (command === "optonin") {
          s.setItem(OPT_OUT_STORE, "0");
          return;
        }
      } catch (e) {
        return;
      }
    };

    if (optedOut()) {
      return;
    }

    patch("pushState");
    patch("replaceState");
    window.addEventListener("popstate", onRoute);
    window.addEventListener("pagehide", function () {
      send(true);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        send(true);
      }
    });
    document.addEventListener("click", onClick, true);
    window.setInterval(function () {
      send(false);
    }, FLUSH_MS);
    pageview();
  } catch (e) {
    return;
  }
})();
`;

export type EmbedSnippetProject = {
  origin: string;
  slug: string;
  key?: string;
  version?: number;
};

export type EmbedSnippet = {
  html: string;
  maskedHtml: string;
  hasKey: boolean;
  maskedKey: string;
  scriptUrl: string;
};

export const MASKED_KEY_TAIL = "••••••••";

function originOf(origin: string): string {
  return origin.replace(/\/+$/, "");
}

function scriptUrlFor(origin: string, version: number): string {
  return `${originOf(origin)}${TRACKER_PATH}?v=${version}`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function snippetFor(origin: string, app: string, key: string, version: number): string {
  return [
    `<script async src="${scriptUrlFor(origin, version)}"`,
    ` data-app="${escapeAttribute(app)}" data-key="${escapeAttribute(key)}"></script>`,
  ].join("");
}

export function getEmbedSnippet(project: EmbedSnippetProject): EmbedSnippet {
  const version = project.version ?? TRACKER_VERSION;
  const key = (project.key ?? "").trim();
  const maskedKey =
    key === "" ? `mak_${MASKED_KEY_TAIL}` : `${key.slice(0, 7)}${MASKED_KEY_TAIL}`;
  return {
    html: snippetFor(project.origin, project.slug, key === "" ? maskedKey : key, version),
    maskedHtml: snippetFor(project.origin, project.slug, maskedKey, version),
    hasKey: key !== "",
    maskedKey,
    scriptUrl: scriptUrlFor(project.origin, version),
  };
}
