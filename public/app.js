/* PDF Section Editor
 * - Renders each PDF page to a canvas (dimmed, kept as visual/positional reference).
 * - Uses pdf.js's text layer to get every text "section" (run) at its exact
 *   position, width, and font size.
 * - Each section becomes a contenteditable overlay box.
 * - On save, loads the original PDF (vector, not rasterized) and patches only
 *   sections the user actually changed — whiteout + redraw at measured bounds.
 */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const RENDER_SCALE = 1.6;

const fileInput = document.getElementById("fileInput");
const viewer = document.getElementById("viewer");
const editToggle = document.getElementById("editToggle");
const previewBtn = document.getElementById("previewBtn");
const saveBtn = document.getElementById("saveBtn");
const backEditBtn = document.getElementById("backEditBtn");
const statusEl = document.getElementById("status");

let pdfDoc = null;
let originalPdfBytes = null;
let uploadedFileName = "document.pdf";
let pages = []; // { pageNum, canvas, viewport, pageWrapper, spans: [{el, original, pdfMeta}] }
let editMode = false;
let previewMode = false;
let previewPdfBytes = null;

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    uploadedFileName = file.name || "document.pdf";
    const arrayBuffer = await file.arrayBuffer();
    await loadPdf(arrayBuffer);
  } catch (err) {
    console.error(err);
    setStatus("Failed to load PDF: " + err.message);
  }
});

async function loadPdf(arrayBuffer) {
  exitPreviewMode();
  viewer.innerHTML = "";
  pages = [];
  editMode = false;
  previewPdfBytes = null;
  document.body.classList.remove("edit-mode");
  editToggle.textContent = "Enter Edit Mode";
  setStatus("Loading PDF...");

  originalPdfBytes = new Uint8Array(arrayBuffer.slice(0));
  pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    await renderPage(pageNum);
  }

  const totalSections = pages.reduce((sum, p) => sum + p.spans.length, 0);
  setStatus(
    `Loaded ${pdfDoc.numPages} page(s), ${totalSections} editable section(s). Click "Enter Edit Mode" to edit.`
  );
  saveBtn.disabled = false;
  previewBtn.disabled = false;
  editToggle.disabled = false;
}

async function renderPage(pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const pageWrapper = document.createElement("div");
  pageWrapper.className = "page-wrapper";
  pageWrapper.style.width = viewport.width + "px";
  pageWrapper.style.height = viewport.height + "px";

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  const textLayerDiv = document.createElement("div");
  textLayerDiv.className = "textLayer";
  textLayerDiv.style.setProperty("--scale-factor", String(viewport.scale));

  const textContent = await page.getTextContent();

  const textLayerTask = pdfjsLib.renderTextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
    textDivs: [],
  });
  await textLayerTask.promise;

  textLayerDiv.style.setProperty("--scale-factor", String(viewport.scale));
  textLayerDiv.style.width = `${viewport.width}px`;
  textLayerDiv.style.height = `${viewport.height}px`;

  pageWrapper.appendChild(canvas);
  pageWrapper.appendChild(textLayerDiv);
  viewer.appendChild(pageWrapper);

  const textItems = textContent.items.filter(
    (item) => "str" in item && item.str.trim().length > 0
  );

  const spanElements = Array.from(textLayerDiv.querySelectorAll("span")).filter(
    (el) => el.textContent && el.textContent.trim().length > 0
  );

  const spans = spanElements.map((el, index) => {
    el.classList.add("text-section");
    el.dataset.original = el.textContent;
    el.dataset.origWidthPx = String(Math.ceil(el.getBoundingClientRect().width));
    el.addEventListener("input", () => syncSpanEditState(el));
    const pdfMeta = textItems[index]
      ? transformToPdfMeta(textItems[index].transform)
      : null;
    return { el, original: el.textContent, pdfMeta };
  });

  pages.push({ pageNum, canvas, viewport, pageWrapper, spans });
}

