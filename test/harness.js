// Test harness for PlaybackSpeedControl.user.js.
//
// The userscript runs in an immediately invoked function and accesses the
// document, GM_* functions and timers through globals. The harness provides
// those globals before evaluating the script, as a userscript manager would.
// The stubs model only what the tests need. They do not load the real Media
// Chrome or DOMPurify libraries or simulate browser rendering.
//
// Timers are fake. The script polls on a setTimeout(500) → requestAnimationFrame
// chain, and sleeping through that in real time would make the suite unusable,
// so a test advances the loop explicitly with env.tick().

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
    constructor(tagName, ownerDocument = null) {
        this.tagName = tagName.toLowerCase();
        this.children = [];
        this.parentElement = null;
        this.ownerDocument = ownerDocument;
        this.dataset = {};
        this.attributes = {};
        this.id = '';
        this.className = '';
        this.style = '';
        this.innerHTML = '';
        this.innerText = '';
        this.eventListeners = {};
        this.box = { width: 640, height: 360 };
        this.computedStyle = {};
    }

    getAttribute(name) {
        if (name === 'id') return this.id;
        if (name === 'class') return this.className;
        if (name.startsWith('data-')) return this.dataset[dashToCamel(name.slice(5))];
        return this.attributes[name];
    }

    setAttribute(name, value) {
        if (name === 'id') this.id = value;
        else if (name === 'class') this.className = value;
        else if (name.startsWith('data-')) this.dataset[dashToCamel(name.slice(5))] = value;
        else this.attributes[name] = value;
    }

    removeAttribute(name) {
        if (name === 'id') this.id = '';
        else if (name === 'class') this.className = '';
        else if (name.startsWith('data-')) delete this.dataset[dashToCamel(name.slice(5))];
        else delete this.attributes[name];
    }

    toggleAttribute(name, force) {
        const present = this.getAttribute(name) !== undefined;
        const next = force ?? !present;
        if (next) this.setAttribute(name, '');
        else this.removeAttribute(name);
        return next;
    }

    get parentNode() {
        return this.parentElement;
    }

    get nextSibling() {
        if (!this.parentElement) return null;
        const siblings = this.parentElement.children;
        return siblings[siblings.indexOf(this) + 1] || null;
    }

    getBoundingClientRect() {
        return { ...this.box, top: 0, left: 0, right: this.box.width, bottom: this.box.height };
    }

    // The stub models elements only, so child nodes and child elements are the
    // same list.
    get firstChild() {
        return this.children[0] || null;
    }

    addEventListener(type, fn, options = {}) {
        if (options.signal?.aborted) return;
        const listeners = this.eventListeners[type] = this.eventListeners[type] || [];
        if (listeners.includes(fn)) return;
        listeners.push(fn);
        if (options.signal) {
            options.signal.addEventListener('abort', () => this.removeEventListener(type, fn), { once: true });
        }
    }

    removeEventListener(type, fn) {
        this.eventListeners[type] = (this.eventListeners[type] || []).filter(listener => listener !== fn);
    }

    dispatch(type, event = {}) {
        for (const fn of [...(this.eventListeners[type] || [])]) fn(event);
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

    // Inserting a node that already has a parent moves it, and moving it into
    // another document's tree adopts it — the behaviour Picture-in-Picture
    // depends on.
    adopt(ownerDocument) {
        this.ownerDocument = ownerDocument;
        for (const child of this.children) child.adopt(ownerDocument);
    }

    link(node) {
        if (node.parentElement) node.parentElement.removeChild(node);
        node.parentElement = this;
        node.adopt(this.ownerDocument);
        return node;
    }

    appendChild(node) {
        this.children.push(this.link(node));
        return node;
    }

    append(...nodes) {
        for (const node of nodes) this.appendChild(node);
    }

    prepend(...nodes) {
        for (const node of nodes.reverse()) this.children.unshift(this.link(node));
    }

    insertBefore(node, reference) {
        if (node === reference) return node;
        this.link(node);
        const index = this.children.indexOf(reference);
        this.children.splice(index === -1 ? this.children.length : index, 0, node);
        return node;
    }

    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index === -1) throw new Error('removeChild: node is not a child');
        this.children.splice(index, 1);
        node.parentElement = null;
        return node;
    }

    contains(node) {
        return node === this || this.descendants().includes(node);
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
            const registered = (listeners[type] = listeners[type] || []);
            // Browser event targets ignore repeat registrations with the same
            // callback and capture flag. The polling loop can therefore register
            // listeners without tracking previous registrations separately.
            if (registered.some((entry) => entry.fn === fn && entry.capture === Boolean(options.capture))) return;
            const entry = { fn, capture: Boolean(options.capture) };
            registered.push(entry);
            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    listeners[type] = listeners[type].filter((candidate) => candidate !== entry);
                });
            }
        },
        dispatch(type, event) {
            for (const entry of [...(listeners[type] || [])]) entry.fn(event);
            return event;
        },
        removeEventListener(type, fn) {
            listeners[type] = (listeners[type] || []).filter(entry => entry.fn !== fn);
        },
        count(type) {
            return (listeners[type] || []).length;
        },
    };
}

