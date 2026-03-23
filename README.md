# Family Finance Bot

A Discord bot for managing family finances with AI-powered natural language expense parsing. Built with Deno, Discordeno, Deno KV, and OpenRouter.

## Features

- **Natural Language Expense Logging**: Use `/expense description:"Bought groceries for $120"`
- **AI-Powered Parsing**: Uses OpenRouter (Llama 3) to intelligently extract amount, category, date, and notes
- **Confirmation System**: Bot shows parsed data with buttons to confirm/cancel before saving
- **Whitelist Security**: Only authorized Discord users can interact with the bot
- **Monthly Summaries**: View spending breakdown by category with `/summary` command
- **Persistent Storage**: All transactions stored in Deno KV database
- **Deno Deploy Compatible**: Works on both local machine and Deno Deploy

## Prerequisites

- **Deno** 2.0 or later (with KV support)
- **Discord Bot** from [Discord Developer Portal](https://discord.com/developers/applications)
- **OpenRouter API Key** from [OpenRouter](https://openrouter.ai/keys)

---

## Local Development Setup

### 1. Clone and Configure

```bash
git clone https://github.com/insydr/family-financial-bot.git
cd family-financial-bot
cp .env.example .env
```

### 2. Edit `.env`

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_server_id
DISCORD_APPLICATION_ID=your_application_id
DISCORD_PUBLIC_KEY=your_public_key
OPENROUTER_API_KEY=your_openrouter_api_key
FAMILY_USER_IDS=user_id_1,user_id_2
```

### 3. Run Locally

```bash
deno task start
# or with auto-reload:
deno task dev
```

---

## Deno Deploy Setup

### Step 1: Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or use existing one
3. Go to **Bot** section → Copy **Token** (`DISCORD_TOKEN`)
4. Go to **General Information** → Copy:
   - **Application ID** (`DISCORD_APPLICATION_ID`)
   - **Public Key** (`DISCORD_PUBLIC_KEY`)

### Step 2: Configure Interactions Endpoint

1. In Discord Developer Portal, go to **General Information**
2. Scroll to **Interactions Endpoint URL**
3. After deploying, enter your Deno Deploy URL:
   ```
   https://your-project-name.deno.dev
   ```
4. Click **Save Changes**

### Step 3: Deploy to Deno Deploy

#### Option A: Via Deno Deploy Dashboard

1. Go to [Deno Deploy Dashboard](https://dash.deno.com/)
2. Click **New Project**
3. Connect your GitHub repository: `insydr/family-financial-bot`
4. Configure settings (see below)

#### Option B: Via Deployctl CLI

```bash
deployctl deploy --project=family-finance-bot mod.ts
```

---

## Deno Deploy Configuration

When setting up in the Deno Deploy dashboard, use these settings:

### Framework Presets

| Setting | Value |
|---------|-------|
| **Framework Preset** | `None` (or `Deno`) |

### Build Settings

| Setting | Value |
|---------|-------|
| **Install Command** | *(Leave empty)* |
| **Build Command** | *(Leave empty)* |
| **Pre-deploy Command** | *(Leave empty)* |
| **Build Timeout** | Default (or 60 seconds) |
| **Build Memory Limit** | Default (256 MB) |

### Runtime Settings

| Setting | Value |
|---------|-------|
| **Entrypoint** | `mod.ts` |
| **Arguments** | *(Leave empty)* |
| **Runtime Working Directory** | `/` (root) |
| **Runtime Memory Limit** | Default or 512 MB |

### Static Site Settings

| Setting | Value |
|---------|-------|
| **Static Directory** | *(Leave empty)* |
| **Single Page App Mode** | Disabled |

### Other Settings

| Setting | Value |
|---------|-------|
| **Disable Cronjob** | Yes (checked) - No cron jobs needed |

---

## Environment Variables (Deno Deploy)

In Deno Deploy dashboard, go to **Settings → Environment Variables** and add:

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token |
| `DISCORD_GUILD_ID` | Your Discord server ID |
| `DISCORD_APPLICATION_ID` | Discord application ID |
| `DISCORD_PUBLIC_KEY` | Discord public key (for HTTP interactions) |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `FAMILY_USER_IDS` | Comma-separated authorized user IDs |

---

## Usage

### Slash Commands

| Command | Description |
|---------|-------------|
| `/expense description:"..."` | Log an expense using natural language |
| `/summary` | Show spending breakdown by category for current month |
| `/help` | Display help information and usage tips |
| `/clear` | Delete all your transaction data |

### Example Expense Descriptions

```
/expense description:"Bought groceries for $120"
/expense description:"Paid electricity bill 50 USD"
/expense description:"Spent ¥500 on train tickets"
/expense description:"Gas $45 at Shell"
/expense description:"Coffee $5.50"
```

### Categories

The AI automatically categorizes expenses into:
- Food
- Transportation
- Utilities
- Entertainment
- Shopping
- Healthcare
- Education
- Housing
- Personal
- Other

---

## Project Structure

```
family-finance-bot/
├── mod.ts          # Main entry point (HTTP server for Deno Deploy)
├── client.ts       # Discord client setup and helpers
├── ai.ts           # OpenRouter AI integration
├── db.ts           # Deno KV database operations
├── utils.ts        # Utility functions and security
├── deno.json       # Deno configuration
├── .env.example    # Environment template
└── README.md       # This file
```

---

## Security Features

1. **Whitelist Authorization**: Only specified Discord user IDs can use the bot
2. **Confirmation System**: All parsed expenses require explicit confirmation
3. **Audit Logging**: All actions are logged with timestamps
4. **Environment Variables**: Sensitive credentials stored securely
5. **No npm Dependencies**: Uses JSR and deno.land/x for supply chain security

---

## Troubleshooting

### Bot Not Responding on Deno Deploy

1. Verify **Interactions Endpoint URL** is set in Discord Developer Portal
2. Check all environment variables are set in Deno Deploy
3. Ensure `DISCORD_PUBLIC_KEY` matches exactly

### Commands Not Registering

1. Check `DISCORD_GUILD_ID` is correct
2. Re-deploy the project after adding the bot to your server
3. Commands may take up to 1 hour to sync globally

### AI Parsing Not Working

1. Verify `OPENROUTER_API_KEY` is set correctly
2. Check your OpenRouter account has credits
3. Test: `curl -H "Authorization: Bearer YOUR_KEY" https://openrouter.ai/api/v1/models`

### Database Errors

1. Deno KV is automatically available on Deno Deploy
2. No additional configuration needed
3. Data persists across deployments

---

## Local vs Deno Deploy

| Feature | Local | Deno Deploy |
|---------|-------|-------------|
| Connection | WebSocket Gateway | HTTP Interactions |
| Message Listening | ✅ Yes | ❌ No |
| Slash Commands | ✅ Yes | ✅ Yes |
| Buttons/Components | ✅ Yes | ✅ Yes |
| KV Database | ✅ Yes | ✅ Yes |
| Auto-scaling | ❌ No | ✅ Yes |
| Always-on | ❌ Manual | ✅ Automatic |

---

## License

MIT License

## Support

For issues or questions, please open an issue on GitHub.
