/* Bill Splitter — multi-page annexure PDFs
 * - Auto-replaces subscriber name on every page
 * - Splits into one PDF per page
 * - Names files from Period From / Period To (e.g. "nov to dec 2025.pdf")
 * - Saves into folder "internet bill - aug 2026, 24" via directory picker or ZIP fallback
 */

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

const billFileInput = document.getElementById("billFileInput");
const nameFromInput = document.getElementById("nameFrom");
const nameToInput = document.getElementById("nameTo");
const billScanBtn = document.getElementById("billScanBtn");
const billDownloadBtn = document.getElementById("billDownloadBtn");
const billEmailBtn = document.getElementById("billEmailBtn");
const billToEmailInput = document.getElementById("billToEmail");
const billEmailFromNote = document.getElementById("billEmailFromNote");
const billStatusEl = document.getElementById("billStatus");
const billPageList = document.getElementById("billPageList");

let emailConfigured = false;

loadEmailConfig();

let billPdfBytes = null;
let billPages = []; // { pageNum, fileName, periodFrom, periodTo, bytes? }
let consolidatedPdfBytes = null;

const CONSOLIDATED_FILE_NAME = "all pages consolidated.pdf";

async function loadEmailConfig() {
  try {
    const res = await fetch("/api/email-config");
    const data = await res.json();
    emailConfigured = data.configured;
    if (data.configured) {
      billEmailFromNote.textContent = `Sending from ${data.from} (configured in .env)`;
    } else {
      billEmailFromNote.textContent =
        "Email not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env, then restart the server.";
    }
  } catch {
    billEmailFromNote.textContent = "Could not check email config. Is the server running?";
  }
}

billFileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  billPdfBytes = new Uint8Array(await file.arrayBuffer());
  billPages = [];
  consolidatedPdfBytes = null;
  billDownloadBtn.disabled = true;
  billEmailBtn.disabled = true;
  billPageList.innerHTML = "";
  setBillStatus(`Loaded ${file.name}. Click "Scan Pages" to detect billing periods.`);
});

billScanBtn.addEventListener("click", async () => {
  if (!billPdfBytes) {
    setBillStatus("Upload a bill PDF first.");
    return;
  }
  billScanBtn.disabled = true;
  try {
    await scanBillPages();
  } catch (err) {
    console.error(err);
    setBillStatus("Scan failed: " + err.message);
  } finally {
    billScanBtn.disabled = false;
  }
});

billDownloadBtn.addEventListener("click", async () => {
  if (!billPages.length) return;
  billDownloadBtn.disabled = true;
  billScanBtn.disabled = true;
  billEmailBtn.disabled = true;
  try {
    await buildAndDownloadBillPages();
  } catch (err) {
    console.error(err);
    setBillStatus("Download failed: " + err.message);
  } finally {
    billDownloadBtn.disabled = false;
    billScanBtn.disabled = false;
    billEmailBtn.disabled = false;
  }
});

billEmailBtn.addEventListener("click", async () => {
  if (!billPages.length) return;
  billEmailBtn.disabled = true;
  billScanBtn.disabled = true;
  billDownloadBtn.disabled = true;
  try {
    await emailAllBillPages();
  } catch (err) {
    console.error(err);
    setBillStatus("Email failed: " + err.message);
  } finally {
    billEmailBtn.disabled = false;
    billScanBtn.disabled = false;
    billDownloadBtn.disabled = false;
  }
});

function setBillStatus(msg) {
  billStatusEl.textContent = msg;
}

