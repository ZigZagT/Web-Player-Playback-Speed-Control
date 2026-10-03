# Web Player Playback Speed Control

[GitHub](https://github.com/ZigZagT/Web-Player-Playback-Speed-Control) · [Greasy Fork](https://greasyfork.org/en/scripts/451667)

A userscript that adds playback-speed controls, perceptual volume control, and Chrome Document Picture-in-Picture (PiP) to web video players.


## Supported sites & features

| Feature                                | Plex               | YouTube            | Any other site            |
| -------------------------------------- | :----------------: | :----------------: | :-----------------------: |
| Playback speed — keyboard              | ✅ (on by default)  | ✅ (on by default)  | ✅ (opt-in per origin)     |
| Playback speed — page buttons          | ✅ (on by default)  | —                  | —                         |
| Playback speed — PiP menu              | ✅                  | ✅                  | ✅ (when enabled)          |
| Natural Volume Control                 | ✅ (on by default)  | ✅ (on by default)  | ✅ (opt-in per origin)     |
| PiP player integration                 | ✅ (on by default)  | ✅ (on by default)  | ✅ (opt-in per origin)     |
| Skip Auto-Play countdown               | ✅ (on by default)  | —                  | —                         |

When installed through a userscript manager, each feature can be enabled or disabled for the current site from the Userscript menu.


## Features

### Playback speed control

You can change playback speed in three ways:

1. **On-screen controls** — the turtle and rabbit buttons in Plex's control bar decrease or increase speed by one step. In PiP, the standard [Media Chrome playback-rate menu](https://www.media-chrome.org/docs/en/components/media-playback-rate-menu) lets you choose a slower or faster speed directly. Opening the menu does not change playback speed.

   <img width="398" alt="Plex control strip with turtle and rabbit speed buttons" src="https://user-images.githubusercontent.com/7879714/191167267-9430ec1f-2815-49cf-8904-b5aa73809ef9.png">

2. **Cycle keys** — `<` or `,` slow down by one step; `>` or `.` speed up by one step. The cycle list is:
    - 0.5, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3, 5, 4, 5, 6, 7, 8, 9, 10, 15, 20

3. **Quick-set keys** — number keys 1–9 jump directly to a preset speed:

| `number key` | `mapped to speed` |
| ------------ | ----------------- |
| 1            | 1                 |
| 2            | 1.5               |
| 3            | 2                 |
| 4            | 3                 |
| 5            | 4                 |
| 6            | 5                 |
| 7            | 7                 |
| 8            | 8                 |
| 9            | 10                |

Keyboard shortcuts are ignored while typing in input fields, textareas, or contenteditable elements.

Speed shortcuts and on-screen buttons require a video to control. Each embedded frame runs its own copy of the script; a video in one frame does not enable controls in another.

Speed control is enabled by default on Plex and YouTube. Turn it off from the Userscript menu using **Playback Speed (plex)** or **Playback Speed (youtube)**. On other sites, it remains off until you enable it for that site—see [Any other site](#any-other-site). While enabled, the script maintains your selected speed and overrides changes made by the site's own speed selector.

### Natural Volume Control

Most web players, including Plex and YouTube, map their volume sliders linearly to `HTMLMediaElement.volume`. Human hearing responds logarithmically, so equal slider movements do not produce equal changes in perceived loudness. This script uses a decibel-linear mapping to make the slider feel more consistent—the same approach Discord uses for its volume controls.

Design notes and references: [`designs/natural-volume-control.md`](designs/natural-volume-control.md).

### Picture-in-Picture

**Chrome only, in userscript mode.** Turn on **`Enable for PiP (<site>)`** to use this script's floating player. The setting is enabled by default on Plex and YouTube and disabled elsewhere. If you previously turned it off, it stays off. This setting chooses the player; Chrome's permission to open it automatically is separate.

Open the player through Chrome's media controls, or let Chrome open it automatically when permitted. The floating window uses [Media Chrome](https://www.media-chrome.org/docs/en/get-started) for play/pause, seeking, mute, volume, playback time, and captions exposed by the video element. The original video element and stream are retained. The site's own controls, quality menus, and caption overlays stay in the tab.

The captions button toggles caption or subtitle tracks exposed through the video's `textTracks`. It does not control subtitles rendered by the site's interface or burned into the video. The button is hidden when no caption or subtitle tracks are available and appears when Media Chrome reports them. Turning captions off does not hide the button.

**Speed and volume:** the rate menu combines the script's cycle and quick-set values, from 0.5× to 20×. You can select any listed speed directly. Keyboard shortcuts and Natural Volume also work in the floating window, including YouTube's volume normalization. Disabling Playback Speed closes and disables the rate menu without affecting the other controls. A compact readout at the top-left shows the actual playback speed and updates when it changes. It shares Media Chrome's control-bar visibility and auto-hide behavior rather than using a separate notification timer. The original page retains its existing temporary overlay outside PiP.

**Responsive controls:** below Media Chrome's standard medium breakpoint of 576 pixels, seeking and playback time occupy a separate row above the action buttons and volume slider. At 576 pixels and wider, all controls share one row, with the timeline between volume and speed selection. Narrow windows use tighter spacing and a shorter volume slider. The same control elements are retained as the window changes size; volume, seeking, speed selection and available captions remain accessible.

**Window size:** when the window opens, the script starts with the video's natural dimensions. It reduces them proportionally to fit within half the available screen width and half its height, without enlarging smaller videos. For example, a 1920×1080 video on a 1920×1080 available screen requests a 960×540 window content area. Playing another video or changing resolution does not resize an open window.

Click the **Fit video** resize icon (diagonal arrows) in the control bar to apply the same sizing rule to the current video and screen—for example, after Plex advances to a queued video. Its tooltip and accessible label identify the action as **Resize window to current video**. You can also focus the button and press Enter or Space. Fit remains available when Playback Speed is disabled and resizes the window without cropping, stretching, or restarting the video. The script does not automatically adjust the window when you resize it manually.

Chrome can round or constrain the requested size. It also controls the title bar, which the script cannot hide: the [specification requires the controlling origin to remain identifiable](https://wicg.github.io/document-picture-in-picture/#origin-visibility). The [`disallowReturnToOpener` option](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/#hide-the-back-to-tab-button-in-pip-window) hides only the back-to-tab button, so the script retains that useful navigation control.

Closing PiP or disabling the integration returns the video to its original container and restores its controls and attributes. If the page has removed that container, the script stops the old video rather than inserting it into the replacement page. Embedded frames cannot open a Document PiP window themselves. Disabling the integration does not disable Chrome's native PiP features.

PiP requires a userscript manager with `GM_addElement` and `GM_getResourceText`, such as Tampermonkey. If the player libraries fail to load, the video stays in its original page and the console reports the error.

#### Chrome's automatic-entry permission

These instructions also appear when you turn on **Enable for PiP** in the userscript menu. Sites where the setting is enabled by default do not show a startup prompt.

Chrome may initially show **Automatic picture-in-picture: On (can ask)**. In that state, Chrome can consider how often you watch media on the site before allowing automatic entry. To grant permission explicitly:

1. On the playing site's tab, open Chrome's **site controls** icon beside the address bar.
2. Find **Automatic picture-in-picture**. If it says **On (can ask)**, turn it **Off**, then **On**.
3. Verify that it now says **On (allowed)**, then switch to another tab while a video is playing with sound.

If Chrome shows a permissions dropdown instead, choose **Allow** for Automatic picture-in-picture. Set this permission for the address you use to play the video. Different Plex hostnames or ports can have separate Chrome permissions even though the script groups their settings under `plex`. You must change the browser permission yourself; the script does not change it or request camera or microphone access. Granting permission removes the media-engagement check, but Chrome's other requirements still apply.

**Chrome decides when automatic entry is allowed.** A window that opens automatically closes when you return to the original tab. A window you open manually does not follow that automatic-close behavior.

Chrome may show its own permission prompt before allowing you to interact with an automatically opened player. Chrome controls that prompt, not the userscript or the controls library.

Automatic entry requires a top-level page served over HTTPS or `file:`, a site address Chrome considers safe, a registered handler, and no conflicting PiP window. The media must be playing, have been audible recently, and have audio focus. When the permission is set to **Ask**, Chrome also checks the site's media engagement. Choosing **Allow** removes only that check. Even though `http://localhost` is a secure context, it does **not** meet Chrome's protocol requirement for automatic entry.

Covering or minimizing the browser is not the same as switching tabs. Chrome handles those conditions separately. Listening for `visibilitychange` cannot bypass Chrome's permission checks.

References: [Chrome's Document Picture-in-Picture example](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/), [automatic media-playback Picture-in-Picture](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback), and [DevTools Media panel](https://developer.chrome.com/docs/devtools/media-panel).

### Userscript menu

The Userscript menu labels each feature with the site its setting applies to, such as `Playback Speed (plex)`, `Natural Volume (youtube)`, or `Natural Volume (example.com)`. All recognized Plex addresses share the `plex` settings scope, and all recognized YouTube addresses share `youtube`. Other sites use their normalized hostname and port, so settings for one address do not affect another.

YouTube recognition is limited to `youtube.com` and its subdomains; an unrelated hostname that merely contains that text does not receive YouTube's defaults.

The script activates when it has a video to control or saved settings for the current site. A video moved into the script's PiP window remains available to the original frame. Built-in defaults and settings saved for other sites do not count as saved settings for this frame.

Activation decisions and their reasons are logged to the browser console when they change.

Toggles take effect immediately, with no page reload. Settings persist across sessions.

Saved settings are loaded once when the script starts. An explicit menu action updates the local application settings and saves the new value. Changes made in another tab or frame take effect after reloading; there are no settings listeners or polling. A menu callback always applies the action represented by its displayed entry, so repeating that callback cannot toggle the value back.

Menu entries retain their IDs when the manager supports in-place updates. Only entries whose labels changed are updated. If a menu operation fails, the console reports it and a later polling cycle retries it without rebuilding entries that already succeeded. A failed preference write leaves the current setting unchanged.


## Sites

### Plex

This script predates [Plex's own playback-speed support, announced on May 15 2024](https://forums.plex.tv/t/video-playback-speed-controls/877681), and still offers a few things Plex's native controls don't.

#### Comparison with native Plex clients

|                                             |                                                                                     This Script                                                                                     |                       Native Plex                        |
| ------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------: |
| More speed options to choose from           | ✅ <br> (cycle through with `,.<>` keys: 0.5, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3, 5, 4, 5, 6, 7, 8, 9, 10, 15, 20 <br> hot key with number keys: 1, 1.5, 2, 3, 4, 5, 7, 8, 10) | ❌ <br> (0.5x, 0.75x, Normal, 1.25x, 1.5x, 1.75x, and 2x) |
| Keyboard shortcuts                          |                                        ✅ <br> (cycle through with `,.<>` keys or hot key with number keys, on top of mouse clicking buttons)                                        |               ❌ <br> (mouse clicking only)               |
| Does not require Plex Pass                  |                                                                                          ✅                                                                                          |                            ❌                             |
| Supports browser clients, including iOS devices |                                                                                      ✅                                                                                          |                            ✅                             |
| Supports non-browser clients                |                                                                                          ❌                                                                                          |                            ✅                             |
| Perceptual (dB-linear) volume slider        |                                                                                          ✅                                                                                          |                            ❌                             |
| Auto-skip "Play Next" countdown             |                                                                                          ✅                                                                                          |                            ❌                             |

#### Skip Auto-Play countdown

When Plex shows the auto-play countdown at the end of an episode, the script auto-clicks "Play Next" if Plex's own auto-play checkbox is on. Toggle from the Userscript menu: "Skip Auto Play Countdown: Enabled / Disabled".

### YouTube

YouTube limits `video.volume` below 1.0 for loud videos. Natural Volume reads that limit from the player's `loudnessDb` value and adjusts its curve accordingly. The slider still reaches the maximum volume YouTube allows, without reducing the volume a second time.

Playback speed on YouTube uses the same keyboard bindings as Plex; buttons are not injected into YouTube's page controls to avoid clashing with its own speed UI. The separate PiP player includes the script's speed controls.

### Any other site

Playback Speed Control, Natural Volume Control and PiP integration can be enabled on other sites from the Userscript menu — look for `Playback Speed (<origin>)`, `Natural Volume (<origin>)` and `Enable for PiP (<origin>)`. Each setting is stored per-origin, so enabling one on a site does not affect another. A warning appears whenever you enable a feature on an untested site; if you hit problems, disable it from the same menu.

On other sites, speed control uses the same keyboard shortcuts as Plex, including number keys `1`–`9`. It handles these keys before the page does, so it can override the site's own shortcuts. Buttons are added to the page only on Plex. PiP speed controls are available on any site where both **Playback Speed** and **Enable for PiP** are enabled.


## Runtime modes

The script runs in two modes:

- **Userscript** — runs through a userscript manager, saves settings, and provides menu toggles. All features are available on supported browsers and sites.
- **Static script** — loaded from Plex's `index.html`. It provides Plex speed, volume, and countdown features with fixed defaults and no settings menu. PiP remains disabled because it needs the userscript manager's resource loader. If a userscript instance starts on the same page, the static instance stops automatically.


## Development

Follow [STYLING_GUIDE.md](STYLING_GUIDE.md) for formatting, naming, and the separation between application settings, preference storage, and menu presentation.

The installed userscript needs no build step or npm installation. Its manager supplies the two pinned libraries declared in the header. `package.json` is used only for testing. Run the tests inside the development container using Node's built-in test runner, with Node 18 or newer:

```bash
npm test          # or: node --test "test/*.test.js"
```

`test/harness.js` provides the globals the script needs: a simplified document model, `GM_*` storage and menu functions, Media Session and Document Picture-in-Picture interfaces, and timers. It then evaluates `PlaybackSpeedControl.user.js`. Timers are simulated, so tests advance the 500 ms polling loop with `env.tick()` rather than waiting in real time.

The Picture-in-Picture tests cover initial sizing, the quarter-screen limit, explicit fitting after video or screen changes, mouse and keyboard activation, resize failures, and controls retained from closed sessions. They also cover diagnostic output, handler registration, library-loading failures and timeouts, concurrent opening requests, cancellation, restoration, and volume normalization. Rate-control tests verify that the script preserves the library's applied rate, respects settings, and removes its listeners during cleanup. These tests use simulated browser and library interfaces; they do not verify rendered layout or compatibility with live sites.

### Picture-in-Picture implementation

The userscript manager loads pinned copies of Media Chrome **4.19.2** and DOMPurify **3.4.16** into the PiP document and verifies their integrity hashes. Where Trusted Types is supported, the script installs a DOMPurify-backed default policy before Media Chrome runs, unless a default policy already exists. It leaves the opener's policy unchanged. Media Chrome handles the playback controls, their styling, and playback-rate requests. The userscript supplies the original media element, the available speed values, and the Fit button's action.

The layout uses Media Chrome's [control-bar and top slots](https://www.media-chrome.org/docs/en/position-controls). Its [documented display, sizing properties and breakpoint attributes](https://www.media-chrome.org/docs/en/styling) switch the bottom controls between a compact two-row grid and a single flex row. The timeline remains a nested group within the same control bar, so resizing does not recreate controls or change their state. The Fit button uses [diagonal resize arrows](https://github.com/tabler/tabler-icons/blob/main/icons/outline/arrows-diagonal.svg) inside Media Chrome's generic button, rather than a fullscreen symbol. The icon is embedded in the userscript with its license notice; no additional library is loaded.

The speed readout uses `media-text-display` in `top-chrome`. The script updates its text from the actual media rate, including keyboard, menu and native `ratechange` events. Media Chrome controls when it appears and hides; a rate change outside the floating player does not force hidden controls to appear. The script does not create another hide timer, send artificial pointer events or alter the controller's inactivity state.

Opening the PiP window and clicking Fit use the same calculation, based on the video's natural dimensions and the available screen area. Fit passes an absolute outer-window size to [`resizeTo()`](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/#resize-the-pip-window). On the first Fit action, the script compares the reported outer and inner sizes to estimate the space used by the title bar and borders. It reuses this frame allowance for later clicks, manual resizes, and queued videos. If the available screen dimensions or device pixel ratio change, the next Fit action calculates a new allowance. Each new PiP window starts with its own allowance. This prevents rounded viewport measurements from changing subsequent requests, though Chrome still determines the final window geometry.

The [Document PiP interface](https://wicg.github.io/document-picture-in-picture/#api) has no native aspect-ratio lock. Resizing from JavaScript [requires and consumes user activation](https://wicg.github.io/document-picture-in-picture/#resizing-the-pip-window), such as a click inside the page. Playback and resize events do not grant that activation, so the script does not resize the window automatically.

The setting is stored under `pictureInPicture:<site>`. When the feature is enabled and a video is available, the script registers a Media Session `enterpictureinpicture` handler. Manual and automatic entry use the same opening function. The script records the site's handler registrations so it can restore the latest observed handler when disabled. It also registers its own handler on each polling cycle. If the site bypasses the observer by calling a previously saved browser method, the next cycle restores the script's registration; this recovery is not immediate.

### Picture-in-Picture diagnostics

The **`PiPLayout log fields`** guide appears once at startup in a collapsed console group. The guide and snapshots use two-column tables with field or event names as row labels; Chrome calls that column `(index)`. Snapshots show the requested sizes, the sizes reported by the browser, the video dimensions and position, scrollbar space, overflow, picture-fitting mode, and device pixel ratio. The requested outer size is `-` before Fit is used. During a resize, the reported outer size can be Chrome's pending request rather than the final window size.

Each heading includes a timestamp and elapsed milliseconds. The **`setup-timer`** snapshot defines **`T+0ms`** for that window. Events that occurred earlier keep their original measurements and appear with negative offsets once the start time is known. If the window closes before that timer runs, the log shows `T unavailable`. **`one-second-timer`** is a scheduled snapshot, not proof that the window size has stopped changing. Snapshots do not resize the window or include media addresses, page titles, or raw inline styles. They cannot detect black bars encoded into the video.

Changes to handler registration and errors during window creation, library loading, or restoration are logged separately. Chrome's [Media panel](https://developer.chrome.com/docs/devtools/media-panel) reports automatic-entry conditions in `kAutoPictureInPictureInfoChanged` / `auto_picture_in_picture_info`. `reason: "BrowserInitiated"` identifies Chrome's native video-only mode. Automatic entry through the page handler uses `reason: "MediaPlayback"` with `enterPictureInPictureReason: "contentoccluded"`. The userscript does not infer these browser-controlled conditions.

## Maintenance constraints

Keep `settings` as the sole applied application state. Load saved overrides once at startup and persist explicit local changes. Menus display the applied values; they do not load or own them. Application consumers must not depend on menu registration or read persistence directly. Do not add settings synchronization mechanisms. See [STYLING_GUIDE.md](STYLING_GUIDE.md) for the function contracts and formatting rules.

Use Media Chrome's documented components and configuration for the player interface. Keep built-in control state and auto-hide behavior in the library, and supply application-specific content through its supported slots. Before changing sizing or styles, establish the cause of the problem from measurements taken in the affected player. The connected shared browser is for research, not testing; run repository tests separately.


## How to install

### Automated Install and Update in Plex Server

Use this option if you access the Plex web client hosted by your server from several devices or browser profiles. It runs the script in **static-script mode**, with Plex features only and no settings menu. Also install it through a userscript manager if you need YouTube support or per-feature settings.

The following steps assume your Plex server uses the `linuxserver/plex` Docker image. Other deployments may require different paths or startup-script configuration.

To automate installation and updates:

1. Create a shell script on the server host. Mount it in the Plex container so it runs at startup.

```bash
# inject_PlaybackSpeedControl.sh
cd /usr/lib/plexmediaserver/Resources/Plug-ins-*/WebClient.bundle/Contents/Resources
wget -O "js/PlaybackSpeedControl.js" "https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js"
sed -i 's#</head>#<script src="/web/js/PlaybackSpeedControl.js"></script></head>#' index.html
```

2. Add execution permission to `inject_PlaybackSpeedControl.sh`.

```bash
chmod a+x inject_PlaybackSpeedControl.sh
```

3. Mount `inject_PlaybackSpeedControl.sh` in the container's startup-script directory:

```yaml
# docker-compose.yaml
services:
  plex:
    image: linuxserver/plex
    tmpfs:
      - /tmp
    volumes:
      # ... other volumes ...
      - /path/to/inject_PlaybackSpeedControl.sh:/etc/cont-init.d/99-inject_PlaybackSpeedControl.sh
    devices:
      - /dev/dri:/dev/dri
    restart: always
```

The startup script downloads the latest userscript whenever the Plex server restarts.


### Manual Install in Plex Server

To perform the same installation manually:

1. Locate the WebClient directory in your Plex Server installation. Its location depends on your server setup. For example, the [linuxserver.io Plex image](https://docs.linuxserver.io/images/docker-plex) at version `linuxserver/plex:1.40.0` stores the WebClient bundle at `/usr/lib/plexmediaserver/Resources/Plug-ins-c29d4c0c8/WebClient.bundle/Contents/Resources`.
2. Save the `PlaybackSpeedControl.user.js` file into the `js` folder.
3. Rename the file to `PlaybackSpeedControl.js`, removing `.user` from its extension. Otherwise, some userscript extensions may intercept the request and treat it as an installation.
4. Edit `index.html` and add a script tag that points to the file. Prefix the path with `/web`. For example, a file stored at `js/PlaybackSpeedControl.js` needs `<script src="/web/js/PlaybackSpeedControl.js"></script>`.

The script will not update automatically with this installation.


### Install as userscript in Desktop Chrome / Firefox

Playback Speed and Natural Volume work on all supported sites. Document Picture-in-Picture requires Chrome and a manager with the resource APIs described above.

1. Install [Tampermonkey](https://chrome.google.com/webstore/detail/Userscript/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en) or a compatible userscript manager in your browser.
2. Open [the userscript](https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js). The manager should prompt you to install it.
3. Your userscript manager can check for future updates and install them automatically.


### Install as userscript in Safari (macOS Desktop or iOS/iPadOS Safari)

Playback Speed and Natural Volume work on supported sites. Document Picture-in-Picture is not available in Safari.

1. Install the [Userscripts](https://itunes.apple.com/us/app/userscripts/id1463298887) Safari extension from the App Store.
2. Follow the extension's instructions to enable it and configure its **Save Location**.
3. Open [the userscript](https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js) in Safari and save it to that location.
4. The Userscripts app can check for future updates and install them automatically.
