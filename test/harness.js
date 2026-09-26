// Test harness for PlaybackSpeedControl.user.js.
//
// The userscript is a bare IIFE that talks to the DOM, the GM_* API and the
// timers through globals, so a test has to stand those globals up before
// evaluating it — the same job a userscript manager does in a real browser.
// Everything here is the smallest stub that lets the script take its real code
// path; nothing is mocked that the script does not actually touch.
//
// Timers are fake. The script polls on a setTimeout(500) → requestAnimationFrame
// chain, and sleeping through that in real time would make the suite unusable,
// so a test advances the loop explicitly with env.tick().

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'PlaybackSpeedControl.user.js');
const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');

const originalConsole = console;

// Selector support is limited to the shapes the script actually queries:
// tag, #id, [attr], [attr="value"], [attr*="value"] and comma-separated lists.
const SIMPLE_SELECTOR = /^([a-z0-9-]*)(#[\w-]+)?((?:\[[^\]]+\])*)$/i;
const ATTRIBUTE_PART = /\[([\w-]+)(?:(\*?=)"?([^"\]]*)"?)?\]/g;

function dashToCamel(name) {
    return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

class StubElement {
    constructor(tagName) {
        this.tagName = tagName.toLowerCase();
        this.children = [];
        this.parentElement = null;
        this.dataset = {};
        this.attributes = {};
        this.id = '';
        this.className = '';
        this.style = '';
        this.innerHTML = '';
        this.innerText = '';
        this.eventListeners = {};
    }

    getAttribute(name) {
        if (name === 'id') return this.id;
        if (name === 'class') return this.className;
        if (name.startsWith('data-')) return this.dataset[dashToCamel(name.slice(5))];
        return this.attributes[name];
    }

    addEventListener(type, fn) {
        (this.eventListeners[type] = this.eventListeners[type] || []).push(fn);
    }

    dispatch(type, event = {}) {
        for (const fn of this.eventListeners[type] || []) fn(event);
        return event;
    }

    // The Plex "Play Next" path fires PointerEvent/MouseEvent objects before
    // calling .click(); the stub treats all of them as plain dispatches.
    dispatchEvent(event) {
        this.dispatch(event.type, event);
        return true;
    }

    click() {
        this.dispatch('click', { type: 'click' });
    }

    appendChild(node) {
        node.parentElement = this;
        this.children.push(node);
        return node;
    }

    prepend(...nodes) {
        for (const node of nodes) node.parentElement = this;
        this.children.unshift(...nodes);
    }

    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index === -1) throw new Error('removeChild: node is not a child');
        this.children.splice(index, 1);
        node.parentElement = null;
        return node;
    }

    remove() {
        if (this.parentElement) this.parentElement.removeChild(this);
    }

    matches(selector) {
        return selector.split(',').some((part) => this.matchesSimple(part.trim()));
    }

    matchesSimple(selector) {
        const parsed = SIMPLE_SELECTOR.exec(selector);
        if (!parsed) throw new Error(`unsupported selector in stub DOM: ${selector}`);
        const [, tag, id, attributes] = parsed;
        if (tag && tag.toLowerCase() !== this.tagName) return false;
        if (id && id.slice(1) !== this.id) return false;

        ATTRIBUTE_PART.lastIndex = 0;
        let attribute;
        while ((attribute = ATTRIBUTE_PART.exec(attributes)) !== null) {
            const [, name, operator, value] = attribute;
            const actual = this.getAttribute(name);
            if (actual === undefined || actual === null) return false;
            if (!operator) continue;
            if (operator === '=' && String(actual) !== value) return false;
            if (operator === '*=' && !String(actual).includes(value)) return false;
        }
        return true;
    }

    descendants() {
        const found = [];
        for (const child of this.children) {
            found.push(child, ...child.descendants());
        }
        return found;
    }

    querySelectorAll(selector) {
        return this.descendants().filter((node) => node.matches(selector));
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    closest(selector) {
        let node = this;
        while (node) {
            if (node.matches(selector)) return node;
            node = node.parentElement;
        }
        return null;
    }
}

function createEventTarget() {
    const listeners = {};
    return {
        listeners,
        addEventListener(type, fn, options = {}) {
            // The script passes an AbortController signal so a torn-down
            // instance stops receiving keys; honour it like the real target.
            if (options.signal && options.signal.aborted) return;
            (listeners[type] = listeners[type] || []).push(fn);
            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    listeners[type] = listeners[type].filter((registered) => registered !== fn);
                });
            }
        },
    };
}

