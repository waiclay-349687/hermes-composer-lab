# Compatibility and official policy

## Status

**Unofficial experimental desktop plugin, not an approved catalog entry.** A public GitHub repository and an MIT license are not evidence of official approval. No catalog submission is included in this project.

The review used the current [Desktop Plugin SDK documentation](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk) and host checkout [`75eab03c63362bef53c5ef216ff5d8be0afeb94f`](https://github.com/NousResearch/hermes-agent/tree/75eab03c63362bef53c5ef216ff5d8be0afeb94f).

## Where this plugin exceeds the supported surface

1. **Composer DOM access.** `src/editor.js` queries an internal `data-slot`, paints list markers with the CSS Custom Highlight API (0.4+: no wrapper elements, the host DOM is never restructured), intercepts list-editing keys on list rows, restores selection and dispatches `textInput` / `input` for undo integration. These are not documented SDK editor commands. They depend on implementation details that may change during a Hermes update.
2. **Native caret styling and overlay measurement.** `src/caret.js` reads DOM ranges and adds a temporary visual layer. The SDK does not expose a stable caret renderer or native blinking-phase signal. CSS fades only `caret-color`; it does not claim to synchronize with the OS blink phase.
3. **Actual validator rejection.** `hermes plugins validate` rejects the bundled desktop file at the `desktop surface` check for `prototype patching`. For example, bundled CodeMirror assigns defaults to its own `RangeValue.prototype`; markdown-it defines methods on its own constructor prototypes. These are library-owned definitions rather than a deliberate patch of Hermes or browser global prototypes, but the current validator flags them. We do not rewrite or disguise dependencies to evade that gate.

The [catalog admission policy, rule 8](https://github.com/NousResearch/hermes-agent/blob/75eab03c63362bef53c5ef216ff5d8be0afeb94f/plugin-catalog/README.md#L47-L56) says desktop plugins stay inside the SDK surface, forbids prototype patching, and directs authors to request missing SDK hooks rather than patch around them. The [composer contribution contract](https://github.com/NousResearch/hermes-agent/blob/75eab03c63362bef53c5ef216ff5d8be0afeb94f/apps/desktop/src/app/chat/composer/contrib.ts) keeps input and submit ownership in core. Not replacing the editor or modifying application files does **not** make our DOM adapter an officially supported seam.

## What is not, by itself, a violation

- Bundling third-party libraries is not categorically forbidden. The runtime bundle's external imports are the SDK and the allowed React modules. The above prototype-write findings are a separate, concrete compatibility problem with this bundle.
- Using the SDK's Dialog, Button, Switch, Input and SegmentedControl is the intended route for native-looking settings. Production UI uses host theme variables; sample fixture colors are not a runtime theme override.
- Publishing or manually installing a clearly identified experimental plugin is distinct from claiming admission to the curated catalog.

## Other relevant rules

- Catalog rules 1–4 require maintainer review, full commit pins and separately reviewed updates. This project is not submitted and has no self-updater or remote-code loader.
- Rule 5 mentions English-first UI for maintainer-curated sweeps. Our settings UI is Chinese-first; it is not represented as meeting that sweep expectation.
- Rule 6 requires honest declared capabilities. There are no backend tools, hooks, middleware or required environment secrets. Local settings use `ctx.storage`.
- Rule 7 requires scanner review. A `caution` result is not a clean bill of health. In this bundle, `env = env || {}` inside markdown-it can be flagged as `dump_all_env`; that parser argument is not `process.env`. Generated host test fixtures should not be confused with the distributed plugin: they are ignored by Git and never installed.

## Motion and input boundaries

- Host owns focus, blur, draft state, send handling and its idle state. The visual adapter never calls `focus()` or starts an inactivity timer.
- Fade replaces the native caret's hard blink with a CSS color animation while the input is focused. Disabling fade restores native blinking. This is intentionally separate from the host's idle logic.
- Fade falls back to native blink if `caret-animation: manual` is unsupported. Reduced-motion disables fade and movement.
- Movement duration is a user-requested effect, not a claim that every custom animation follows a universal host duration token.
- Enter is never synthesized by the plugin. Plain Enter is left to the host. IME preedit and candidate confirmation are not intercepted for sending.
- CodeMirror provides Markdown parsing and the continuation command, not a second mounted editor UI.

## Known limitations

- Host updates may break DOM selectors, normalization, undo, input bridging or SDK exports.
- Full macOS candidate-window behavior and arbitrary third-party input methods are not end-to-end verified.
- Drafts with stray block wrappers, >16k chars or >400 lines skip list highlighting and list keys (the host handles them natively). List edits change only leading indentation and markers.
- The plugin can access composer text in the renderer. It does not log, transmit or persist drafts, but it is **not sandboxed**; install only code you trust.
- Disabling settings is reversible, but cannot make prior unverified host versions compatible. Remove the plugin if input behavior becomes unreliable.