function syncSpanEditState(el) {
  const edited = el.textContent !== el.dataset.original;
  el.classList.toggle("edited", edited);
  if (!edited) {
    el.style.minWidth = "";
    return;
  }
  const origW = parseFloat(el.dataset.origWidthPx) || 0;
  const currentW = el.scrollWidth || el.getBoundingClientRect().width;
  el.style.minWidth = Math.max(origW, currentW) + 2 + "px";
}

editToggle.addEventListener("click", () => {
  if (previewMode) return;
  editMode = !editMode;
  document.body.classList.toggle("edit-mode", editMode);
  editToggle.textContent = editMode ? "Exit Edit Mode" : "Enter Edit Mode";
  pages.forEach((p) => {
    p.spans.forEach(({ el }) => {
      el.contentEditable = editMode ? "true" : "false";
    });
  });
  if (editMode) {
    setStatus("Edit mode on — click any text section to edit. White boxes hide the old text.");
  } else if (pdfDoc) {
    const totalSections = pages.reduce((sum, p) => sum + p.spans.length, 0);
    setStatus(
      `Loaded ${pdfDoc.numPages} page(s), ${totalSections} editable section(s). Click "Enter Edit Mode" to edit.`
    );
  }
});

previewBtn.addEventListener("click", async () => {
  previewBtn.disabled = true;
  saveBtn.disabled = true;
  try {
    await enterPreviewMode();
  } catch (err) {
    console.error(err);
    setStatus("Preview failed: " + err.message);
  } finally {
    previewBtn.disabled = false;
    saveBtn.disabled = false;
  }
});

backEditBtn.addEventListener("click", () => {
  exitPreviewMode();
});

saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  try {
    await downloadEditedPdf();
  } catch (err) {
    console.error(err);
    setStatus("Failed to save PDF: " + err.message);
  } finally {
    saveBtn.disabled = false;
  }
});

function setStatus(msg) {
  statusEl.textContent = msg;
}

function getEditedSpans() {
  return pages.flatMap((p) =>
    p.spans
      .filter(({ el, original }) => el.textContent !== original)
      .map((span) => ({ ...span, page: p }))
  );
}

function transformToPdfMeta(transform) {
  const [, b, , d, e, f] = transform;
  const pdfFontSize = Math.hypot(b, d) || Math.abs(d) || 12;
  return { pdfX: e, pdfY: f, pdfFontSize };
}

function getSpanPdfBounds(el, pageWrapper, viewport, font, text) {
  const pageRect = pageWrapper.getBoundingClientRect();
  const spanRect = el.getBoundingClientRect();
  const fontSizePx = parseFloat(getComputedStyle(el).fontSize) || 12;

  const leftPx = spanRect.left - pageRect.left;
  const topPx = spanRect.top - pageRect.top;
  const pdfPageHeight = viewport.height / RENDER_SCALE;
  const pdfX = leftPx / RENDER_SCALE;
  const pdfTop = topPx / RENDER_SCALE;
  const pdfFontSize = fontSizePx / RENDER_SCALE;
  const pdfWidth = spanRect.width / RENDER_SCALE;
  const pdfHeight = spanRect.height / RENDER_SCALE;

  const newTextWidth = font.widthOfTextAtSize(text, pdfFontSize);
  const whiteoutWidth = Math.max(pdfWidth, newTextWidth) + 8;
  const whiteoutHeight = Math.max(pdfHeight, pdfFontSize * 1.25) + 4;

  return {
    pdfX,
    pdfFontSize,
    whiteoutWidth,
    whiteoutHeight,
    whiteoutY: pdfPageHeight - pdfTop - whiteoutHeight + 1,
    textY: pdfPageHeight - pdfTop - pdfFontSize * 0.82,
  };
}

