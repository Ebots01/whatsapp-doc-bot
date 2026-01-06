// 2. RECEIVE MESSAGES (POST)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // LOGGING: Print exactly what WhatsApp sent us
  console.log("Incoming Data:", JSON.stringify(body, null, 2));

  if (body.object) {
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from;
      const msgType = message.type;

      console.log(`Received message type: ${msgType} from: ${from}`);

      // --- CASE 1: Text Message (NEW: Added this so you get a reply) ---
      if (msgType === "text") {
        await axios.post(
          `https://graph.facebook.com/v18.0/${body.entry[0].changes[0].value.metadata.phone_number_id}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: "I am alive! Send me a PDF or Image to save it." },
          },
          { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
      }

      // --- CASE 2: Document or Image (Your original code) ---
      else if (msgType === "document" || msgType === "image") {
        const mediaId = msgType === "document" ? message.document.id : message.image.id;
        const fileName = msgType === "document" ? message.document.filename : `image_${Date.now()}.jpg`;

        try {
            const urlResponse = await axios.get(
                `https://graph.facebook.com/v18.0/${mediaId}`,
                { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
            );
            const mediaUrl = urlResponse.data.url;

            const binaryResponse = await axios.get(mediaUrl, {
                responseType: "arraybuffer",
                headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            });

            const blob = await put(fileName, binaryResponse.data, {
                access: 'public',
                token: process.env.BLOB_READ_WRITE_TOKEN
            });

            await axios.post(
                `https://graph.facebook.com/v18.0/${body.entry[0].changes[0].value.metadata.phone_number_id}/messages`,
                {
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: `Saved! View it here: ${blob.url}` },
                },
                { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
            );

        } catch (error) {
            console.error("Error processing file:", error.message);
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});