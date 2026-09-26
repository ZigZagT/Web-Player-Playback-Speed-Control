// ==UserScript==
// @name         Playback Speed Control
// @namespace    https://github.com/ZigZagT
// @version      2.4.0
// @downloadURL  https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js
// @updateURL    https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js
// @description  Add playback speed controls to web players with keyboard shortcuts
// @author       ZigZagT
// @include      /^https?://[^/]*plex[^/]*/
// @include      /^https?://[^/]*:32400/
// @include      *://app.plex.tv/**
// @include      *://plex.tv/**
// @include      *://*.youtube.com/**
// @match        *://*/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @license MIT
// ==/UserScript==

(function() {
    'use strict';
    const console_log = (...args) => console.log('PlaybackSpeed:', ...args);

    // ─── Site Detection ───

    const isPlex = /plex/i.test(window.location.hostname) || window.location.port === '32400';
    const isYouTube = window.location.hostname.includes('youtube.com');

    function getNormalizedOrigin() {
        if (isPlex) return 'plex';
        if (isYouTube) return 'youtube';
        let hostname = window.location.hostname;
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }
        const port = window.location.port ? ':' + window.location.port : '';
        return hostname + port;
    }
    const normalizedOrigin = getNormalizedOrigin();
    const isKnownSite = normalizedOrigin === 'plex' || normalizedOrigin === 'youtube';

    // ─── Runtime Detection ───

    const isUserscript = (
        typeof GM_registerMenuCommand !== 'undefined' &&
        typeof GM_unregisterMenuCommand !== 'undefined' &&
        typeof GM_getValue !== 'undefined' &&
        typeof GM_setValue !== 'undefined'
    );

    // ─── Multi-Instance Claiming ───

    // Shared state lives on <html> dataset so both the userscript sandbox
    // and the page's regular JS context can see the same slots.
    const slots = document.documentElement.dataset;
    if (isUserscript) {
        if (slots.playbackSpeedControlUserscript) {
            console_log('userscript instance already running, bailing');
            return;
        }
        slots.playbackSpeedControlUserscript = 'active';
    } else {
        if (slots.playbackSpeedControlUserscript) {
            console_log('userscript instance present, bailing');
            return;
        }
        if (slots.playbackSpeedControl) {
            console_log('non-userscript instance already running, bailing');
            return;
        }
        slots.playbackSpeedControl = 'active';
    }

    // ─── Settings ───

    function getSetting(key, defaultValue) {
        if (!isUserscript) return defaultValue;
        return GM_getValue(key, defaultValue);
    }

    function setSetting(key, value) {
        if (!isUserscript) return;
        GM_setValue(key, value);
    }

    // v2.2 kept the volume toggle in its own per-site name. Reading the old key
    // as the fallback means a user who turned the feature off there keeps it
    // off through the rename.
    const legacySettingKeys = {
        'naturalVolume:plex': 'plexNaturalVolume',
        'naturalVolume:youtube': 'youtubeNaturalVolume',
    };

    // Features ship on for the sites this script supports out of the box and
    // are opt-in everywhere else.
    function getFeatureSetting(feature) {
        const key = `${feature}:${normalizedOrigin}`;
        let fallback = isKnownSite;
        if (legacySettingKeys[key]) {
            fallback = getSetting(legacySettingKeys[key], fallback);
        }
        return getSetting(key, fallback);
    }

    let settings = {
        plexSkipAutoPlayCountdown: getSetting('plexSkipAutoPlayCountdown', true),
        playbackSpeed: getFeatureSetting('playbackSpeed'),
        naturalVolume: getFeatureSetting('naturalVolume'),
    };

    // Non-userscript: only Plex features
    if (!isUserscript && !isPlex) {
        console_log('non-userscript mode only supports Plex, bailing');
        return;
    }

    // ─── Menu Commands (userscript only, scoped to current site) ───

    const menuToggles = [
        { key: 'playbackSpeed', storageKey: `playbackSpeed:${normalizedOrigin}`,
          labelOn: `Playback Speed (${normalizedOrigin}): Enabled \u2713`,
          labelOff: `Playback Speed (${normalizedOrigin}): Disabled \u2717` },
        { key: 'naturalVolume', storageKey: `naturalVolume:${normalizedOrigin}`,
          labelOn: `Natural Volume (${normalizedOrigin}): Enabled \u2713`,
          labelOff: `Natural Volume (${normalizedOrigin}): Disabled \u2717` },
    ];
    if (isPlex) {
        menuToggles.push(
            { key: 'plexSkipAutoPlayCountdown', labelOn: 'Skip Auto Play Countdown: Enabled \u2713', labelOff: 'Skip Auto Play Countdown: Disabled \u2717' },
        );
    }

    // Plex and YouTube are tested; anywhere else the user should know what a
    // feature will do to their site before it takes over.
    if (!isKnownSite) {
        const warnings = {
            playbackSpeed: 'Playback Speed Control takes over the number keys 1-9 and the , . < > keys on this site, '
                + 'and keeps the player pinned to the speed you pick. '
                + 'It has not been tested here, so it may shadow the site\'s own keyboard shortcuts or fight its speed controls. '
                + 'If you experience problems, disable this setting from the Userscript menu.',
            naturalVolume: 'Natural Volume applies a generic audio fix to this site. '
                + 'It has not been tested here and may not work correctly or could cause audio issues. '
                + 'If you experience problems, disable this setting from the Userscript menu.',
        };
        for (const toggle of menuToggles) {
            toggle.warning = warnings[toggle.key];
        }
    }

    let lastActivationReason = null;

    // Saved preferences keep settings reachable without a player; media
    // controls still need a local video before consuming events.
    function shouldActivateScript({ requireVideo = false } = {}) {
        const hasVideo = document.querySelector("video") !== null;
        let active = false;
        let reason = 'no video element or saved settings for this site';
        if (hasVideo) {
            active = true;
            reason = 'video element exists in this frame';
        } else if (menuToggles.some(toggle => {
            const key = toggle.storageKey || toggle.key;
            const legacyKey = legacySettingKeys[key];
            return getSetting(key, undefined) !== undefined ||
                (legacyKey !== undefined && getSetting(legacyKey, undefined) !== undefined);
        })) {
            active = true;
            reason = 'saved settings exist for this site';
        }
        if (reason !== lastActivationReason) {
            console_log(`script ${active ? 'activated' : 'not activated'} (${normalizedOrigin}): ${reason}`);
            lastActivationReason = reason;
        }
        return active && (!requireVideo || hasVideo);
    }

    let menuCommandsRegistered = false;
    let menuLabelsChanged = false;

    function registerMenuCommands() {
        if (!isUserscript) return;

        const shouldRegister = shouldActivateScript();
        if (shouldRegister === menuCommandsRegistered && !menuLabelsChanged) {
            return;
        }

        for (const toggle of menuToggles) {
            if (toggle.cmdId !== undefined) {
                GM_unregisterMenuCommand(toggle.cmdId);
                delete toggle.cmdId;
            }
            if (!shouldRegister) continue;
            const label = settings[toggle.key] ? toggle.labelOn : toggle.labelOff;
            toggle.cmdId = GM_registerMenuCommand(label, () => {
                settings[toggle.key] = !settings[toggle.key];
                menuLabelsChanged = true;
                setSetting(toggle.storageKey || toggle.key, settings[toggle.key]);
                registerMenuCommands();
                if (toggle.warning && settings[toggle.key]) {
                    alert(toggle.warning);
                }
                // Every toggle is read per loop tick and per keypress, so the
                // change takes effect on the spot. The reload prompt that used
                // to live here existed for the site-wide kill switches, which
                // decided at load time whether the script ran at all.
                console_log(`${toggle.key} is now ${settings[toggle.key] ? 'ENABLED' : 'DISABLED'}`);
            });
        }
        menuCommandsRegistered = shouldRegister;
        menuLabelsChanged = false;
    }

    // ─── Common: Playback Speed Control ───

    const cycleSpeeds = [
        0.5, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3, 5, 4, 5, 6, 7, 8, 9, 10, 15, 20
    ];
    const quickSetSpeeds = {
        1: 1,
        2: 1.5,
        3: 2,
        4: 3,
        5: 4,
        6: 5,
        7: 7,
        8: 8,
        9: 10,
    };
    let currentSpeed = 1;

    function prompt(txt) {
        const existingPrompt = document.querySelector("#playback-speed-prompt");
        if (existingPrompt) {
            document.body.removeChild(existingPrompt);
        }
        const prompt = document.createElement("div");
        prompt.id = "playback-speed-prompt";
        prompt.innerText = txt;
        document.body.appendChild(prompt);
        prompt.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 8em;
            height: 2em;
            background-color: rgba(0, 0, 0, 0.5);
            color: white;
            font-size: 2em;
            text-align: center;
            z-index: 99999;
            pointer-events: none;
          `;
        setTimeout(() => {
            try {
                document.body.removeChild(prompt);
            } catch (e) {}
        }, 2000);
    }

    function setVideoSpeed(speed) {
        currentSpeed = speed;
    }

    function syncVideoSpeed() {
        if (!shouldActivateScript({ requireVideo: true }) || !settings.playbackSpeed) {
            return;
        }
        const videoElem = document.querySelector("video");
        if (videoElem.playbackRate != currentSpeed) {
            console_log(`setting playbackRate to ${currentSpeed} for`, videoElem);
            videoElem.playbackRate = currentSpeed;
        }
    }

    function getNextCycleSpeed(direction, currentSpeed) {
        let newSpeed = currentSpeed;
        for (const speed of cycleSpeeds) {
            if (direction === 'slowdown') {
                if (speed < currentSpeed) {
                    newSpeed = speed;
                } else {
                    break;
                }
            } else if (direction === 'speedup') {
                if (speed > currentSpeed) {
                    newSpeed = speed;
                    break;
                }
            } else {
                console.error(`invalid change speed direction ${direction}`)
                break;
            }
        }
        return newSpeed;
    }

    function keyboardUpdateSpeed(e) {
        if (!shouldActivateScript({ requireVideo: true }) || !settings.playbackSpeed) {
            return;
        }
        const target = e.target;
        if (target.matches('input, textarea, [contenteditable]')) {
            return;
        }

        let newSpeed = currentSpeed;
        let isEventHandled = false;
        console_log({currentSpeed, key: e.key});
        if (e.key in quickSetSpeeds) {
            newSpeed = quickSetSpeeds[e.key];
            isEventHandled = true;
        } else if (["<", ","].includes(e.key)) {
            newSpeed = getNextCycleSpeed('slowdown', currentSpeed);
            isEventHandled = true;
        } else if ([">", "."].includes(e.key)) {
            newSpeed = getNextCycleSpeed('speedup', currentSpeed);
            isEventHandled = true;
        }

        if (isEventHandled) {
            e.preventDefault();
            e.stopImmediatePropagation();
            console_log('change speed to', newSpeed);
            setVideoSpeed(newSpeed);
            prompt(`Speed: ${newSpeed}x`);
        }
    }

    function btnSpeedUpFn() {
        if (!shouldActivateScript({ requireVideo: true }) || !settings.playbackSpeed) {
            return;
        }
        let newSpeed = getNextCycleSpeed('speedup', currentSpeed);
        console_log('change speed to', newSpeed);
        setVideoSpeed(newSpeed);
        prompt(`Speed: ${newSpeed}x`);
    }

    function btnSlowdownFn() {
        if (!shouldActivateScript({ requireVideo: true }) || !settings.playbackSpeed) {
            return;
        }
        let newSpeed = getNextCycleSpeed('slowdown', currentSpeed);
        console_log('change speed to', newSpeed);
        setVideoSpeed(newSpeed);
        prompt(`Speed: ${newSpeed}x`);
    }

    // ─── Common: Natural Volume Control ───

    // Web apps set HTMLMediaElement.volume linearly, but human hearing is
    // logarithmic. Override the volume property with a dB-linear curve so
    // site sliders produce perceptually uniform loudness steps.
    // Conversion functions from Discord's perceptual library (MIT):
    // https://github.com/discord/perceptual
    const VOLUME_DYNAMIC_RANGE_DB = 55;

    function perceptualToAmplitude(perceptual, normMax = 1) {
        if (perceptual <= 0) return 0;
        if (perceptual >= normMax) return normMax;
        const db = (perceptual / normMax) * VOLUME_DYNAMIC_RANGE_DB - VOLUME_DYNAMIC_RANGE_DB;
        return Math.min(normMax, Math.pow(10, db / 20) * normMax);
    }

    function amplitudeToPerceptual(amplitude, normMax = 1) {
        if (amplitude <= 0) return 0;
        if (amplitude >= normMax) return normMax;
        const db = 20 * Math.log10(amplitude / normMax);
        return Math.min(normMax, Math.max(0, (VOLUME_DYNAMIC_RANGE_DB + db) / VOLUME_DYNAMIC_RANGE_DB) * normMax);
    }

    let nativeVolumeDescriptor = null;
    let volumeOverrideActive = false;
    const volumeLockValue = isUserscript ? 'userscript' : 'static';

    function removeNaturalVolumeOverride() {
        if (!volumeOverrideActive) return;
        if (!nativeVolumeDescriptor) return;
        if (slots.playbackSpeedControlNaturalVolumeControl !== volumeLockValue) {
            console.error('playbackSpeedControlNaturalVolumeControl is gone');
            return;
        }
        Object.defineProperty(HTMLMediaElement.prototype, 'volume', nativeVolumeDescriptor);
        volumeOverrideActive = false;
        nativeVolumeDescriptor = null;
        delete slots.playbackSpeedControlNaturalVolumeControl;
        console_log('natural volume control removed');
    }

    // YouTube applies loudness normalization by capping video.volume below 1.0.
    // For videos inside a YouTube player, we read the normalization factor so
    // our curve anchors at the endpoints: 0→0, normMax→normMax.
    function getNormMaxYoutube(videoElem) {
        const player = videoElem.closest('#movie_player');
        if (!player || !player.getPlayerResponse) return 1;
        const loudnessDb = player.getPlayerResponse()?.playerConfig?.audioConfig?.loudnessDb;
        if (loudnessDb == null || loudnessDb <= 0) return 1;
        return Math.pow(10, -loudnessDb / 20);
    }

    function syncNaturalVolume() {
        if (!shouldActivateScript() || !settings.naturalVolume) {
            removeNaturalVolumeOverride();
            return;
        }
        // already active, either by us or by other instances
        if (slots.playbackSpeedControlNaturalVolumeControl || volumeOverrideActive) {
            return;
        }

        // start activate
        // set slots.playbackSpeedControlNaturalVolumeControl first so no other instance can active, should we fail in activate process
        slots.playbackSpeedControlNaturalVolumeControl = volumeLockValue;

        nativeVolumeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
        Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
            get() {
                const amplitude = nativeVolumeDescriptor.get.call(this);
                const normMax = getNormMaxYoutube(this);
                const perceptual = amplitudeToPerceptual(amplitude, normMax);
                console_log(`volume get: amplitude=${amplitude.toFixed(4)} → perceptual=${perceptual.toFixed(4)} (normMax=${normMax.toFixed(4)})`);
                return perceptual;
            },
            set(perceptual) {
                const normMax = getNormMaxYoutube(this);
                const amplitude = perceptualToAmplitude(perceptual, normMax);
                console_log(`volume set: perceptual=${perceptual.toFixed(4)} → amplitude=${amplitude.toFixed(4)} (normMax=${normMax.toFixed(4)})`);
                nativeVolumeDescriptor.set.call(this, amplitude);
            },
            configurable: true,
            enumerable: true,
        });

        // set volumeOverrideActive last so we don't attempt cleanup, should we fail in activate process
        volumeOverrideActive = true;
        console_log('natural volume control applied');

        // Read the value the site set (native, pre-override) and re-set it
        // through the override so the perceptual curve takes effect immediately
        const videoElem = document.querySelector("video");
        if (videoElem) {
            const siteVolume = nativeVolumeDescriptor.get.call(videoElem);
            videoElem.volume = siteVolume;
        }
    }

    // ─── Plex Module ───

    // crypto.randomUUID may be unavailable. Typically happens in non-HTTPS context.
    function generateInstanceId() {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    const instanceId = generateInstanceId();

    function addPlaybackButtonControls() {
        const btnStyle = `
            align-items: center;
            border-radius: 15px;
            display: flex;
            font-size: 18px;
            height: 30px;
            justify-content: center;
            margin-left: 5px;
            text-align: center;
            width: 30px;
        `;

        const containers = document.querySelectorAll('[class*="PlayerControls-buttonGroupRight"]');
        containers.forEach(container => {
            const existing = container.querySelector('#playback-speed-btn-slowdown');
            if (existing) {
                if (existing.dataset.playbackSpeedOwner === instanceId) {
                    return;
                }
                console_log('removing speed controls owned by', existing.dataset.playbackSpeedOwner);
                existing.remove();
                const existingSpeedUp = container.querySelector('#playback-speed-btn-speedup');
                if (existingSpeedUp) {
                    existingSpeedUp.remove();
                }
            }

            const btnSlowDown = document.createElement('button');
            btnSlowDown.id = 'playback-speed-btn-slowdown';
            btnSlowDown.dataset.playbackSpeedOwner = instanceId;
            btnSlowDown.style = btnStyle;
            btnSlowDown.innerHTML = '🐢';
            btnSlowDown.addEventListener('click', btnSlowdownFn);

            const btnSpeedUp = document.createElement('button');
            btnSpeedUp.id = 'playback-speed-btn-speedup';
            btnSpeedUp.dataset.playbackSpeedOwner = instanceId;
            btnSpeedUp.style = btnStyle;
            btnSpeedUp.innerHTML = '🐇';
            btnSpeedUp.addEventListener('click', btnSpeedUpFn);

            console_log('adding speed controls to', container);
            container.prepend(btnSlowDown, btnSpeedUp);
        })
    }

    // Toggling speed control off mid-session leaves our buttons on screen with
    // nothing behind them, so drop the ones this instance owns.
    function removePlaybackButtonControls() {
        for (const btn of document.querySelectorAll(`[data-playback-speed-owner="${instanceId}"]`)) {
            btn.remove();
        }
    }

    let lastAutoPlayedBtn = null;
    function autoPlayNext() {
        if (!shouldActivateScript() || !settings.plexSkipAutoPlayCountdown) {
            return;
        }
        const checkbox = document.querySelector('input#autoPlayCheck');
        if (!checkbox || !checkbox.checked) return;

        const playNextBtn = document.querySelector('button[aria-label="Play Next"]');
        if (!playNextBtn || playNextBtn === lastAutoPlayedBtn) return;

        console_log('auto-clicking Play Next');
        lastAutoPlayedBtn = playNextBtn;
        // Plex UI listens on pointer/mouse events and ignores .click() alone
        playNextBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
        playNextBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
        playNextBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
        playNextBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
        playNextBtn.click();
    }

    function plexLoopTick() {
        syncNaturalVolume();
        syncVideoSpeed();
        if (shouldActivateScript({ requireVideo: true }) && settings.playbackSpeed) {
            addPlaybackButtonControls();
        } else {
            removePlaybackButtonControls();
        }
        autoPlayNext();
    }

    // ─── Generic Site Module ───

    function genericLoopTick() {
        syncNaturalVolume();
        syncVideoSpeed();
    }

    // ─── Main Loop ───

    // AbortController lets the non-userscript instance remove its keyboard
    // listener cleanly when a userscript instance takes over.
    const abortController = new AbortController();

    function scheduleLoopFrame() {
        setTimeout(() => {
            requestAnimationFrame(() => {
                // Non-userscript self-teardown: if a userscript appeared, stop.
                // Restore prototype before releasing the lock so the
                // userscript captures the true native descriptor.
                if (!isUserscript && slots.playbackSpeedControlUserscript) {
                    console_log('userscript instance detected, tearing down');
                    removeNaturalVolumeOverride();
                    abortController.abort();
                    return;
                }

                registerMenuCommands();
                if (isPlex) {
                    plexLoopTick();
                } else {
                    genericLoopTick();
                }
                scheduleLoopFrame();
            });
        }, 500);
    }

    // ─── Registration ───

    console_log(`registering (${isUserscript ? 'as userscript' : 'static script'}, site: ${normalizedOrigin})`);
    // Capture phase so our handler intercepts events before other handlers
    // https://www.quirksmode.org/js/events_order.html#link4
    // Registered unconditionally; keyboardUpdateSpeed checks the setting so
    // toggling speed control from the menu takes effect without a reload.
    window.addEventListener("keydown", keyboardUpdateSpeed, { capture: true, signal: abortController.signal });
    scheduleLoopFrame();
})();
