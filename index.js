const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { put, list } = require("@vercel/blob");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// --- HELPER: Generate random 4-digit PIN ---
function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// 1. WEBHOOK VERIFICATION (For WhatsApp Handshake)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook Verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 2. RECEIVE MESSAGE & SAVE FILE (The Bot Logic)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Check if it's a valid WhatsApp message
  if (!body.object) return res.sendStatus(404);

  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // Get the Phone Number ID that received the message
    const businessPhoneId = value?.metadata?.phone_number_id;

    if (message) {
      const from = message.from; // User's phone number
      const msgType = message.type;

      // --- LOGIC: Handle Text ---
      if (msgType === "text") {
        await sendMessage(businessPhoneId, from, "Send me a Document or Photo, and I'll give you a 4-digit PIN.");
      } 
      
      // --- LOGIC: Handle Documents & Images ---
      else if (msgType === "document" || msgType === "image") {
        console.log(`📂 Received ${msgType} from ${from}`);

        // 1. Get Media ID
        const mediaId = msgType === "document" ? message.document.id : message.image.id;
        
        // 2. Determine Extension (e.g. .pdf, .jpg)
        let extension = "";
        if (msgType === "document") {
            const originalName = message.document.filename;
            extension = path.extname(originalName) || ".pdf";
        } else {
            extension = ".jpg";
        }

        // 3. Generate PIN and Filename
        const pin = generatePin();
        const fileName = `${pin}${extension}`; // e.g. "1234.pdf"

        // 4. Get Media URL from Facebook
        const urlRes = await axios.get(`https://graph.facebook.com/v24.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
        });

        // 5. Download the File Binary Data
        const fileRes = await axios.get(urlRes.data.url, {
            responseType: "arraybuffer",
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
        });

        // 6. Save to Vercel Blob (Exact Name)
        // 'addRandomSuffix: false' ensures the file is named exactly "1234.pdf"
        await put(fileName, fileRes.data, {
            access: 'public',
            token: process.env.BLOB_READ_WRITE_TOKEN,
            addRandomSuffix: false 
        });

        // 7. Reply to User with the PIN
        await sendMessage(businessPhoneId, from, `✅ Document Saved!\n\nYour PIN is: *${pin}*`);
      }
    }
    res.sendStatus(200);

  } catch (error) {
    console.error("❌ Error:", error.message);
    res.sendStatus(500);
  }
});

// --- API ENDPOINT FOR FLUTTER APP (JSON) ---
// This is what your Flutter app calls to get the list of files
app.get("/api/files", async (req, res) => {
    try {
        const { blobs } = await list({ token: process.env.BLOB_READ_WRITE_TOKEN });
        res.json(blobs); // Returns pure JSON list
    } catch (e) {
        res.status(500).json({ error: "Failed to list files" });
    }
});

// --- UI PAGE FOR BROWSERS (HTML) ---
app.get("/", async (req, res) => {
    try {
        const { blobs } = await list({ token: process.env.BLOB_READ_WRITE_TOKEN });
        
        let fileRows = blobs.map(blob => `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold; color: #333;">${blob.pathname}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; color: #666;">${new Date(blob.uploadedAt).toLocaleString()}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd;">
                    <a href="${blob.url}" target="_blank" style="background-color: #25D366; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; font-weight: bold;">Download</a>
                </td>
            </tr>
        `).join('');

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Bot Files</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                h1 { color: #128C7E; text-align: center; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th { text-align: left; padding: 12px; border-bottom: 2px solid #ddd; color: #555; }
                tr:hover { background-color: #f9f9f9; }
                .empty { text-align: center; padding: 20px; color: #888; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📂 Received Documents</h1>
                ${blobs.length > 0 ? `
                <table>
                    <thead>
                        <tr>
                            <th>PIN / Filename</th>
                            <th>Date Uploaded</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${fileRows}
                    </tbody>
                </table>
                ` : '<div class="empty">No files received yet. Send a message to the bot!</div>'}
            </div>
        </body>
        </html>
        `;

        res.send(html);
    } catch (e) { 
        res.status(500).send("Error loading files."); 
    }
});

// --- HELPER: Send Message to WhatsApp ---
async function sendMessage(phoneId, to, textBody) {
  const senderId = phoneId || process.env.PHONE_NUMBER_ID; 
  try {
    await axios.post(
      `https://graph.facebook.com/v24.0/${senderId}/messages`, 
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: textBody }
      },
      { 
        headers: { 
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        } 
      }
    );
  } catch (err) {
    console.error("Failed to send message:", err.response ? err.response.data : err.message);
  }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