function parseBillDate(str) {
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = +m[1];
  const month = +m[2] - 1;
  const year = +m[3];
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

function periodToFileName(periodFrom, periodTo) {
  const from = parseBillDate(periodFrom);
  const to = parseBillDate(periodTo);
  if (!from || !to) return "page.pdf";
  const fromMon = MONTHS[from.getMonth()];
  const toMon = MONTHS[to.getMonth()];
  const year = to.getFullYear();
  if (fromMon === toMon && from.getFullYear() === year) {
    return `${fromMon} ${year}.pdf`;
  }
  return `${fromMon} to ${toMon} ${year}.pdf`;
}

function getBillFolderName() {
  const now = new Date();
  const mon = MONTHS[now.getMonth()];
  const year = now.getFullYear();
  const day = now.getDate();
  return `internet bill - ${mon} ${year}, ${day}`;
}

async function extractPeriodDates(pageNum) {
  const doc = await pdfjsLib.getDocument({ data: billPdfBytes.slice(0) }).promise;
  const page = await doc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const items = textContent.items.filter((i) => "str" in i && i.str.trim());

  const dateItems = items.filter((i) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(i.str.trim()));
  if (dateItems.length >= 2) {
    dateItems.sort((a, b) => a.transform[4] - b.transform[4]);
    const headerY = items.find((i) => i.str.trim() === "Period From")?.transform[5];
    const rowDates = headerY != null
      ? dateItems.filter((i) => Math.abs(i.transform[5] - headerY) > 10 && Math.abs(i.transform[5] - headerY) < 30)
      : dateItems.slice(0, 2);
    rowDates.sort((a, b) => a.transform[4] - b.transform[4]);
    if (rowDates.length >= 2) {
      return { from: rowDates[0].str.trim(), to: rowDates[1].str.trim() };
    }
  }
  return { from: dateItems[0]?.str.trim(), to: dateItems[1]?.str.trim() };
}

async function findNameTextItem(pageNum, replaceFrom) {
  const doc = await pdfjsLib.getDocument({ data: billPdfBytes.slice(0) }).promise;
  const page = await doc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const items = textContent.items.filter((i) => "str" in i && i.str.trim());

  const exact = items.find((i) => i.str.trim() === replaceFrom);
  if (exact) return exact;

  const partial = items.find((i) => i.str.includes(replaceFrom));
  if (partial) return partial;

  const normalizedFrom = replaceFrom.replace(/\s+/g, " ").trim().toUpperCase();
  return items.find((i) => i.str.replace(/\s+/g, " ").trim().toUpperCase() === normalizedFrom);
}

function transformToPdfMeta(transform) {
  const [, b, , d, e, f] = transform;
  const pdfFontSize = Math.hypot(b, d) || Math.abs(d) || 12;
  return { pdfX: e, pdfY: f, pdfFontSize };
}

function applyNameReplace(pdfPage, nameItem, replaceTo, font, rgb) {
  const { pdfX, pdfY, pdfFontSize } = transformToPdfMeta(nameItem.transform);
  const original = nameItem.str;
  const originalWidth = font.widthOfTextAtSize(original, pdfFontSize);
  const newWidth = font.widthOfTextAtSize(replaceTo, pdfFontSize);
  const whiteoutWidth = Math.max(originalWidth, newWidth) + 10;
  const whiteoutHeight = pdfFontSize * 1.35;

  pdfPage.drawRectangle({
    x: pdfX - 3,
    y: pdfY - pdfFontSize * 0.28,
    width: whiteoutWidth,
    height: whiteoutHeight,
    color: rgb(1, 1, 1),
  });

  pdfPage.drawText(replaceTo, {
    x: pdfX,
    y: pdfY,
    size: pdfFontSize,
    font,
    color: rgb(0, 0, 0),
  });
}

async function buildConsolidatedPdf(replaceFrom, replaceTo) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const out = await PDFDocument.load(billPdfBytes);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const pageCount = out.getPageCount();

  for (let i = 0; i < pageCount; i++) {
    const nameItem = await findNameTextItem(i + 1, replaceFrom);
    if (nameItem) {
      applyNameReplace(out.getPages()[i], nameItem, replaceTo, font, rgb);
    }
  }

  return out.save();
}

async function buildSinglePagePdf(pageIndex, replaceFrom, replaceTo) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const src = await PDFDocument.load(billPdfBytes);
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(src, [pageIndex]);
  out.addPage(copied);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const pdfPage = out.getPages()[0];

  const nameItem = await findNameTextItem(pageIndex + 1, replaceFrom);
  if (nameItem) {
    applyNameReplace(pdfPage, nameItem, replaceTo, font, rgb);
  }

  return out.save();
}

async function scanBillPages() {
  setBillStatus("Scanning pages...");
  const doc = await pdfjsLib.getDocument({ data: billPdfBytes.slice(0) }).promise;
  billPages = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const { from, to } = await extractPeriodDates(p);
    const fileName = periodToFileName(from, to);
    billPages.push({ pageNum: p, periodFrom: from, periodTo: to, fileName });
  }

  renderBillPageList();
  billDownloadBtn.disabled = false;
  billEmailBtn.disabled = false;
  setBillStatus(
    `Found ${billPages.length} page(s). Download, or email all PDFs as attachments.`
  );
}

