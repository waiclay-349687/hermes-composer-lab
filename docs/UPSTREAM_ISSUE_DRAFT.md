## [Feature]: Desktop plugin SDK — key + transaction hooks for the composer editor (selection-aware edits, undo point, decorations)

### Problem

`host.composer` (`getDraft` / `setDraft` / `insertText` / `focus`) covers whole-draft writes and inserts, but it cannot support editor-level features such as Markdown list editing, where Shift+Enter continues a list, Tab nests an item, Backspace at a marker outdents it, and ordered lists are renumbered. Those features need:

1. **The caret / selection as a text offset** in the serialized draft (the `composerPlainText` coordinate space, with chips counted as their `@kind:value` text).
2. **A keydown hook that runs before the host's own handling**, can claim a key with `preventDefault`, and otherwise falls through to the host. Completion, IME, Enter-to-send and undo stay core-owned. The hook should be skipped automatically while composing, or while a completion drawer is open.
3. **An atomic edit transaction.** Something like `applyEdit({ changes: [{ from, to, insert }], selection })` that:
   - records one undo point,
   - re-renders chips and line breaks the way `renderComposerContents` does,
   - syncs the draft,
   - and reveals the caret (`revealCaret`).
4. **Decorations / marks over text ranges.** For example, colouring list markers without touching the DOM: a supported wrapper around the CSS Custom Highlight API, keyed by text offsets.

### Why

Without these hooks, plugins reach into `[data-slot="composer-rich-input"]` directly. In practice that means:

- capture-phase key listeners,
- `textOf` / `pointAt` re-implementations of the serializer,
- synthetic `textInput` / `input` events to hit the undo and draft paths,
- and DOM ranges for styling.

This breaks easily. A community plugin ("Composer Lab") that wrapped lines in spans broke caret placement, arrow keys and Backspace in the real composer, and rewrote markdown, even though it passed isolated fixture tests. After a rewrite, it still has to:

- mirror the host's completion and Tab precedence,
- guard IME state that can go stale,
- force `white-space: pre-wrap` on the edit-message composer, which lacks it, so a marker's trailing space survives,
- and re-check every daily release.

Catalog rule 8 already tells authors to request missing SDK hooks rather than patch around them. This is that request.

### Proposal (minimal)

```ts
host.composer.onKey(handler: (ctx: {
  key: string; shift: boolean; meta: boolean; alt: boolean; ctrl: boolean
  text: string            // serialized draft
  selection: { anchor: number; head: number }
  surface: 'main' | 'edit'
}) => null | { changes: { from: number; to: number; insert: string }[]; selection?: number }): Dispose

host.composer.decorate(ranges: { from: number; to: number; className: string }[], surface?): Dispose
```

- The host calls `onKey` handlers only when not composing and no completion drawer is open, after its own completion/trigger handling and before native defaults.
- A non-null result is applied as a single undoable transaction.

### Prior art

- CodeMirror `keymap` + `EditorView.dispatch(transaction)`
- VS Code `TextEditor.edit` + `TextEditorDecorationType`
