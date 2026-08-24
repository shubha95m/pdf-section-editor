# PDF Section Editor

A tiny local web app to:
1. Upload a PDF
2. Auto-detect every text "section" (each text run, at its real position, width, and font size)
3. Flip into Edit Mode and edit any section directly, in place
4. Save/export the result back out as a new PDF

No account, no cloud upload — everything runs in your browser, served by a one-file local Express server.

## How it works

- **Detection**: Each page is rendered with [pdf.js](https://mozilla.github.io/pdf.js/), which also extracts the text layer — every text run with its exact `left/top/font-size` in page coordinates.
- **Editing**: Every text run becomes an absolutely-positioned `contenteditable` `<span>`, sitting exactly on top of a dimmed rendering of the original page (the dimmed page image is just a visual/position guide).
- **Saving**: Each page is rasterized (so images, lines, shapes, etc. are preserved), then for every edited section: the original text area is painted over with white, and the new text is drawn at the same x/y/font-size using [pdf-lib](https://pdf-lib.js.org/). The result is exported as `edited.pdf`.

### Limitations (by design, to keep this small)
- Font matching is approximate — output text uses Helvetica, not the original embedded font.
- Works best on PDFs that are mostly text (reports, letters, forms, invoices). Very dense multi-column or heavily-styled PDFs may have imperfect alignment.
- "Section" = one text run as pdf.js sees it (usually a line or part of a line with consistent styling), not full paragraphs.

## Setup

```bash
cd /Users/shubham.sharma/pdf-section-editor
npm install
npm start
```

Then open **http://localhost:5173** in your browser.

## Usage

1. Click **Upload PDF** and choose a file.
2. Wait for it to render — every text section will be outlined once you enter edit mode.
3. Click **Enter Edit Mode**.
4. Click into any section and type to change it (blank it, replace it, etc. — the box keeps the original size/position).
5. Click **Save as PDF** — a new file `edited.pdf` will download via your browser.

## Project structure

```
pdf-section-editor/
├── package.json
├── server.js          # tiny static file server
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js          # all PDF load / edit / save logic
└── README.md
```

## Possible next steps
- Group multiple text runs into full paragraphs instead of per-line sections.
- Preserve original embedded fonts by extracting font metrics from the PDF.
- Add per-section font-size/color controls in edit mode.
- Add a "revert section" button (already tracked via `data-original` on each span).
