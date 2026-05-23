# WhatsApp AI Bot — Customer Support Agent

An AI-powered WhatsApp chatbot that automatically replies to incoming messages using the GLM-4-Flash model. It acts as a friendly, professional customer support agent.

## Features

- 🤖 AI-powered responses using GLM-4-Flash model
- 💬 Multi-turn conversation with context memory
- ✅ Automatic message read receipts
- 🔄 Webhook signature verification for security
- 🧹 Auto-cleanup of stale conversations
- ❤️ Health check endpoint for monitoring
- 🚀 Deploy-ready for Render, Railway, or any Node.js host

## Architecture

```
WhatsApp User → Meta Cloud API → Webhook (this bot) → Z.ai GLM Model → Reply back
```

## Setup

### 1. Prerequisites

- A [Meta Developer](https://developers.facebook.com/) account with a WhatsApp Business app
- A [Z.ai](https://open.bigmodel.cn/) API key
- Node.js 18+

### 2. Environment Variables

Create a `.env` file or set these in your hosting platform:

| Variable | Description |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Your WhatsApp Business Phone Number ID |
| `WHATSAPP_BUSINESS_ID` | Your WhatsApp Business Account ID |
| `WHATSAPP_ACCESS_TOKEN` | Permanent access token for WhatsApp API |
| `WHATSAPP_APP_SECRET` | App secret from Meta dashboard (for signature verification) |
| `WEBHOOK_VERIFY_TOKEN` | Custom token you set when configuring the webhook |
| `ZAI_API_KEY` | Your Z.ai API key for the GLM model |
| `PORT` | Server port (default: 3000) |

### 3. Local Development

```bash
# Install dependencies
npm install

# Set environment variables
export WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
export WHATSAPP_ACCESS_TOKEN=your_access_token
export WEBHOOK_VERIFY_TOKEN=your_verify_token
export ZAI_API_KEY=your_zai_api_key

# Run the bot
npm start
```

For development with auto-restart:

```bash
npm run dev
```

### 4. Configure WhatsApp Webhook

1. In your Meta App Dashboard, go to **WhatsApp → Configuration**
2. Click **Edit** on the Webhook field
3. Enter your callback URL: `https://your-domain.com/webhook`
4. Enter the verify token you set as `WEBHOOK_VERIFY_TOKEN`
5. Subscribe to **messages** events

### 5. Deploy on Render

1. Push this repo to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Create a new **Web Service**
4. Connect your GitHub repository
5. Set the following:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. Add all environment variables from the table above
7. Deploy!

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/webhook` | GET | WhatsApp webhook verification |
| `/webhook` | POST | Receive and process WhatsApp messages |
| `/health` | GET | Health check and bot status |

## How It Works

1. A user sends a message to your WhatsApp Business number
2. Meta forwards the message to your `/webhook` endpoint
3. The bot extracts the text and maintains conversation context
4. The message is sent to GLM-4-Flash with a customer support system prompt
5. The AI response is sent back to the user via WhatsApp API
6. The incoming message is marked as read

## Customization

- **System Prompt**: Edit the `SYSTEM_PROMPT` constant in `server.js` to change the bot's personality and behavior
- **AI Model**: Change the `model` parameter in `getAIResponse()` to use different GLM models (e.g., `glm-4`, `glm-4-plus`)
- **Conversation Memory**: Adjust `MAX_CONVERSATION_AGE` and message limit in the conversation manager

## License

MIT
