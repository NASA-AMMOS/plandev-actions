# aerie-actions

Javascript package for use with [SeqDev](https://nasa-ammos.github.io/plandev-docs/) actions.

## Aerie -> PlanDev/SeqDev Rebrand

This product was **formerly known as Aerie Actions and is now named SeqDev Actions**. While we've updated most 
documentation and external references, some legacy mentions of the old product name may remain as we complete the transition.

What to know:

* The planning product, including modeling, simulation, scheduling and constraint-checking, is now named PlanDev
* The sequencing product, including the sequence editor, workspaces, and actions, is now named SeqDev
* All features and functionality remain the same
* Currently, repository names, package names and other internal code references will retain their existing names, and deployment/migration procedures have not changed
* In a future release, our repository and/or package names may change. If so, this will be communicated to users via release notes and normal communication channels

For the latest documentation, visit: [PlanDev Documentation](https://nasa-ammos.github.io/plandev-docs/)

<span style="display:block;text-align:center">![Example](/docs/images/Full_Example.png)</span>


See [SeqDev Actions docs](https://nasa-ammos.github.io/plandev-docs/sequencing/actions/) for more information - full API reference
coming soon.

## Action results: `data` vs `report`

An action returns an `ActionResult`:

```ts
type ActionResult = {
  status: 'FAILED' | 'SUCCESS';
  data: any;        // machine-readable output (rendered as raw JSON in the "Results" block)
  report?: string;  // optional human-facing Markdown summary (rendered in the "Report" block)
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
      'Checked **148** constraints — **2 violations** found.',
      '',
      '| Constraint | Result |',
      '| --- | --- |',
      '| Power margin | OK |',
      '| Thermal window | **Violated** at 04:12Z |',
      '',
      'See the [full report](https://example.com/runs/123) for details.',
    ].join('\n'),
  };
}
```

### Supported Markdown

The Report block accepts a curated, GitHub-flavored Markdown subset:

- Headings, paragraphs, line breaks, horizontal rules
- **Bold**, *italic*, ~~strikethrough~~, `inline code` and fenced code blocks
- Ordered/unordered lists, blockquotes
- Tables
- Hyperlinks (open in a new tab)

### Not supported (stripped for safety)

The UI **sanitizes** report content because it is rendered in other users' browsers. The following are removed: raw HTML and inline styles (`<span>`, `style="..."`), `<script>` and event handlers, `javascript:`/`data:` links, images and video (`<img>`/`<video>`), `<iframe>`/embeds, and any markup that loads a remote resource. Treat `report` as untrusted display content — only the supported subset above is rendered.