function loadUserscript({
    hostname,
    port = '',
    stored = {},
    userscript = true,
    withVideo = true,
    documentPip = true,
    protocol = 'https:',
    topFrame = true,
    deferPipRequest = false,
    pipRequestError = null,
    deferLibraries = false,
    failLibraries = false,
    libraryApi = true,
    separateSandbox = false,
    controllerInitializationError = null,
    pipTrustedTypes,
    missingLibraryComponent,
    mediaSessionAvailable = true,
    mediaSessionError = null,
    blockMediaSessionObserver = false,
    menuUpdatesById = true,
    menuApi = true,
    screen = { availWidth: 1920, availHeight: 1080 },
} = {}) {
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

    // Both the page and the Picture-in-Picture window get the same shape, since
    // the script treats them as interchangeable surfaces.
    function createStubDocument() {
        const root = new StubElement('html');
        const documentTarget = createEventTarget();
        const stubDocument = {
            documentElement: root,
            visibilityState: 'visible',
            createElement: (tag) => {
                const element = new StubElement(tag, stubDocument);
                if (tag === 'media-controller' && stubDocument.defaultView?.customElements.get(tag)) {
                    if (controllerInitializationError) throw controllerInitializationError;
                    element.shadowRoot = {};
                    Object.defineProperty(element, 'media', { get: () => element.querySelector('[slot="media"]') });
                }
                if (tag === 'media-chrome-button' || tag === 'media-playback-rate-menu-button' || tag === 'media-playback-rate-menu') {
                    Object.defineProperty(element, 'disabled', {
                        get: () => element.getAttribute('disabled') !== undefined,
                        set: value => value ? element.setAttribute('disabled', '') : element.removeAttribute('disabled'),
                    });
                    element.addEventListener('click', event => {
                        if (!element.disabled) element.handleClick?.(event);
                    });
                }
                if (tag === 'media-chrome-button') {
                    let activationKey;
                    element.addEventListener('keydown', event => {
                        activationKey = !event.metaKey && !event.altKey && ['Enter', ' '].includes(event.key)
                            ? event.key : null;
                    });
                    element.addEventListener('keyup', event => {
                        if (activationKey === event.key && !element.disabled) element.handleClick?.(event);
                        activationKey = null;
                    });
                }
                if (tag === 'media-playback-rate-menu-button' || tag === 'media-playback-rate-menu') {
                    Object.defineProperty(element, 'mediaPlaybackRate', {
                        get: () => element.closest('media-controller')?.media?.playbackRate ?? 1,
                        set: () => { throw new Error('The userscript must not write library display state'); },
                    });
                    Object.defineProperty(element, 'innerText', {
                        get: () => `${element.mediaPlaybackRate}x`,
                        set: () => { throw new Error('The userscript must not write library display text'); },
                    });
                }
                if (tag === 'media-playback-rate-menu-button') {
                    element.handleClick = () => {
                        const menu = element.closest('media-controller')?.querySelector('media-playback-rate-menu');
                        if (menu) menu.hidden = !menu.hidden;
                    };
                }
                if (tag === 'media-playback-rate-menu') {
                    element.selectRate = detail => {
                        if (element.disabled || element.hidden) return;
                        const rates = element.getAttribute('rates').split(' ').map(Number).sort((a, b) => a - b);
                        if (!rates.includes(detail)) throw new Error('Rate is not offered by the library menu');
                        const event = {
                            detail: String(detail), defaultPrevented: false, propagationStopped: false,
                            preventDefault() { this.defaultPrevented = true; },
                            stopImmediatePropagation() { this.propagationStopped = true; },
                            stopPropagation() { this.propagationStopped = true; },
                        };
                        element.lastRateRequest = event;
                        element.dispatch('mediaplaybackraterequest', event);
                        const controller = element.closest('media-controller');
                        // For an unconsumed request, apply the simulated library
                        // update before invoking the userscript's controller listener.
                        if (!event.defaultPrevented && !event.propagationStopped && controller?.media) {
                            controller.media.playbackRate = detail;
                            controller.dispatch('mediaplaybackraterequest', event);
                        }
                        element.hidden = true;
                    };
                }
                return element;
            },
            createElementNS(namespaceURI, tag) {
                const element = stubDocument.createElement(tag);
                element.namespaceURI = namespaceURI;
                return element;
            },
            querySelector: (selector) => root.querySelector(selector),
            querySelectorAll: (selector) => root.querySelectorAll(selector),
            contains: (node) => root.contains(node),
            addEventListener: documentTarget.addEventListener,
            dispatch: documentTarget.dispatch,
        };
        root.ownerDocument = stubDocument;
        stubDocument.head = root.appendChild(new StubElement('head', stubDocument));
        stubDocument.body = root.appendChild(new StubElement('body', stubDocument));
        return stubDocument;
    }

    const document = createStubDocument();
    const documentElement = document.documentElement;
    const body = document.body;
    const video = new HTMLMediaElement('video', document);
    video.nativeVolumeValue = 1;
    video.playbackRate = 1;
    video.paused = false;
    video.currentTime = 12.5;
    video.readyState = 4;
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    video.srcObject = null;
    video.disablePictureInPicture = false;
    video.controls = false;
    video.pause = () => { video.paused = true; };
    if (withVideo) {
        body.appendChild(video);
    }

    const store = new Map(Object.entries(stored));
    let menuFailure = null;
    let storageWriteError = null;
    let storageReadError = null;
    const menuCommands = new Map();
    const menuOperations = [];
    const alerts = [];
    const confirms = [];
    const reloads = [];
    const logs = [];
    const consoleCalls = [];
    let nextMenuId = 1;

    function checkMenuFailure(type) {
        if (!menuFailure || menuFailure.type !== type) return;
        menuFailure.remaining--;
        if (menuFailure.remaining !== 0) return;
        menuFailure = null;
        throw new Error(`Menu ${type} failed`);
    }

    let timers = [];
    let nextTimerId = 1;
    const mutationObservers = new Set();
    globalThis.MutationObserver = class MutationObserver {
        constructor(callback) { this.callback = callback; }
        observe() { mutationObservers.add(this); }
        disconnect() { mutationObservers.delete(this); }
    };
    const intervals = new Map();
    const pendingPipRequests = [];
    let pipRequestCount = 0;
    const libraryCalls = [];
    const pendingLibraries = [];

    const windowTarget = createEventTarget();
    const window = {
        screen,
        location: {
            hostname, port, protocol,
            origin: `${protocol}//${hostname}${port ? ':' + port : ''}`,
            href: `${protocol}//${hostname}${port ? ':' + port : ''}/`,
        },
        addEventListener: windowTarget.addEventListener,
        reload() { reloads.push(true); },
    };

    // A userscript manager gives the script a sandbox window and exposes the
    // page window through unsafeWindow. Media Session and Document
    // Picture-in-Picture belong to the page window. Keeping them off the
    // sandbox window checks that the script uses the correct window.
    const realPageWindow = {
        ...window,
        addEventListener: windowTarget.addEventListener,
        isSecureContext: true,
    };
    realPageWindow.top = topFrame ? realPageWindow : {};
    realPageWindow.self = realPageWindow;
    realPageWindow.HTMLMediaElement = HTMLMediaElement;
    globalThis.unsafeWindow = realPageWindow;

    globalThis.HTMLMediaElement = separateSandbox ? class SandboxMediaElement extends StubElement {} : HTMLMediaElement;
    globalThis.document = document;
    globalThis.window = window;
    globalThis.PointerEvent = Event;
    globalThis.MouseEvent = Event;

    const mediaSessionHandlers = {};
    const mediaSession = {
        setActionHandler(action, handler) {
            if (mediaSessionError) throw mediaSessionError;
            if (handler !== null && typeof handler !== 'function') throw new TypeError('Handler must be a function or null');
            if (handler === null) delete mediaSessionHandlers[action];
            else mediaSessionHandlers[action] = handler;
        },
    };
    const capturedSetActionHandler = mediaSession.setActionHandler;
    if (blockMediaSessionObserver) {
        Object.defineProperty(mediaSession, 'setActionHandler', { writable: false });
    }
    // Only the page window carries these: a script that reads them off the
    // sandbox window finds nothing and silently never registers.
    realPageWindow.navigator = { mediaSession: mediaSessionAvailable ? mediaSession : undefined };
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value: {},
    });

    const pipTargets = new WeakMap();
    // Simulate closing a Picture-in-Picture window and dispatch pagehide
    // with its document as the event target.
    function closeOpenPipWindow(pipWindow = documentPictureInPicture.window) {
        if (!pipWindow || pipWindow.closed) return;
        pipWindow.closed = true;
        if (documentPictureInPicture.window === pipWindow) documentPictureInPicture.window = null;
        pipTargets.get(pipWindow).dispatch('pagehide', { type: 'pagehide', target: pipWindow.document });
    }

    const documentPictureInPicture = {
        window: null,
        requestWindow: async (options = {}) => {
            pipRequestCount++;
            if (pipRequestError) throw pipRequestError;
            const pipDocument = createStubDocument();
            pipDocument.documentElement.clientWidth = options.width || 640;
            pipDocument.documentElement.clientHeight = options.height || 360;
            pipDocument.documentElement.scrollWidth = options.width || 640;
            pipDocument.documentElement.scrollHeight = options.height || 360;
            const target = createEventTarget();
            const pipWindow = {
                document: pipDocument,
                screen: { ...screen },
                closed: false,
                requestedOptions: options,
                innerWidth: options.width || 640,
                innerHeight: options.height || 360,
                outerWidth: (options.width || 640) + 8,
                outerHeight: (options.height || 360) + 42,
                devicePixelRatio: 1,
                performance: { now: () => performance.now() },
                getComputedStyle: element => element.computedStyle,
                trustedTypes: pipTrustedTypes,
                addEventListener: target.addEventListener,
                removeEventListener: target.removeEventListener,
                dispatchEvent: event => target.dispatch(event.type, event),
                setTimeout: (fn, delay) => globalThis.setTimeout(fn, delay),
                clearTimeout: (id) => globalThis.clearTimeout(id),
                customElements: { get: () => undefined },
                setInterval: (fn) => {
                    const id = nextTimerId++;
                    intervals.set(id, fn);
                    return id;
                },
                clearInterval: (id) => intervals.delete(id),
                close() { closeOpenPipWindow(pipWindow); },
            };
            pipDocument.defaultView = pipWindow;
            pipTargets.set(pipWindow, target);
            documentPictureInPicture.window = pipWindow;
            if (deferPipRequest) {
                return new Promise((resolve, reject) => pendingPipRequests.push({ resolve, reject, pipWindow }));
            }
            return pipWindow;
        },
    };
    if (documentPip) {
        realPageWindow.documentPictureInPicture = documentPictureInPicture;
    }
    delete globalThis.documentPictureInPicture;

    globalThis.alert = (message) => alerts.push(message);
    globalThis.confirm = (message) => { confirms.push(message); return false; };
    globalThis.setTimeout = (fn, delay) => {
        const id = nextTimerId++;
        timers.push({ id, fn, delay });
        return id;
    };
    globalThis.clearTimeout = (id) => { timers = timers.filter((timer) => timer.id !== id); };
    globalThis.requestAnimationFrame = (fn) => globalThis.setTimeout(fn, 0);
    globalThis.console = {};
    for (const method of ['log', 'error', 'warn', 'group', 'groupCollapsed', 'table', 'groupEnd']) {
        globalThis.console[method] = (...args) => {
            consoleCalls.push({ method, args });
            if (method === 'log' || method === 'error' || method === 'warn') logs.push(args);
        };
    }

    if (userscript) {
        globalThis.GM_getResourceText = (name) => {
            libraryCalls.push(name);
            return `loadTestResource(${JSON.stringify(name)});`;
        };
        globalThis.GM_addElement = (parent, tag, attributes) => {
            if (failLibraries) return null;
            const script = parent.ownerDocument.createElement(tag);
            Object.assign(script, attributes);
            parent.appendChild(script);
            const pipWindow = parent.ownerDocument.defaultView;
            const ready = () => {
                try {
                    vm.runInNewContext(attributes.textContent, {
                        window: pipWindow, Event,
                        loadTestResource(name) {
                            if (name === 'DOMPurify') {
                                pipWindow.DOMPurify = { sanitize: html => html };
                            } else if (name === 'VideoPlayer') {
                                if (pipTrustedTypes && !pipTrustedTypes.defaultPolicy) {
                                    throw new TypeError('TrustedHTML required during library initialization');
                                }
                                pipWindow.customElements.get = tag => tag === missingLibraryComponent ? undefined : StubElement;
                            } else {
                                throw new Error(`Unexpected resource: ${name}`);
                            }
                        },
                    });
                } catch (error) {
                    pipTargets.get(pipWindow).dispatch('error', { message: error.message });
                }
            };
            if (deferLibraries) pendingLibraries.push(ready);
            else ready();
            return script;
        };
        globalThis.GM_getValue = (key, fallback) => {
            if (storageReadError) throw storageReadError;
            return store.has(key) ? store.get(key) : fallback;
        };
        globalThis.GM_setValue = (key, value) => {
            if (storageWriteError) throw storageWriteError;
            store.set(key, value);
        };
        globalThis.GM_registerMenuCommand = (label, fn, options = {}) => {
            checkMenuFailure('register');
            const updating = menuUpdatesById && menuCommands.has(options.id);
            const id = updating ? options.id : nextMenuId++;
            menuOperations.push({ type: updating ? 'update' : 'register', id, label });
            menuCommands.set(id, { label, fn });
            return id;
        };
        globalThis.GM_unregisterMenuCommand = (id) => {
            checkMenuFailure('unregister');
            menuOperations.push({ type: 'unregister', id });
            menuCommands.delete(id);
        };
    } else {
        delete globalThis.GM_getValue;
        delete globalThis.GM_setValue;
        delete globalThis.GM_registerMenuCommand;
        delete globalThis.GM_unregisterMenuCommand;
    }
    if (!userscript || !libraryApi) {
        delete globalThis.GM_addElement;
        delete globalThis.GM_getResourceText;
    }
    if (!menuApi) {
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
        pageWindow: realPageWindow,
        video,
        body,
        store,
        menuOperations,
        alerts,
        confirms,
        reloads,
        logs,
        consoleCalls,
        libraryCalls,
        finishLoadingLibraries() {
            pendingLibraries.shift()();
        },
        slots: documentElement.dataset,
        setStoredValue(key, value) {
            if (value === undefined) store.delete(key);
            else store.set(key, value);
        },
        setStorageWriteError(error) {
            storageWriteError = error;
        },
        setStorageReadError(error) {
            storageReadError = error;
        },
        failMenuOperation(type, occurrence = 1) {
            menuFailure = { type, remaining: occurrence };
        },
        menuCommandIds() {
            return [...menuCommands.keys()];
        },
        pageEvent(type, event = {}) {
            windowTarget.dispatch(type, event);
        },
        tickPip() {
            for (const fn of [...intervals.values()]) fn();
        },
        flushMutations() {
            for (const observer of mutationObservers) observer.callback();
        },

        // One loop iteration is a setTimeout that schedules a
        // requestAnimationFrame that runs the tick body, so it takes two
        // drains of the timer queue to get through it.
        tick(times = 1) {
            for (let i = 0; i < times; i++) {
                drain();
                drain();
                for (const fn of [...intervals.values()]) fn();
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
            windowTarget.dispatch('keydown', event);
            return event;
        },

        keydownListenerCount() {
            return windowTarget.count('keydown');
        },

        // The Picture-in-Picture window is a second surface with its own
        // listeners, so keys have to be delivered there to test the binding.
        pipWindow() {
            return documentPictureInPicture.window;
        },

        pipDocument() {
            const pipWindow = documentPictureInPicture.window;
            return pipWindow ? pipWindow.document : null;
        },

        pipKeydown(key, target = null, composedTarget = null) {
            const pipWindow = documentPictureInPicture.window;
            if (!pipWindow) throw new Error('no picture-in-picture window is open');
            const event = {
                key,
                target: target || pipWindow.document.body,
                defaultPrevented: false,
                propagationStopped: false,
                preventDefault() { this.defaultPrevented = true; },
                stopImmediatePropagation() { this.propagationStopped = true; },
            };
            if (composedTarget) event.composedPath = () => [composedTarget, event.target];
            pipTargets.get(pipWindow).dispatch('keydown', event);
            return event;
        },

        pipKeydownListenerCount() {
            const pipWindow = documentPictureInPicture.window;
            if (!pipWindow) return 0;
            return pipTargets.get(pipWindow).count('keydown');
        },

        pipResize(width, height) {
            const pipWindow = documentPictureInPicture.window;
            pipWindow.innerWidth = width;
            pipWindow.innerHeight = height;
            Object.assign(pipWindow.document.documentElement, {
                clientWidth: width, clientHeight: height, scrollWidth: width, scrollHeight: height,
            });
            pipTargets.get(pipWindow).dispatch('resize', { type: 'resize' });
        },

        // Return the Media Session handler Chrome can call to enter Picture-in-Picture.
        mediaSessionHandler(action = 'enterpictureinpicture') {
            return mediaSessionHandlers[action];
        },

        // Simulate the page registering its own handler. Media Session has no
        // handler getter, but the script can observe calls through the current
        // setActionHandler method. The captured-method helper bypasses that observer.
        pageSetsMediaSessionHandler(handler, action = 'enterpictureinpicture') {
            mediaSession.setActionHandler(action, handler);
        },

        pageUsesCapturedMediaSessionHandler(handler, action = 'enterpictureinpicture') {
            capturedSetActionHandler.call(mediaSession, action, handler);
        },

        setMediaSessionError(error) {
            mediaSessionError = error;
        },

        enterPictureInPicture(details) {
            const handler = mediaSessionHandlers.enterpictureinpicture;
            if (!handler) throw new Error('no enterpictureinpicture handler is registered');
            return handler(details);
        },

        resolvePipRequest() {
            const pending = pendingPipRequests.shift();
            pending.resolve(pending.pipWindow);
        },

        pipRequestCount() {
            return pipRequestCount;
        },

        // A window opened by the page itself, which the script must leave alone.
        openPipWindow(options) {
            return documentPictureInPicture.requestWindow(options);
        },

        // Simulate a user closing the window: clear the public window reference,
        // then dispatch pagehide.
        closePipWindow() {
            closeOpenPipWindow();
        },

        pipPlaceholder() {
            return document.querySelector('[data-playback-speed-pip-slot]');
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

        addPlexPlayer() {
            const player = new StubElement('div', document);
            player.className = 'PlayerContainer-container-9f3c1d';
            const controls = new StubElement('div', document);
            controls.className = 'PlayerControls-buttonGroupRight-abc123';
            body.appendChild(player);
            player.appendChild(video);
            player.appendChild(controls);
            return { player, controls };
        },

        // Provide the control strip where the userscript inserts Plex speed buttons.
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
