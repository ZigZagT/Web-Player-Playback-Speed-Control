# Styling and architecture guide

These rules apply to changes in this repository. Preserve existing behavior, useful comments, and public names unless the task explicitly changes them.

## Formatting

Use four spaces for indentation.

### Object literals

Use either **one property per line** or **all properties on one line**. Do not pack some properties together while placing others on separate lines.

For a single-line object, put both braces and all properties on that line:

```js
const size = { width: 832, height: 468 };
```

For a multiline object, keep properties off the opening and closing brace lines:

```js
const menuEntry = {
    key: 'playbackSpeed',
    labelOn: 'Playback Speed: Enabled',
    labelOff: 'Playback Speed: Disabled',
};
```

The same rule applies to nested objects, returned objects, shorthand properties, and objects inside arrays:

```js
const menuEntries = [
    {
        key: 'playbackSpeed',
        labelOn: 'Playback Speed: Enabled',
        labelOff: 'Playback Speed: Disabled',
    },
    {
        key: 'naturalVolume',
        labelOn: 'Natural Volume: Enabled',
        labelOff: 'Natural Volume: Disabled',
    },
];
```

Do not use partially packed objects:

```js
// Incorrect: properties share the opening line and use an inconsistent layout.
const menuEntry = { key: 'playbackSpeed', labelOn: 'Playback Speed: Enabled',
    labelOff: 'Playback Speed: Disabled' };
```

### Line breaks

There is no maximum line width. **Never break a line solely because it is long.**

Use line breaks when the content has a meaningful boundary, such as an object property, a statement in a block, or a complete sentence in a comment or message. Do not split a condition, function call, or sentence merely to fit a column limit.

Keep ordinary expressions together:

```js
const isYouTube = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
```

When a comment contains several sentences, each sentence may start on a new line:

```js
// The requested size is a target, not a measurement.
// Chrome can round or constrain the final window dimensions.
```

Do not wrap that first sentence halfway through just to shorten the line. Preserve third-party license notices.

### Language and comments

Use clear, grammatical English with an explicit subject and a precise description of the effect.

Comments should explain constraints, ownership, or a non-obvious reason for the code. Do not merely repeat the statements below them. Keep relevant documentation links with the code they explain.

Distinguish facts from requests and assumptions. For example, a requested window size is not the same as a measured size, and a simulated browser response is not evidence of actual browser behavior.

## Application settings are the source of truth

`settings` is a plain object containing the values currently applied to the application. Declare those values directly so a reader can see the available settings and their defaults.

```js
const settings = {
    plexSkipAutoPlayCountdown: true,
    playbackSpeed: isKnownSite,
    naturalVolume: isKnownSite,
    pictureInPicture: isKnownSite,
};
```

Do not put storage keys, menu labels, command IDs, or userscript API calls in this object. Do not turn it into a proxy or hide persistence behind property access.

Keep the object reference stable. Application code reads `settings`; updates change its values rather than replacing the object with a storage response.

Read saved preferences once at startup and apply them over the declared defaults. After that, storage is only a persistence destination for explicit local changes, not a live source of application state.

### Keep responsibilities separate

| Responsibility | Owns | Must not do |
|---|---|---|
| Application settings | Applied values and the application effects of changing them | Read storage, register menus, or depend on menu metadata |
| Preference storage | Storage keys, legacy-key fallbacks, reads, and writes | Apply playback changes or register menus |
| Menu presentation | Labels, warnings, callbacks representing user intent, and successful command registrations | Load preferences or apply playback changes |
| Setting changes | Persistence-before-application ordering for explicit user actions and the resulting menu update | Poll or observe storage for changes |

The normal flow is:

```text
Startup: stored preferences -> application settings -> playback behavior
                                                   -> menu labels

Menu selection -> requested setting change -> persistence -> application settings
```

The menu displays application state; it does not own it. Removing or failing to update a menu must not prevent the application from loading or applying settings.

Application consumers must not read storage to determine the active setting. For example, a keyboard handler uses the applied values even when storage is temporarily unavailable.

Keep context such as whether a site has saved preferences separate from the setting values. Frame activation must not inspect menu definitions or perform storage reads.

## Variable names

Name a variable for the concept it represents, not the incidental code path that created it.

Examples from this project:

| Name | Meaning |
|---|---|
| `settings` | Current application settings |
| `settingStorageKeys` | Application setting names mapped to persistence keys |
| `legacySettingKeys` | Previous storage keys used for compatibility |
| `menuToggles` | Menu presentation definitions |
| `registeredMenuCommands` | The menu commands successfully registered with the manager |
| `hasSavedSitePreferences` | Whether saved preferences exist for this site's scope |

Do not combine these concepts into an object whose role changes depending on the caller. In particular, menu definitions should not also be the registry of persisted settings or the record of live command IDs.

Use names such as `requestedSize`, `reportedSize`, and `measuredSize` accurately. A cached value must not be described as a fresh measurement.

## Function names and effects

A function name should describe its responsibility, inputs, and meaningful effects.

| Function | Contract |
|---|---|
| `applySettings(changes)` | Update the applied settings and synchronize the affected application features; no storage or menu operations |
| `readStoredSettings()` | Read persisted values and compatibility fallbacks; do not mutate application state |
| `saveStoredSetting(name, value)` | Persist a value; do not apply it or update menus |
| `syncUserscriptMenu(visible, onSettingSelected)` | Reconcile menu entries with the applied settings and report user selections |
| `handleSettingChangeRequest(name, value)` | Coordinate persistence, application changes, and the resulting menu update |

Do not use a name such as `registerMenuCommands()` for a function that also reloads preferences and changes playback. Do not use `refreshSettings()` to conceal several unrelated responsibilities.

Do not poll, observe, or otherwise synchronize settings with storage after startup. Changes made in another tab take effect when the page reloads. The existing playback loops serve a different purpose; they consume `settings` without refreshing it from persistence.

Apply local setting changes immediately when existing code makes that straightforward. Avoid additional machinery solely to eliminate a page refresh. If the tradeoff is unclear, show the relevant code and ask before changing the design.

Return values must have a clear meaning. For example, `handleSettingChangeRequest()` returns `true` only when it successfully applies a local change. Failed actions must report an error instead of claiming success.

## Stateful external APIs

Treat registration APIs as stateful operations, not declarative rendering.

- Track each successful registration by its returned ID.
- Update only entries whose displayed state changed.
- Record state only after the corresponding operation succeeds.
- Retain IDs needed to retry failed removals.
- Report failures explicitly, without repeatedly logging the same unchanged error.
- Keep registration state separate from application state.

A callback should represent the action shown by the entry that created it. Applying that same callback more than once must not toggle the setting back when several frames receive one merged menu selection.

A failed preference write must leave the applied setting unchanged. A failed menu update must not undo a successful application change.

## Abstraction and testing

Prefer direct functions and plain data structures. Reuse existing functions before introducing a new abstraction. Add a helper when it represents a concrete responsibility or removes meaningful duplication, not merely to hide a long expression.

Keep Media Chrome responsible for its built-in control behavior and visibility lifecycle. Provide application-specific content through supported components and slots instead of duplicating the library's state or timers.

Choose icons for the action they communicate, not for the library that provides them. Resizing a window is not entering fullscreen; those symbols are not interchangeable.

Test the boundaries as well as the normal path: settings without menus, persistence failures, menu failures, repeated callbacks, startup loading, and cleanup. Verify that playback and menu rendering do not reread storage. Browser stubs verify the userscript's contract with the browser; they do not prove native rendering, layout, or timing.
