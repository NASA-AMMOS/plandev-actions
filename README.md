# plandev-actions

Javascript package for use with [PlanDev/SeqDev](https://nasa-ammos.github.io/plandev-docs/) actions.

## PlanDev/SeqDev Rebrand

This product was **formerly known as Aerie Actions and is now named PlanDev/SeqDev Actions**. What to know:

- The planning product, including modeling, simulation, scheduling and constraint-checking, is now named PlanDev
- The sequencing product, including the sequence editor, workspaces, and actions, is now named PlanDev/SeqDev
- All features and functionality remain the same

For the latest documentation, visit: [PlanDev Documentation](https://nasa-ammos.github.io/plandev-docs/)

<span style="display:block;text-align:center">![Example](/docs/images/Full_Example.png)</span>

See [PlanDev/SeqDev Actions docs](https://nasa-ammos.github.io/plandev-docs/sequencing/actions/) for more information - full API reference
coming soon.

## Workspace file revisions

These methods require a workspace server with the file-revisions endpoints. They use the action's workspace,
authorization token, and role. Reading history, creating a revision, and restoring a file remain subject to the
server's permissions and read-only checks.

| Method                                          | Result                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `listFileRevisions(path)`                       | `{ revisions: FileRevision[], matchingRevision: string \| null }` |
| `readFileAtRevision(path, revision)`            | Historical file contents as a string                              |
| `getFileRevisionMetadata(path, revision)`       | `{ versionMetadata: FileRevision, fileMetadata: FileMetadata }`   |
| `createFileRevision(path, options?)`            | `{ name: string }`                                                |
| `restoreFileRevision(path, revision, options?)` | `{ success: true, etag: string \| null }`                         |

All methods are asynchronous. Paths are relative to the workspace and identify the file at its **current** path;
`pathAtRevision` in the returned metadata records its historical path. Revision names are assigned by the server and
are scoped to a file's history. Lists are newest first. `matchingRevision: null` means the saved content and metadata
match no listed revision; the list may still contain revisions. `FileRevision` also includes `message`,
`createdBy`, `createdAt`, and nullable `lastEditedBy`/`lastEditedAt`. Timestamps remain strings.

Creating a revision bookmarks the saved state without changing the file. Restoring writes the historical content
and user metadata into the existing file, preserves its current read-only setting and system metadata, and does not
create another named revision. These endpoints do not currently retrieve or restore revisions through a deleted path.

No concurrency token is required for ordinary usage:

```ts
await actionsAPI.createFileRevision('sequences/example.seq');
await actionsAPI.createFileRevision('sequences/example.seq', { message: 'Generated output' });
await actionsAPI.restoreFileRevision('sequences/example.seq', 'b');
```

By default, these calls operate on the file's current saved state. The SDK supplies the backend's required
`If-Match: *` header internally. Optionally pass `{ ifMatch: etag }` to request a content-version check;
creation options may also contain `message`.

### Choosing revisions for file parameters

Set `withRevision: true` on a `file`, `fileList`, `sequence`, or `sequenceList` parameter and the person running the
action also chooses, per file, the **working copy** or a named revision. The action then receives a `FileRef` (or
`FileRef[]`) instead of a path string; without the flag it receives strings, as before.

```ts
type FileRef = { path: string; revision?: string }; // no revision: working copy; 'b': revision b
```

The working copy is the file's latest saved contents at the moment the action reads it, so it is not a reproducible
snapshot. A pinned revision is immutable. `readFile` accepts either a path or a `FileRef`:

```ts
export const parameterDefinitions = {
  input: { type: 'sequence', primary: true, withRevision: true },
} as const satisfies ActionParameterDefinitions;

export async function main(parameters: ActionParameters<typeof parameterDefinitions>, settings, actionsAPI) {
  const source = await actionsAPI.readFile(parameters.input); // parameters.input: FileRef
  // ...
}
```

A pinned read fails, rather than falling back to the working copy, if the file at that path has no such revision.

Add `allowWorkingCopy: false` to require a named revision for every selected file. The action then receives
`revision` on each `FileRef` (typed as `Required<FileRef>`), and a run that is missing one is rejected before the
action starts.

### Conditional operations

`readFile(path)` still returns a string. Use `readFileWithEtag(path)` to obtain `{ content, etag }` instead. The ETag is
the server's exact header value, including quotes. An omitted header is returned as `null`, never as `"*"`.

```ts
const file = await actionsAPI.readFileWithEtag('sequences/example.seq');
if (file.etag === null) throw new Error('The workspace server did not return an ETag');

// Validate file.content here, then bookmark using the observed content version.
const revision = await actionsAPI.createFileRevision('sequences/example.seq', {
  ifMatch: file.etag,
  message: 'Passed validation',
});
const historicalContent = await actionsAPI.readFileAtRevision('sequences/example.seq', revision.name);
```

For revision creation and restore, `ifMatch` is entirely optional. Supply a current-file ETag to request a content-version
check; omit it or pass `"*"` to skip that comparison. The wildcard does not bypass authorization, read-only checks,
or the requirement that the file exist. Never use a historical revision name as an ETag.

`writeFile(name, contents, overwrite)` retains its original three-argument signature and `{ success: true }` result.
For ordinary generated output, no concurrency token is needed:

```ts
await actionsAPI.writeFile('output.seq', generatedContent, true);
const revision = await actionsAPI.createFileRevision('output.seq', { message: 'Generated output' });
```

Writing and creating a revision are **two separate operations**. If the second fails, the write has already succeeded.
Without an explicit precondition, revision creation bookmarks whatever saved state exists when the server handles
that request, including any intervening edits. For validation workflows, use the optional read-then-revise pattern above.
The SDK does not retry failed operations or replace a caller-supplied ETag with `"*"`. A retry of revision creation after a lost response can create an
additional revision. The current backend's ETag covers file content only, so it does not detect metadata-only changes.

### Errors and exported types

Failed workspace HTTP responses continue to throw plain `Error` objects with the existing
`"status - response body"` message format. Network errors remain the original fetch errors.

The package adds the types `FileRef`, `FileRevision`, `FileRevisionList`, `FileRevisionMetadata`, `CreateFileRevisionOptions`,
`CreateFileRevisionResult`, `RevisionWriteOptions`, `FileReadResult`, and `FileWriteResult` (used by restore).

## Action results: `data` vs `report`

An action returns an `ActionResult`:

```ts
type ActionResult = {
  status: 'FAILED' | 'SUCCESS';
  data: any; // machine-readable output (rendered as raw JSON in the "Results" block)
  report?: string; // optional human-facing Markdown summary (rendered in the "Report" block)
};
```

- **`data`** is the structured, machine-readable output. The UI shows it as pretty-printed JSON in the **Results** block.
- **`report`** is an optional **Markdown** string for the things a person needs to read and click. The UI renders it in a **Report** block shown above Results — so you no longer need to stuff human-readable output into logs.

### Example

```ts
export async function main(parameters, settings, actionsAPI) {
  // ... do work ...
  return {
    status: 'SUCCESS',
    data: { violations: 2, checked: 148 },
    report: [
      '## Constraint check complete',
      '',
      'Checked **148** constraints — <span style="color: #c00">2 violations</span> found.',
      '',
      '| Constraint | Result |',
      '| --- | --- |',
      '| Power margin | <span style="color: green">OK</span> |',
      '| Thermal window | <span style="color: #c00">**Violated** at 04:12Z</span> |',
      '',
      'See the [full report](https://example.com/runs/123) for details.',
    ].join('\n'),
  };
}
```

### Supported Markdown

The Report block accepts a curated, GitHub-flavored Markdown subset:

- Headings, paragraphs, line breaks, horizontal rules
- **Bold**, _italic_, ~~strikethrough~~, `inline code` and fenced code blocks
- Ordered/unordered lists, blockquotes
- Tables
- Hyperlinks (open in a new tab)
- Inline text color via `<span style="color: ...">` — `color` and `background-color` only, with validated color values (named, `#hex`, `rgb()`/`hsl()`). Works in text and inside table cells.

### Not supported (stripped for safety)

The UI **sanitizes** report content because it is rendered in other users' browsers. The following are removed: `<script>` and event handlers, `javascript:`/`data:` links, images and video (`<img>`/`<video>`), `<iframe>`/embeds, other raw HTML, and **any CSS other than `color`/`background-color`** (so a `style` can't carry `url(...)`, `position`, etc.). Treat `report` as untrusted display content — only the supported subset above is rendered.
