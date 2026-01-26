const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// In-memory store for active files (No Blob storage needed!)
// format: { "1234": { mediaId: "...", extension: ".pdf", timestamp: 17000... } }
let activeFiles = {};

const PORT = process.env.PORT || 3000;

// 1. WHATSAPP WEBHOOK VERIFICATION
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 2. RECEIVE WHATSAPP DOCUMENT
app.post("/webhook", async (req, res) => {
  const body = req.body;
  try {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const phoneId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    if (message && (message.type === "document" || message.type === "image")) {
      const msgType = message.type;
      const mediaId = msgType === "document" ? message.document.id : message.image.id;
      const extension = msgType === "document" 
        ? (path.extname(message.document.filename) || ".pdf") 
        : ".jpg";

      // Generate a 4-digit PIN
      const pin = Math.floor(1000 + Math.random() * 9000).toString();

      // Save metadata only (Free! No Blob storage)
      activeFiles[pin] = { mediaId, extension, timestamp: Date.now() };

      // Notify user on WhatsApp
      await axios.post(`https://graph.facebook.com/v24.0/${phoneId}/messages`, {
        messaging_product: "whatsapp",
        to: message.from,
        type: "text",
        text: { body: `✅ File received! Your PIN is: *${pin}*` }
      }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } });
    }
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(500);
  }
});

// 3. FLUTTER API: Get list of active files
// Matches your Flutter: WhatsAppConstants.API_ENDPOINT (/api/files)
app.get("/api/files", (req, res) => {
  const fileList = Object.keys(activeFiles).map(pin => ({
    pathname: `${pin}${activeFiles[pin].extension}`,
    url: `${process.env.SERVER_URL}/api/download/${pin}` // Points to the download route below
  }));
  res.json(fileList);
});

// 4. FLUTTER API: Stream the actual file
app.get("/api/download/:pin", async (req, res) => {
  const { pin } = req.params;
  const fileData = activeFiles[pin];

  if (!fileData) return res.status(404).send("Expired or invalid PIN");

  try {
    // Get WhatsApp's temporary download URL
    const urlRes = await axios.get(`https://graph.facebook.com/v24.0/${fileData.mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    });

    // Proxy/Stream the file bytes directly to Flutter
    const response = await axios({
      method: 'get',
      url: urlRes.data.url,
      responseType: 'stream',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    });

    res.setHeader('Content-Type', 'application/octet-stream');
    response.data.pipe(res);
    
    // Optional: Auto-delete from memory after download to stay "lightweight"
    // delete activeFiles[pin]; 
  } catch (error) {
    res.status(500).send("Streaming failed");
  }
});

app.listen(PORT, () => console.log(`Server on ${PORT}`));
