/* Toggle between Section Editor and Bill Splitter panels */

const modeEditorBtn = document.getElementById("modeEditor");
const modeBillBtn = document.getElementById("modeBill");
const editorPanel = document.getElementById("editorPanel");
const billPanel = document.getElementById("billPanel");
const topbarTitle = document.getElementById("topbarTitle");

modeEditorBtn.addEventListener("click", () => setMode("editor"));
modeBillBtn.addEventListener("click", () => setMode("bill"));

function setMode(mode) {
  const isEditor = mode === "editor";
  modeEditorBtn.classList.toggle("active", isEditor);
  modeBillBtn.classList.toggle("active", !isEditor);
  editorPanel.hidden = !isEditor;
  billPanel.hidden = isEditor;
  topbarTitle.textContent = isEditor ? "PDF Section Editor" : "Internet Bill Splitter";
  document.body.classList.toggle("bill-mode", !isEditor);
}
