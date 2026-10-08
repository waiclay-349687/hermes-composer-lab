### Summary

I'd like to ask whether the Desktop plugin SDK could offer a small, supported way for plugins to make **selection-aware edits in the composer**. I may well be missing an existing path, so corrections are very welcome.

### Context

I maintain a small community desktop plugin. It is unofficial and not in the catalog, and it adds Markdown list editing to the composer: Shift+Enter continues a list, Tab and Shift+Tab nest and un-nest items, Backspace at a marker outdents, and ordered lists stay numbered.

`host.composer` (`getDraft` / `setDraft` / `insertText` / `focus`) works well for whole-draft writes and inserts. As far as I can tell, though, it doesn't yet cover edits that depend on the caret position. So the plugin currently has to work directly against `[data-slot="composer-rich-input"]`:

- capture-phase key listeners
- its own copy of the serializer's offset mapping
- synthetic `textInput` / `input` events to reach the undo and draft paths
- DOM ranges for styling

That works today, but it is fragile, and I'm aware it goes against the spirit of catalog rule 8 ("request missing SDK hooks rather than patch around them"), which is why I'm asking. A few things we ran into while testing against the real app:

- An earlier version wrapped lines in spans. That broke caret placement and Backspace, even though isolated fixture tests passed.
- The plugin has to defer Tab to the host so it doesn't steal `@` / `/` completion.
- It has to guard IME composition state.
- The edit-message composer doesn't use `white-space: pre-wrap`, so a list marker's trailing space was collapsed. The plugin currently forces pre-wrap there, which we'd rather not do from a plugin.

### Possible shape (just a sketch — happy to defer to whatever fits the codebase)

1. **Read the selection** as offsets in the serialized draft, the same coordinate space as `composerPlainText`, with chips counted as their `@kind:value` text.
2. **A key hook** that core calls only when it isn't composing and no completion drawer is open, after its own trigger handling. Returning `null` falls through unchanged.
3. **One undoable transaction**, e.g. `{ changes: [{ from, to, insert }], selection }`, applied the way `renderComposerContents` does. It would record one undo point, sync the draft and reveal the caret.
4. Optionally, **lightweight text-range decorations**, for example via the CSS Custom Highlight API, so plugins can style text without mutating the editor DOM.

```ts
host.composer.onKey((ctx) => null | { changes: { from: number; to: number; insert: string }[]; selection?: number })
```

Prior art: CodeMirror keymaps plus transactions; VS Code `TextEditor.edit` plus decorations.

I understand this may not fit the roadmap, or that core may prefer to keep editing behaviour internal. In that case, any guidance on the recommended approach would be much appreciated. Thanks for the great SDK!

---
Filed as https://github.com/NousResearch/hermes-agent/issues/135074