function renderBillPageList() {
  const folderName = getBillFolderName();
  billPageList.innerHTML = `
    <p class="bill-folder-label">Folder: <strong>${folderName}/</strong></p>
    <p class="bill-folder-label">Also includes: <strong>${CONSOLIDATED_FILE_NAME}</strong> (all pages, updated name)</p>
    <table class="bill-table">
      <thead><tr><th>Page</th><th>Period From</th><th>Period To</th><th>Filename</th></tr></thead>
      <tbody>
        ${billPages
          .map(
            (p) => `<tr>
              <td>${p.pageNum}</td>
              <td>${p.periodFrom || "—"}</td>
              <td>${p.periodTo || "—"}</td>
              <td><code>${p.fileName}</code></td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

async function ensureAllBillPdfsBuilt() {
  const replaceFrom = nameFromInput.value.trim();
  const replaceTo = nameToInput.value.trim();
  if (!replaceFrom || !replaceTo) {
    throw new Error("Enter both name fields.");
  }

  const needsBuild =
    !consolidatedPdfBytes || billPages.some((p) => !p.bytes);

  if (!needsBuild) return { replaceFrom, replaceTo };

  setBillStatus("Building consolidated PDF (all pages)...");
  consolidatedPdfBytes = await buildConsolidatedPdf(replaceFrom, replaceTo);

  for (let i = 0; i < billPages.length; i++) {
    setBillStatus(`Building page ${i + 1}/${billPages.length}...`);
    billPages[i].bytes = await buildSinglePagePdf(i, replaceFrom, replaceTo);
  }

  return { replaceFrom, replaceTo };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function getEmailAttachmentsPayload() {
  const attachments = [
    { filename: CONSOLIDATED_FILE_NAME, contentBase64: bytesToBase64(consolidatedPdfBytes) },
    ...billPages.map(({ fileName, bytes }) => ({
      filename: fileName,
      contentBase64: bytesToBase64(bytes),
    })),
  ];
  return attachments;
}

async function emailAllBillPages() {
  if (!emailConfigured) {
    setBillStatus("Configure GMAIL_USER and GMAIL_APP_PASSWORD in .env, then restart the server.");
    return;
  }

  const to = billToEmailInput.value.trim();
  if (!to) {
    setBillStatus("Enter a recipient email (click the field for suggestions).");
    billToEmailInput.focus();
    return;
  }

  await ensureAllBillPdfsBuilt();

  const folderName = getBillFolderName();

  setBillStatus(`Sending ${billPages.length + 1} PDF(s) to ${to}...`);

  const res = await fetch("/api/send-bill-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      subject: `Internet bills — ${folderName}`,
      body: `Hi,\n\nAttached are ${billPages.length + 1} PDF files from ${folderName}:\n- ${CONSOLIDATED_FILE_NAME}\n${billPages.map((p) => `- ${p.fileName}`).join("\n")}\n\nSent from PDF Bill Splitter.`,
      attachments: getEmailAttachmentsPayload(),
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Email send failed");
  }

  setBillStatus(`Email sent to ${to} with ${data.attachmentCount} attachment(s).`);
}

async function buildAndDownloadBillPages() {
  await ensureAllBillPdfsBuilt();

  const folderName = getBillFolderName();

  if ("showDirectoryPicker" in window) {
    try {
      setBillStatus("Pick a folder — files will be saved inside " + folderName + "/");
      await saveToDirectoryPicker(folderName);
      setBillStatus(
        `Saved ${billPages.length + 1} file(s) to ${folderName}/ (includes ${CONSOLIDATED_FILE_NAME}).`
      );
      return;
    } catch (err) {
      if (err.name === "AbortError") {
        setBillStatus("Folder picker cancelled — trying ZIP download instead...");
      } else {
        throw err;
      }
    }
  }

  await downloadAsZip(folderName);
  setBillStatus(
    `Downloaded ${folderName}.zip with ${billPages.length + 1} PDF(s) (includes consolidated). Extract to get the folder.`
  );
}

async function saveToDirectoryPicker(folderName) {
  const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  const billDir = await dirHandle.getDirectoryHandle(folderName, { create: true });

  setBillStatus(`Saving consolidated: ${CONSOLIDATED_FILE_NAME}`);
  await writeFileToDir(billDir, CONSOLIDATED_FILE_NAME, consolidatedPdfBytes);

  for (let i = 0; i < billPages.length; i++) {
    const { fileName, bytes } = billPages[i];
    setBillStatus(`Saving ${i + 1}/${billPages.length}: ${fileName}`);
    await writeFileToDir(billDir, fileName, bytes);
    await sleep(150);
  }
}

async function writeFileToDir(dirHandle, fileName, bytes) {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

async function downloadAsZip(folderName) {
  if (typeof JSZip === "undefined") {
    await downloadSequentialWithPrefix(folderName);
    return;
  }

  const zip = new JSZip();
  const folder = zip.folder(folderName);
  folder.file(CONSOLIDATED_FILE_NAME, consolidatedPdfBytes);
  for (const { fileName, bytes } of billPages) {
    folder.file(fileName, bytes);
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `${folderName}.zip`);
}

async function downloadSequentialWithPrefix(folderName) {
  setBillStatus(`Downloading consolidated: ${CONSOLIDATED_FILE_NAME}`);
  triggerDownload(
    new Blob([consolidatedPdfBytes], { type: "application/pdf" }),
    `${folderName} - ${CONSOLIDATED_FILE_NAME}`
  );
  await sleep(400);

  for (let i = 0; i < billPages.length; i++) {
    const { fileName, bytes } = billPages[i];
    setBillStatus(`Downloading ${i + 1}/${billPages.length}: ${fileName}`);
    triggerDownload(new Blob([bytes], { type: "application/pdf" }), `${folderName} - ${fileName}`);
    await sleep(400);
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
