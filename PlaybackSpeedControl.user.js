// ==UserScript==
// @name         Playback Speed Control
// @namespace    https://github.com/ZigZagT
// @version      2.0.1
// @downloadURL  https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js
// @updateURL    https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js
// @description  Add playback speed controls to web players with keyboard shortcuts
// @author       ZigZagT
// @include      /^https?://[^/]*plex[^/]*/
// @include      /^https?://[^/]*:32400/
// @include      *://app.plex.tv/**
// @include      *://plex.tv/**
// @include      *://*.youtube.com/**
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

    let settings = {
        enablePlex: getSetting('enablePlex', true),
        enableYouTube: getSetting('enableYouTube', true),
        plexSkipAutoPlayCountdown: getSetting('plexSkipAutoPlayCountdown', true),
    };

    // Non-userscript: only Plex features, no YouTube
    if (!isUserscript && !isPlex) {
        console_log('non-userscript mode only supports Plex, bailing');
        return;
    }

    const siteEnabled = (isPlex && settings.enablePlex) || (isYouTube && settings.enableYouTube);
    if (!siteEnabled) {
        console_log('site not enabled, bailing');
        return;
    }

    // ─── Menu Commands (userscript only, scoped to current site) ───

    const menuToggles = [];
    if (isPlex) {
        menuToggles.push(
            { key: 'enablePlex', labelOn: 'Plex: Enabled \u2713', labelOff: 'Plex: Disabled \u2717' },
            { key: 'plexSkipAutoPlayCountdown', labelOn: 'Skip Auto Play Countdown: Enabled \u2713', labelOff: 'Skip Auto Play Countdown: Disabled \u2717' },
        );
    }
    if (isYouTube) {
        menuToggles.push(
            { key: 'enableYouTube', labelOn: 'YouTube: Enabled \u2713', labelOff: 'YouTube: Disabled \u2717' },
        );
    }

    function registerMenuCommands() {
        if (!isUserscript) return;

        for (const toggle of menuToggles) {
            if (toggle.cmdId !== undefined) {
                GM_unregisterMenuCommand(toggle.cmdId);
            }
            const label = settings[toggle.key] ? toggle.labelOn : toggle.labelOff;
            toggle.cmdId = GM_registerMenuCommand(label, () => {
                settings[toggle.key] = !settings[toggle.key];
                setSetting(toggle.key, settings[toggle.key]);
                registerMenuCommands();
                const state = settings[toggle.key] ? 'ENABLED' : 'DISABLED';
                if (confirm(`${toggle.key} is now ${state}. Reload page to apply changes?`)) {
                    window.location.reload();
                }
            });
        }
    }

    registerMenuCommands();

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
        const videoElem = document.querySelector("video");
        if (videoElem == null) {
            return;
        }
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
        let newSpeed = getNextCycleSpeed('speedup', currentSpeed);
        console_log('change speed to', newSpeed);
        setVideoSpeed(newSpeed);
        prompt(`Speed: ${newSpeed}x`);
    }

    function btnSlowdownFn() {
        let newSpeed = getNextCycleSpeed('slowdown', currentSpeed);
        console_log('change speed to', newSpeed);
        setVideoSpeed(newSpeed);
        prompt(`Speed: ${newSpeed}x`);
    }

    // ─── Plex Module ───

    const instanceId = crypto.randomUUID();

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

    let lastAutoPlayedBtn = null;
    function autoPlayNext() {
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
        syncVideoSpeed();
        addPlaybackButtonControls();
        if (settings.plexSkipAutoPlayCountdown) {
            autoPlayNext();
        }
    }

    // ─── YouTube Module ───

    function youtubeLoopTick() {
        syncVideoSpeed();
    }

    // ─── Main Loop ───

    // AbortController lets the non-userscript instance remove its keyboard
    // listener cleanly when a userscript instance takes over.
    const abortController = new AbortController();

    function scheduleLoopFrame() {
        setTimeout(() => {
            requestAnimationFrame(() => {
                // Non-userscript self-teardown: if a userscript appeared, stop
                if (!isUserscript && slots.playbackSpeedControlUserscript) {
                    console_log('userscript instance detected, tearing down');
                    abortController.abort();
                    return;
                }

                if (isPlex) {
                    plexLoopTick();
                } else if (isYouTube) {
                    youtubeLoopTick();
                }
                scheduleLoopFrame();
            });
        }, 500);
    }

    // ─── Registration ───

    console_log(`registering (${isUserscript ? 'as userscript' : 'static script'}, site: ${isPlex ? 'plex' : isYouTube ? 'youtube' : 'unknown'})`);
    // Capture phase so our handler intercepts events before other handlers
    // https://www.quirksmode.org/js/events_order.html#link4
    window.addEventListener("keydown", keyboardUpdateSpeed, { capture: true, signal: abortController.signal });
    scheduleLoopFrame();
})();
