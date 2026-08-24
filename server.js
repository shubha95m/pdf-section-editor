require("dotenv").config();

const express = require("express");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 5173;

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.get("/api/email-config", (_req, res) => {
  const user = (process.env.GMAIL_USER || "").trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
  res.json({
    configured: Boolean(user && pass),
    from: user || null,
  });
});

app.post("/api/send-bill-email", async (req, res) => {
  try {
    const { to, subject, body, attachments } = req.body;

    if (!to || !isValidEmail(to)) {
      return res.status(400).json({ error: "Valid recipient email is required." });
    }
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return res.status(400).json({ error: "No attachments to send." });
    }

    const user = (process.env.GMAIL_USER || "").trim();
    const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");

    if (!user || !pass) {
      return res.status(400).json({
        error: "Gmail not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env and restart the server.",
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });

    const mailAttachments = attachments.map(({ filename, contentBase64 }) => ({
      filename,
      content: Buffer.from(contentBase64, "base64"),
      contentType: "application/pdf",
    }));

    const info = await transporter.sendMail({
      from: user,
      to,
      subject: subject || "Internet bill PDFs",
      text:
        body ||
        `Attached: ${attachments.length} PDF file(s).\n\nSent from PDF Section Editor (Bill Splitter).`,
      attachments: mailAttachments,
    });

    res.json({ ok: true, messageId: info.messageId, attachmentCount: attachments.length });
  } catch (err) {
    console.error("Email send failed:", err);
    const msg =
      err.code === "EAUTH"
        ? "Gmail login failed. Use a Google App Password (not your regular password)."
        : err.message || "Failed to send email.";
    res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`PDF Section Editor running at http://localhost:${PORT}`);
  if (process.env.GMAIL_USER) {
    console.log(`Email: configured for ${process.env.GMAIL_USER}`);
  } else {
    console.log("Email: set GMAIL_USER + GMAIL_APP_PASSWORD in .env");
  }
});
