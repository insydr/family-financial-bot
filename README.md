# Family Finance Bot

A Discord bot for managing family finances with AI-powered natural language expense parsing. Built with Deno, Discordeno, Deno KV, and OpenRouter.

## Features

- **Natural Language Expense Logging**: Simply type messages like "Bought groceries for $120" or "Paid electricity bill 50 USD"
- **AI-Powered Parsing**: Uses OpenRouter (Llama 3) to intelligently extract amount, category, date, and notes
- **Confirmation System**: Bot shows parsed data and asks for confirmation before saving
- **Whitelist Security**: Only authorized Discord users can interact with the bot
- **Monthly Summaries**: View spending breakdown by category with `/summary` command
- **Persistent Storage**: All transactions stored in Deno KV database

## Prerequisites

- **Deno** 2.0 or later (with KV support)
- **Discord Bot Token** from [Discord Developer Portal](https://discord.com/developers/applications)
- **OpenRouter API Key** from [OpenRouter](https://openrouter.ai/keys)

## Setup

### 1. Clone the Repository

```bash
cd family-finance-bot
```

### 2. Create Environment File

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_server_id
OPENROUTER_API_KEY=your_openrouter_api_key
FAMILY_USER_IDS=user_id_1,user_id_2
```

### 3. Get Your Discord IDs

1. Open Discord Settings → Advanced → Enable Developer Mode
2. Right-click your server → Copy Server ID (for `DISCORD_GUILD_ID`)
3. Right-click each family member → Copy User ID (for `FAMILY_USER_IDS`)

### 4. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and name it
3. Go to "Bot" section and click "Add Bot"
4. Copy the token for `DISCORD_TOKEN`
5. Enable these Privileged Gateway Intents:
   - Message Content Intent
   - Server Members Intent (optional)
6. Go to OAuth2 → URL Generator
7. Select: `bot` scope, `Send Messages`, `Read Message History`, `Add Reactions`, `Use Slash Commands` permissions
8. Use the generated URL to invite the bot to your server

## Running the Bot

### Development Mode (with auto-reload)

```bash
deno task dev
```

### Production Mode

```bash
deno task start
```

### Manual Run with All Permissions

```bash
deno run --allow-env --allow-net --allow-read --allow-sys --unstable-kv mod.ts
```

**Permission Flags Explained:**
- `--allow-env`: Read environment variables (API keys, user IDs)
- `--allow-net`: Network access for Discord and OpenRouter APIs
- `--allow-read`: Read `.env` file
- `--allow-sys`: System information access
- `--unstable-kv`: Enable Deno KV database support

## Usage

### Logging Expenses

Simply type natural language messages:

```
Bought groceries for $120
Paid electricity bill 50 USD
Spent ¥500 on train tickets
Gas $45 at Shell
Coffee $5.50
```

The bot will:
1. Parse your message using AI
2. Show what it understood
3. Ask for confirmation with ✅/❌ reactions
4. Save the transaction upon confirmation

### Slash Commands

| Command | Description |
|---------|-------------|
| `/summary` | Show spending breakdown by category for current month |
| `/help` | Display help information and usage tips |
| `/clear` | Delete all your transaction data |

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

## Project Structure

```
family-finance-bot/
├── mod.ts          # Main entry point, event handlers
├── client.ts       # Discord client setup and helpers
├── ai.ts           # OpenRouter AI integration
├── db.ts           # Deno KV database operations
├── utils.ts        # Utility functions and security
├── deno.json       # Deno configuration
├── .env.example    # Environment template
└── README.md       # This file
```

## Security Features

1. **Whitelist Authorization**: Only specified Discord user IDs can use the bot
2. **Confirmation System**: All parsed expenses require explicit confirmation
3. **Audit Logging**: All actions are logged with timestamps
4. **Environment Variables**: Sensitive credentials stored securely
5. **No npm Dependencies**: Uses JSR and deno.land/x for supply chain security

## Error Handling

The bot handles various error scenarios gracefully:

- **API Failures**: Shows user-friendly error messages
- **Invalid Input**: Guides users on correct format
- **Database Issues**: Prevents data loss and reports errors
- **Network Problems**: Retries and informs users of delays

## Data Storage

Transactions are stored in Deno KV with the following structure:

- **Key**: `["transactions", userId, timestamp]`
- **Value**: `{ amount, category, date, note, currency }`

This allows efficient querying by user and time range.

## Troubleshooting

### Bot Not Responding

1. Check if the bot is online in Discord
2. Verify your user ID is in `FAMILY_USER_IDS`
3. Ensure Message Content Intent is enabled in Discord Developer Portal
4. Check console logs for errors

### AI Parsing Not Working

1. Verify `OPENROUTER_API_KEY` is set correctly
2. Check your OpenRouter account has credits
3. Test API key: `curl -H "Authorization: Bearer YOUR_KEY" https://openrouter.ai/api/v1/models`

### Database Errors

1. Ensure you're using Deno 2.0+ with KV support
2. Check file permissions for KV storage
3. The `--unstable-kv` flag is required

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - See LICENSE file for details.

## Support

For issues or questions, please open an issue on GitHub.