async function buildEditedPdfBytes() {
  if (!originalPdfBytes) return null;

  const editedSpans = getEditedSpans();
  if (editedSpans.length === 0) return null;

  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const outPdf = await PDFDocument.load(originalPdfBytes);
  const font = await outPdf.embedFont(StandardFonts.Helvetica);

  for (const { el, original, pdfMeta, page } of editedSpans) {
    const currentText = el.textContent;
    const pdfPage = outPdf.getPages()[page.pageNum - 1];

    if (pdfMeta) {
      const { pdfX, pdfY, pdfFontSize } = pdfMeta;
      const originalWidth = font.widthOfTextAtSize(original, pdfFontSize);
      const newTextWidth = font.widthOfTextAtSize(currentText, pdfFontSize);
      const whiteoutWidth = Math.max(originalWidth, newTextWidth) + 10;
      const whiteoutHeight = pdfFontSize * 1.35;

      pdfPage.drawRectangle({
        x: pdfX - 3,
        y: pdfY - pdfFontSize * 0.28,
        width: whiteoutWidth,
        height: whiteoutHeight,
        color: rgb(1, 1, 1),
      });

      if (currentText.trim().length > 0) {
        pdfPage.drawText(currentText, {
          x: pdfX,
          y: pdfY,
          size: pdfFontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }
      continue;
    }

    const bounds = getSpanPdfBounds(el, page.pageWrapper, page.viewport, font, currentText);

    pdfPage.drawRectangle({
      x: bounds.pdfX - 2,
      y: bounds.whiteoutY,
      width: bounds.whiteoutWidth,
      height: bounds.whiteoutHeight,
      color: rgb(1, 1, 1),
    });

    if (currentText.trim().length > 0) {
      pdfPage.drawText(currentText, {
        x: bounds.pdfX,
        y: bounds.textY,
        size: bounds.pdfFontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  return outPdf.save();
}

async function enterPreviewMode() {
  const editedSpans = getEditedSpans();
  if (editedSpans.length === 0) {
    setStatus("No changes to preview — edit at least one section first.");
    return;
  }

  setStatus(`Building preview (${editedSpans.length} change(s))...`);
  previewPdfBytes = await buildEditedPdfBytes();

  editMode = false;
  document.body.classList.remove("edit-mode");
  document.body.classList.add("preview-mode");
  editToggle.textContent = "Enter Edit Mode";
  previewMode = true;

  pages.forEach((p) => {
    p.spans.forEach(({ el }) => {
      el.contentEditable = "false";
    });
  });

  await renderPreview(previewPdfBytes);
  setStatus(
    `Preview — this matches the downloaded PDF (${editedSpans.length} change(s)). Click Download or Back to Edit.`
  );
}

function exitPreviewMode() {
  if (!previewMode) return;
  previewMode = false;
  previewPdfBytes = null;
  document.body.classList.remove("preview-mode");
  backEditBtn.hidden = true;

  viewer.innerHTML = "";
  pages.forEach((p) => {
    viewer.appendChild(p.pageWrapper);
  });

  if (pdfDoc) {
    const totalSections = pages.reduce((sum, p) => sum + p.spans.length, 0);
    setStatus(
      `Loaded ${pdfDoc.numPages} page(s), ${totalSections} editable section(s). Click "Enter Edit Mode" to edit.`
    );
  }
}

async function renderPreview(pdfBytes) {
  viewer.innerHTML = "";
  const previewDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;

  for (let pageNum = 1; pageNum <= previewDoc.numPages; pageNum++) {
    const page = await previewDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const pageWrapper = document.createElement("div");
    pageWrapper.className = "page-wrapper preview-page";
    pageWrapper.style.width = viewport.width + "px";
    pageWrapper.style.height = viewport.height + "px";

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    pageWrapper.appendChild(canvas);
    viewer.appendChild(pageWrapper);
  }

  backEditBtn.hidden = false;
}

async function downloadEditedPdf() {
  if (!pdfDoc || !originalPdfBytes) return;

  let pdfBytes = previewPdfBytes;
  const editedSpans = getEditedSpans();

  if (!pdfBytes) {
    if (editedSpans.length === 0) {
      setStatus("No changes to save — edit at least one section first.");
      return;
    }
    setStatus(`Building PDF (${editedSpans.length} change(s))...`);
    pdfBytes = await buildEditedPdfBytes();
  }

  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = uploadedFileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setStatus(`Downloaded ${uploadedFileName} (${editedSpans.length} section(s) updated).`);
}
