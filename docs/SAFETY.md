# Send-safety investigation and test boundaries

## Confirmed defect fixed in 0.3.0

The previous `Aa` settings control rendered Hermes's `Button` without `type="button"`. The host component did not set a default type. Inside the composer form, the native default is `submit`.

An isolated Electron fixture using the **actual host Button component** reproduced one submit after one click on the old control. Clicking the explicitly non-submit version did not increase the counter. The actual plugin's revised settings UI was also mounted inside a form and exercised without any submit.

This proves a real defect and a plausible explanation for an unexpected send when opening settings. It does **not** identify the cause of any particular past user message: no keystroke trace or draft-content logging was available, and the plugin does not add one.

### Fixes

- Every plugin Button explicitly uses `type="button"`; the settings opener additionally prevents the default click action.
- Dialog-level submit handling prevents submission and event propagation.
- Enter in settings text inputs cannot implicitly submit an enclosing form.
- The trial editor stops key propagation, respects IME composition, and converts ordinary Enter to a line break locally.
- No send RPC, form-submit call, synthetic Enter key or timed auto-send was found in runtime source.

## List bridge review

The adapter emits an input compatibility event containing a newline to record an undo point, followed by an input notification after changing Markdown. That is **not** a keyboard Enter event. The reviewed host `handleEditorBeforeInput` records undo state and `handleEditorInput` flushes the draft; neither submits it.

This is still an unsupported compatibility bridge. Another host implementation could react differently, so the absence of a send in these tests is not a guarantee across arbitrary releases.

## Tests

`npm test` runs 10 pure logic, migration, color validation and source safety contracts. The two Electron suites contain 13 and 12 checks, respectively; all 35 checks passed for the initial 0.3.0 release. The multiple-composer / narrow-viewport check confirms a single settings dialog remains usable.

The official catalog validator did **not** pass; the production-only result is preserved separately in [VALIDATION.json](VALIDATION.json). Functional tests and catalog admission are different claims.

`npm run test:electron` runs:

- `tests/run.cjs`: native idle / single-caret behavior, list deletion and numbering, undo/redo, text-color isolation, Enter versus Shift+Enter, non-list Tab, reference-chip identity, Chromium preedit, cleanup.
- `tests/safety.cjs`: old Button defect reproduction; actual plugin control activation; switches/reset; valid and invalid color input; Enter isolation; safe trial editing; live theme color; reduced-motion; native fade alpha samples and stable body color; unchanged fade phase after unrelated events; IME / list non-submission; cleanup.

The Electron tests use the host's real serializer, undo hook and UI primitives where stated. Registration, storage, notifications and the submit callback are fixture substitutes. Tests do **not** connect to the gateway, open a real chat session or send messages. CSS screenshots use sample theme tokens and are not screenshots of a user's live conversations.

Chromium `Input.imeSetComposition` coverage is not complete macOS candidate-window coverage. Settings UI and basic safety can pass while an untested host/input-method combination still has a defect. No claim of “all auto-send paths are impossible” is made.

## Reporting

Include plugin version, Hermes version, operating system, input method, whether `Aa` or a settings control was clicked, and a minimal reproduction with non-sensitive placeholder text. Do not post real drafts, credentials, or complete application logs in public issues.
