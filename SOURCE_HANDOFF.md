# Model QC Studio — source handoff

This archive contains the application source for Model QC Studio. Uploaded datasets are parsed and analysed in the user's browser.

## Run locally

Requirements: Node.js 22.13 or later and npm.

```bash
npm ci
npm run dev
```

Open the local URL printed by the development server.

## Production build

```bash
npm run build
```

## Main application files

- `app/page.tsx` — interface and user workflow
- `app/qc.ts` — parsing, validation, statistics, comparison, and report logic
- `app/globals.css` — visual styling
- `app/layout.tsx` — page metadata and application shell

## Notes

- No uploaded model data, template data, variable definitions, or ground-truth data are included in this archive.
- Generated build output, dependency folders, Git history, and the original ChatGPT Sites project binding are excluded.
- A recipient can run and modify this code locally. To publish it, they should connect it to their own hosting project or repository.
