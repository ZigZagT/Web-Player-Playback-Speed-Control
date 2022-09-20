# Plex Web Player Speed Control Widgets and Keyboard Shortcuts

## Install with Desktop Chrome
1. Install [Tampermonkey][2] or any equivalent for your browser;
2. Open [this link][1] in Chrome, and the Tampermonkey plugin should automatically prompt for installation.
3. Once installed, future script updates can be done via the Tampermonkey check for updates function


## Install Safari (applies to both macOS Desktop and iOS/iPadOS Safari)
1. Install the [Userscripts][3] Safari extension from App Store.
2. Enable the extension following its instruction. Make sure you have the `Save Location` setting configured.
3. Open [this link][1] in Safari, and save the file to the `Save Location` of your choice.
4. Once installed, future script updates can be done via the Userscripts check for updates function.

[1]: https://gist.githubusercontent.com/ZigZagT/b992bda82b5f7a2c9d214110273d3f3c/raw/Plex%2520Playback%2520Speed.user.js
[2]: https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en
[3]: https://itunes.apple.com/us/app/userscripts/id1463298887

## Usage

1. Use the turtle and rabbit icons in the control strip to slowdown / speedup

<img width="398" alt="Screen Shot 2022-09-19 at 9 24 10 PM" src="https://user-images.githubusercontent.com/7879714/191167267-9430ec1f-2815-49cf-8904-b5aa73809ef9.png">

2. Use `<` or `>` keys on the keyboard to decrease / increase speeds.

3. Use number keys (1-9) to quickly choose from a preset speeds.

## Troubleshoot

### The web player is laggy, sometime stuck

Try disable the `Direct Play` option and leave `Direct Stream` enabled in the `Plex Web - Debug` settings.

<img width="228" alt="image" src="https://user-images.githubusercontent.com/7879714/191168287-d1b7a12a-6aa2-4d49-afba-8cf32271f670.png">

