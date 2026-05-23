const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json({ verify: verifyWebhookSignature }));

// ─── Configuration from Environment Variables ──────────────────────────────
const {
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_BUSINESS_ID,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_APP_SECRET,
  WEBHOOK_VERIFY_TOKEN,
  ZAI_API_KEY,
  PORT = 3000,
} = process.env;

// ─── System Prompt for AI Customer Support Agent ──────────────────────────
const SYSTEM_PROMPT = `You are a friendly, professional customer support agent for a business. You communicate via WhatsApp, so keep your replies concise and conversational. Follow these guidelines:

1. Be warm, helpful, and empathetic at all times.
2. Keep responses short — ideally under 300 characters for simple queries, longer only when necessary.
3. Use a professional yet approachable tone.
4. If you don't know the answer, honestly say so and offer to escalate or follow up.
5. Address the customer by name if available.
6. For complex issues, break the solution into clear steps.
7. Never share sensitive information or make promises you can't keep.
8. Use emojis sparingly and appropriately (😊, ✅, 👍).
9. If the user asks about pricing, hours, or policies, provide general guidance and suggest contacting the team for specifics.
10. Always end with a helpful next step or an open-ended question to continue the conversation.`;

// ─── In-memory conversation store (per phone number) ──────────────────────
const conversations = new Map();
const MAX_CONVERSATION_AGE = 30 * 60 * 1000; // 30 minutes

// Clean up old conversations periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of conversations) {
    if (now - value.lastActivity > MAX_CONVERSATION_AGE) {
      conversations.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ─── WhatsApp Webhook Verification (GET) ──────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[Webhook] Verification request received');

  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('[Webhook] Verification successful ✅');
    res.status(200).send(challenge);
  } else {
    console.log('[Webhook] Verification failed ❌');
    res.status(403).send('Forbidden');
  }
});

// ─── WhatsApp Webhook Handler (POST) ─────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Always acknowledge receipt quickly
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body;

  // Validate this is a WhatsApp message event
  if (
    body.object !== 'whatsapp_business_account' ||
    !body.entry ||
    !body.entry[0]?.changes?.[0]?.value?.messages
  ) {
    return;
  }

  const message = body.entry[0].changes[0].value.messages[0];
  const contact = body.entry[0].changes[0].value.contacts?.[0];

  const from = message.from; // Phone number of the sender
  const messageId = message.id;
  const messageType = message.type;

  // Extract text content
  let text = '';
  if (messageType === 'text') {
    text = message.text.body;
  } else if (messageType === 'interactive' && message.interactive?.type === 'button_reply') {
    text = message.interactive.button_reply.title;
  } else if (messageType === 'interactive' && message.interactive?.type === 'list_reply') {
    text = message.interactive.list_reply.title;
  } else {
    // For unsupported message types, send a friendly response
    await sendWhatsAppMessage(
      from,
      "I received your message, but I can currently only process text messages. Please type your question and I'll be happy to help! 😊"
    );
    return;
  }

  const senderName = contact?.profile?.name || 'there';

  console.log(`[Message] From: ${from} (${senderName}): "${text}"`);

  try {
    // Mark the incoming message as read
    await markMessageAsRead(messageId);

    // Get or create conversation history
    const conversation = getOrCreateConversation(from);
    conversation.messages.push({ role: 'user', content: text });
    conversation.lastActivity = Date.now();

    // Keep only the last 20 messages to avoid token overflow
    if (conversation.messages.length > 20) {
      conversation.messages = conversation.messages.slice(-20);
    }

    // Get AI response
    const aiReply = await getAIResponse(conversation.messages, senderName);

    // Save assistant reply to conversation
    conversation.messages.push({ role: 'assistant', content: aiReply });

    // Send reply via WhatsApp
    await sendWhatsAppMessage(from, aiReply);

    console.log(`[Reply] To: ${from}: "${aiReply.substring(0, 80)}..."`);
  } catch (error) {
    console.error('[Error] Processing message:', error.message);
    // Send a fallback message on error
    try {
      await sendWhatsAppMessage(
        from,
        "I'm sorry, I encountered an error processing your message. Please try again in a moment. 🙏"
      );
    } catch (sendError) {
      console.error('[Error] Sending fallback message:', sendError.message);
    }
  }
});

// ─── Health Check Endpoint ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    conversations: conversations.size,
    timestamp: new Date().toISOString(),
  });
});

// ─── AI Response via Z.ai GLM Model ──────────────────────────────────────
async function getAIResponse(messages, senderName) {
  const apiMessages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT + `\n\nThe customer's name is ${senderName}. Address them naturally.`,
    },
    ...messages,
  ];

  try {
    const response = await axios.post(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      {
        model: 'glm-4-flash',
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 512,
        top_p: 0.9,
      },
      {
        headers: {
          Authorization: `Bearer ${ZAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error('Empty response from AI model');
    }
    return reply.trim();
  } catch (error) {
    if (error.response) {
      console.error('[AI Error] Status:', error.response.status);
      console.error('[AI Error] Data:', JSON.stringify(error.response.data));
    } else {
      console.error('[AI Error]', error.message);
    }
    throw error;
  }
}

// ─── Send WhatsApp Message ───────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: text,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return response.data;
  } catch (error) {
    console.error('[WhatsApp Send Error]', error.response?.data || error.message);
    throw error;
  }
}

// ─── Mark Message as Read ─────────────────────────────────────────────────
async function markMessageAsRead(messageId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
  } catch (error) {
    // Non-critical — just log it
    console.warn('[Read Receipt] Failed:', error.message);
  }
}

// ─── Conversation Manager ─────────────────────────────────────────────────
function getOrCreateConversation(phoneNumber) {
  if (!conversations.has(phoneNumber)) {
    conversations.set(phoneNumber, {
      messages: [],
      lastActivity: Date.now(),
    });
  }
  return conversations.get(phoneNumber);
}

// ─── Webhook Signature Verification ───────────────────────────────────────
function verifyWebhookSignature(req, res, buf) {
  // Skip verification if no app secret configured
  if (!WHATSAPP_APP_SECRET) return;

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    console.warn('[Webhook] No signature header found');
    return;
  }

  const expectedSignature = crypto
    .createHmac('sha256', WHATSAPP_APP_SECRET)
    .update(buf)
    .digest('hex');

  const signatureHash = signature.split('=')[1];
  if (signatureHash !== expectedSignature) {
    throw new Error('Webhook signature verification failed');
  }
}

// ─── Start Server ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('  🤖 WhatsApp AI Bot — Customer Support Agent');
  console.log('='.repeat(60));
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Webhook URL: /webhook`);
  console.log(`  Health check: /health`);
  console.log(`  AI Model: GLM-4-Flash`);
  console.log('='.repeat(60));
});
