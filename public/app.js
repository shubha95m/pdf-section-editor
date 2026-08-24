/* PDF Section Editor
 * - Renders each PDF page to a canvas (dimmed, kept as visual/positional reference).
 * - Uses pdf.js's text layer to get every text "section" (run) at its exact
 *   position, width, and font size.
 * - Each section becomes a contenteditable overlay box.
 * - On save, rasterizes each page, whites-out each edited section's original
 *   box, draws the new text at the same position/size, and exports a new PDF.
 */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const RENDER_SCALE = 1.6;

const fileInput = document.getElementById("fileInput");
const viewer = document.getElementById("viewer");
const editToggle = document.getElementById("editToggle");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

let pdfDoc = null;
let pages = []; // { canvas, viewport, spans: [{el, original}] }
let editMode = false;

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const arrayBuffer = await file.arrayBuffer();
    await loadPdf(arrayBuffer);
  } catch (err) {
    console.error(err);
    setStatus("Failed to load PDF: " + err.message);
  }
});

async function loadPdf(arrayBuffer) {
  viewer.innerHTML = "";
  pages = [];
  editMode = false;
  document.body.classList.remove("edit-mode");
  editToggle.textContent = "Enter Edit Mode";
  setStatus("Loading PDF...");

  pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    await renderPage(pageNum);
  }

  const totalSections = pages.reduce((sum, p) => sum + p.spans.length, 0);
  setStatus(
    `Loaded ${pdfDoc.numPages} page(s), ${totalSections} editable section(s). Click "Enter Edit Mode" to edit.`
  );
  saveBtn.disabled = false;
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
  textLayerDiv.style.width = viewport.width + "px";
  textLayerDiv.style.height = viewport.height + "px";

  const textContent = await page.getTextContent();

  const textLayerTask = pdfjsLib.renderTextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
    textDivs: [],
  });
  await textLayerTask.promise;

  pageWrapper.appendChild(canvas);
  pageWrapper.appendChild(textLayerDiv);
  viewer.appendChild(pageWrapper);

  const spans = Array.from(textLayerDiv.querySelectorAll("span"))
    .filter((el) => el.textContent && el.textContent.trim().length > 0)
    .map((el) => {
      el.classList.add("text-section");
      el.dataset.original = el.textContent;
      el.addEventListener("input", () => {
        el.classList.toggle("edited", el.textContent !== el.dataset.original);
      });
      return { el, original: el.textContent };
    });

  pages.push({ pageNum, canvas, viewport, spans });
}

editToggle.addEventListener("click", () => {
  editMode = !editMode;
  document.body.classList.toggle("edit-mode", editMode);
  editToggle.textContent = editMode ? "Exit Edit Mode" : "Enter Edit Mode";
  pages.forEach((p) => {
    p.spans.forEach(({ el }) => {
      el.contentEditable = editMode ? "true" : "false";
    });
  });
});

saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  try {
    await saveEditedPdf();
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

async function saveEditedPdf() {
  if (!pdfDoc) return;
  setStatus("Building edited PDF...");

  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const newPdf = await PDFDocument.create();
  const font = await newPdf.embedFont(StandardFonts.Helvetica);

  for (const p of pages) {
    const { canvas, viewport, spans } = p;

    const imgDataUrl = canvas.toDataURL("image/png");
    const imgBytes = await fetch(imgDataUrl).then((r) => r.arrayBuffer());
    const pngImage = await newPdf.embedPng(imgBytes);

    const pdfPageWidth = viewport.width / RENDER_SCALE;
    const pdfPageHeight = viewport.height / RENDER_SCALE;

    const newPage = newPdf.addPage([pdfPageWidth, pdfPageHeight]);
    newPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pdfPageWidth,
      height: pdfPageHeight,
    });

    spans.forEach(({ el }) => {
      const currentText = el.textContent;
      const left = parseFloat(el.style.left) || 0;
      const top = parseFloat(el.style.top) || 0;
      const fontSizePx = parseFloat(el.style.fontSize) || 12;
      const widthPx = el.getBoundingClientRect().width || fontSizePx * currentText.length * 0.55;

      const pdfX = left / RENDER_SCALE;
      const pdfTop = top / RENDER_SCALE;
      const pdfFontSize = fontSizePx / RENDER_SCALE;
      const pdfWidth = widthPx / RENDER_SCALE;

      // Whiteout the original glyphs in this section's box.
      newPage.drawRectangle({
        x: pdfX - 1,
        y: pdfPageHeight - pdfTop - pdfFontSize * 1.15,
        width: pdfWidth + 3,
        height: pdfFontSize * 1.35,
        color: rgb(1, 1, 1),
      });

      if (currentText.trim().length > 0) {
        newPage.drawText(currentText, {
          x: pdfX,
          y: pdfPageHeight - pdfTop - pdfFontSize * 0.92,
          size: pdfFontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }
    });
  }

  const pdfBytes = await newPdf.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "edited.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setStatus("Saved: edited.pdf downloaded.");
}
