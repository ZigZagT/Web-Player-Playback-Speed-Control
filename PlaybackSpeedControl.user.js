// ==UserScript==
// @name         Playback Speed Control
// @namespace    https://github.com/ZigZagT
// @version      1.7.2
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

    const isYouTube = window.location.hostname.includes('youtube.com');
    let enableYouTube = true;

    if (typeof GM_registerMenuCommand === 'undefined' || typeof GM_unregisterMenuCommand === 'undefined' || typeof GM_getValue === 'undefined' || typeof GM_setValue === 'undefined') {
        console_log('Userscript API is not available, skipping registering menu command');
    } else if (isYouTube) {
        enableYouTube = GM_getValue('enableYouTube', true);

        let menuCmdId = null;
        const updateMenuCommand = () => {
            if (menuCmdId !== null) {
                GM_unregisterMenuCommand(menuCmdId);
            }
            menuCmdId = GM_registerMenuCommand(
                enableYouTube ? 'Disable YouTube Support' : 'Enable YouTube Support',
                () => {
                    enableYouTube = !enableYouTube;
                    GM_setValue('enableYouTube', enableYouTube);
                    updateMenuCommand();

                    if (isYouTube) {
                        if (confirm(`YouTube support is now ${enableYouTube ? 'ENABLED' : 'DISABLED'}. Reload page to apply changes?`)) {
                            window.location.reload();
                        }
                    } else {
                         alert(`YouTube support is now ${enableYouTube ? 'ENABLED' : 'DISABLED'}.\n(Reload YouTube tabs to apply)`);
                    }
                }
            );
        };
        updateMenuCommand();
    }

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
        // Ignore if user is typing in an input field
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

    function addPlaybackButtonControls() {
        if (isYouTube) {
             return;
        }

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
            if (container.querySelector('#playback-speed-btn-slowdown')) {
                return;
            }

            const btnSlowDown = document.createElement('button');
            btnSlowDown.id = 'playback-speed-btn-slowdown';
            btnSlowDown.style = btnStyle;
            btnSlowDown.innerHTML = '🐢';
            btnSlowDown.addEventListener('click', btnSlowdownFn);

            const btnSpeedUp = document.createElement('button');
            btnSpeedUp.id = 'playback-speed-btn-speedup';
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

    function scheduleLoopFrame() {
        setTimeout(() => {
            requestAnimationFrame(() => {
                syncVideoSpeed();
                addPlaybackButtonControls();
                autoPlayNext();
                scheduleLoopFrame();
            });
        }, 500);
    }

    if (isYouTube && !enableYouTube) {
        console_log('not enabling YouTube playback speed controls');
    } else if (window.__playback_speed_control_registered__) {
        console_log('playback speed controls are already registered');
    } else {
        window.__playback_speed_control_registered__ = true;
        console_log('registering playback speed controls');
        // Use capture phase so our handler intercepts the events before other handlers
        // https://www.quirksmode.org/js/events_order.html#link4
        window.addEventListener("keydown", keyboardUpdateSpeed, true);
        scheduleLoopFrame();
    }
})();