function loadUserscript({ hostname, port = '', stored = {}, userscript = true, withVideo = true } = {}) {
    // A fresh media class per load means the volume descriptor the script
    // overrides is never shared between tests.
    class HTMLMediaElement extends StubElement {}
    const nativeVolume = {
        get() { return this.nativeVolumeValue; },
        set(value) { this.nativeVolumeValue = value; },
        configurable: true,
        enumerable: true,
    };
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', nativeVolume);

    const documentElement = new StubElement('html');
    const body = documentElement.appendChild(new StubElement('body'));
    const video = new HTMLMediaElement('video');
    video.nativeVolumeValue = 1;
    video.playbackRate = 1;
    if (withVideo) {
        body.appendChild(video);
    }

    const document = {
        documentElement,
        body,
        createElement: (tag) => new StubElement(tag),
        querySelector: (selector) => documentElement.querySelector(selector),
        querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
    };

    const store = new Map(Object.entries(stored));
    const menuCommands = new Map();
    const menuOperations = [];
    const alerts = [];
    const confirms = [];
    const reloads = [];
    const logs = [];
    let nextMenuId = 1;

    let timers = [];
    let nextTimerId = 1;

    const windowTarget = createEventTarget();
    const window = {
        location: { hostname, port, href: `https://${hostname}${port ? ':' + port : ''}/` },
        addEventListener: windowTarget.addEventListener,
        reload() { reloads.push(true); },
    };

    globalThis.HTMLMediaElement = HTMLMediaElement;
    globalThis.document = document;
    globalThis.window = window;
    globalThis.PointerEvent = Event;
    globalThis.MouseEvent = Event;
    globalThis.alert = (message) => alerts.push(message);
    globalThis.confirm = (message) => { confirms.push(message); return false; };
    globalThis.setTimeout = (fn, delay) => {
        const id = nextTimerId++;
        timers.push({ id, fn, delay });
        return id;
    };
    globalThis.clearTimeout = (id) => { timers = timers.filter((timer) => timer.id !== id); };
    globalThis.requestAnimationFrame = (fn) => globalThis.setTimeout(fn, 0);
    globalThis.console = {
        log: (...args) => logs.push(args),
        error: (...args) => logs.push(args),
        warn: (...args) => logs.push(args),
    };

    if (userscript) {
        globalThis.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
        globalThis.GM_setValue = (key, value) => store.set(key, value);
        globalThis.GM_registerMenuCommand = (label, fn) => {
            const id = nextMenuId++;
            menuOperations.push({ type: 'register', id, label });
            menuCommands.set(id, { label, fn });
            return id;
        };
        globalThis.GM_unregisterMenuCommand = (id) => {
            menuOperations.push({ type: 'unregister', id });
            return menuCommands.delete(id);
        };
    } else {
        delete globalThis.GM_getValue;
        delete globalThis.GM_setValue;
        delete globalThis.GM_registerMenuCommand;
        delete globalThis.GM_unregisterMenuCommand;
    }

    (0, eval)(scriptSource);

    function drain() {
        const batch = timers;
        timers = [];
        for (const timer of batch) timer.fn();
    }

    return {
        document,
        window,
        video,
        body,
        store,
        menuOperations,
        alerts,
        confirms,
        reloads,
        logs,
        slots: documentElement.dataset,

        // One loop iteration is a setTimeout that schedules a
        // requestAnimationFrame that runs the tick body, so it takes two
        // drains of the timer queue to get through it.
        tick(times = 1) {
            for (let i = 0; i < times; i++) {
                drain();
                drain();
            }
        },

        keydown(key, target = body) {
            const event = {
                key,
                target,
                defaultPrevented: false,
                propagationStopped: false,
                preventDefault() { this.defaultPrevented = true; },
                stopImmediatePropagation() { this.propagationStopped = true; },
            };
            for (const fn of windowTarget.listeners.keydown || []) fn(event);
            return event;
        },

        keydownListenerCount() {
            return (windowTarget.listeners.keydown || []).length;
        },

        menuLabels() {
            return [...menuCommands.values()].map((command) => command.label);
        },

        menuItem(labelPrefix) {
            return [...menuCommands.values()].find((command) => command.label.startsWith(labelPrefix));
        },

        toggleMenuItem(labelPrefix) {
            const item = this.menuItem(labelPrefix);
            if (!item) throw new Error(`no menu command labelled ${labelPrefix}: ${this.menuLabels()}`);
            item.fn();
        },

        // Reads the element's real volume, bypassing whatever the script
        // installed on the prototype.
        nativeVolume() {
            return nativeVolume.get.call(video);
        },

        setNativeVolume(value) {
            nativeVolume.set.call(video, value);
        },

        // Plex injects its speed buttons into the player control strip.
        addPlexControlBar() {
            const container = new StubElement('div');
            container.className = 'PlayerControls-buttonGroupRight-abc123';
            return body.appendChild(container);
        },

        // YouTube reads loudness normalization off the player element that
        // wraps the video.
        wrapInYouTubePlayer(loudnessDb) {
            const player = new StubElement('div');
            player.id = 'movie_player';
            player.getPlayerResponse = () => ({ playerConfig: { audioConfig: { loudnessDb } } });
            body.removeChild(video);
            body.appendChild(player);
            player.appendChild(video);
            return player;
        },

        createElement(tag) {
            return new StubElement(tag);
        },
    };
}

module.exports = { loadUserscript, originalConsole, StubElement };
