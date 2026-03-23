/**
 * Family Finance Bot - Main Entry Point (Deno Deploy Compatible)
 * 
 * A Discord bot for managing family finances with AI-powered expense parsing.
 * Uses HTTP Interactions for Deno Deploy compatibility.
 * 
 * @author Family Finance Bot Team
 * @version 1.0.0
 */

import {
  initializeWhitelist,
  isUserAllowed,
  formatCurrency,
  formatMonthYear,
  auditLog,
} from './utils.ts';
import {
  initializeDatabase,
  addTransaction,
  getMonthlySummary,
  getMonthlyTotal,
  clearUserTransactions,
  type Transaction,
} from './db.ts';
import { parseExpenseWithAI, testAIConnection } from './ai.ts';

/**
 * Color constants for embeds.
 */
const COLORS = {
  SUCCESS: 0x22c55e,
  ERROR: 0xef4444,
  WARNING: 0xf59e0b,
  INFO: 0x3b82f6,
};

// Store command definitions for registration
const COMMANDS = {
  help: {
    name: 'help',
    description: 'Show available commands and how to use the bot',
  },
  summary: {
    name: 'summary',
    description: 'Show your spending summary for the current month',
  },
  clear: {
    name: 'clear',
    description: 'Clear all your transaction data',
  },
  expense: {
    name: 'expense',
    description: 'Log a new expense using natural language',
    options: [{
      name: 'description',
      description: 'Describe your expense (e.g., "Bought groceries for $50")',
      type: 3,
      required: true,
    }],
  },
};

// Global config
let applicationId: string;
let botToken: string;

/**
 * Main function - initializes and starts the bot.
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('       Family Finance Bot - Starting Up');
  console.log('═══════════════════════════════════════════════════════');

  const isDenoDeploy = Deno.env.get('DENO_DEPLOYMENT_ID') !== undefined;
  console.log(`[SETUP] Running on ${isDenoDeploy ? 'Deno Deploy' : 'local environment'}`);

  try {
    // 1. Initialize whitelist
    initializeWhitelist();

    // 2. Initialize database
    await initializeDatabase();

    // 3. Test AI connection
    const aiReady = await testAIConnection();
    if (!aiReady) {
      console.warn('[SETUP] AI service not ready - expense parsing may fail');
    }

    // 4. Get required config
    botToken = Deno.env.get('DISCORD_TOKEN') || '';
    applicationId = Deno.env.get('DISCORD_APPLICATION_ID') || '';
    const publicKey = Deno.env.get('DISCORD_PUBLIC_KEY') || '';
    const guildId = Deno.env.get('DISCORD_GUILD_ID') || '';

    if (!botToken || !applicationId || !publicKey || !guildId) {
      throw new Error('Missing required environment variables: DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, DISCORD_GUILD_ID');
    }

    // 5. Register slash commands with Discord API
    console.log('[SETUP] Registering slash commands...');
    await registerCommands(guildId);

    // 6. Start HTTP server
    const port = parseInt(Deno.env.get('PORT') || '8000');
    
    Deno.serve({ port }, (request) => handleInteraction(request, publicKey));

    console.log(`[HTTP] Server listening on port ${port}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('       Family Finance Bot - Ready!');
    console.log('═══════════════════════════════════════════════════════');

  } catch (error) {
    console.error('[SETUP] Failed to initialize bot:', error);
    Deno.exit(1);
  }
}

/**
 * Register slash commands with Discord API.
 */
async function registerCommands(guildId: string): Promise<void> {
  const url = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  
  const commands = [
    {
      name: 'help',
      description: 'Show available commands and how to use the bot',
      type: 1,
    },
    {
      name: 'summary',
      description: 'Show your spending summary for the current month',
      type: 1,
    },
    {
      name: 'clear',
      description: 'Clear all your transaction data',
      type: 1,
    },
    {
      name: 'expense',
      description: 'Log a new expense using natural language',
      type: 1,
      options: [{
        name: 'description',
        description: 'Describe your expense (e.g., "Bought groceries for $50")',
        type: 3,
        required: true,
      }],
    },
  ];

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[DISCORD] Failed to register commands:', response.status, error);
      throw new Error(`Failed to register commands: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[DISCORD] Registered ${data.length} slash commands:`, data.map((c: any) => c.name).join(', '));
  } catch (error) {
    console.error('[DISCORD] Error registering commands:', error);
    throw error;
  }
}

/**
 * Handle incoming Discord Interaction via HTTP.
 */
async function handleInteraction(request: Request, publicKey: string): Promise<Response> {
  // Only accept POST requests
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.text();
    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');

    // Validate signatures exist
    if (!signature || !timestamp) {
      console.warn('[HTTP] Missing signatures');
      return new Response('Missing signatures', { status: 401 });
    }

    // Verify signature using Web Crypto API
    const isValid = await verifySignature(body, signature, timestamp, publicKey);
    if (!isValid) {
      console.warn('[HTTP] Invalid signature');
      return new Response('Invalid signature', { status: 401 });
    }

    const interaction = JSON.parse(body);
    console.log(`[HTTP] Received interaction type: ${interaction.type}`);

    // Handle PING (Discord endpoint URL verification)
    if (interaction.type === 1) {
      console.log('[HTTP] Responding to PING');
      return jsonResponse({ type: 1 });
    }

    // Handle APPLICATION_COMMAND (slash commands)
    if (interaction.type === 2) {
      return await handleSlashCommand(interaction);
    }

    // Handle MESSAGE_COMPONENT (button clicks)
    if (interaction.type === 3) {
      return await handleComponent(interaction);
    }

    console.warn('[HTTP] Unknown interaction type:', interaction.type);
    return new Response('Unknown interaction type', { status: 400 });

  } catch (error) {
    console.error('[HTTP] Error handling interaction:', error);
    return new Response('Internal error', { status: 500 });
  }
}

/**
 * Verify Discord signature using Web Crypto API.
 */
async function verifySignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string
): Promise<boolean> {
  try {
    // Convert hex signature to Uint8Array
    const sigBytes = hexToBytes(signature);
    
    // Convert public key from hex to Uint8Array
    const pubKeyBytes = hexToBytes(publicKey);
    
    // Create message to verify (timestamp + body)
    const message = new TextEncoder().encode(timestamp + body);
    
    // Import public key for Ed25519 verification
    const key = await crypto.subtle.importKey(
      'raw',
      pubKeyBytes,
      { name: 'Ed25519', namedCurve: 'Ed25519' },
      false,
      ['verify']
    );
    
    // Verify signature
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      sigBytes,
      message
    );
  } catch (error) {
    console.error('[CRYPTO] Signature verification error:', error);
    return false;
  }
}

/**
 * Convert hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Create a JSON response.
 */
function jsonResponse(data: any): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle slash command interactions.
 */
async function handleSlashCommand(interaction: any): Promise<Response> {
  const userId = BigInt(interaction.member?.user?.id || interaction.user?.id || '0');
  const commandName = interaction.data?.name;

  console.log(`[COMMAND] User ${userId} executed /${commandName}`);

  // Security check
  if (!isUserAllowed(userId)) {
    return jsonResponse({
      type: 4,
      data: {
        content: '❌ You are not authorized to use this bot.',
        flags: 64,
      },
    });
  }

  auditLog('COMMAND', userId, commandName || 'unknown');

  switch (commandName) {
    case 'summary':
      return await handleSummaryCommand(userId);
    case 'help':
      return handleHelpCommand();
    case 'clear':
      return await handleClearCommand(userId);
    case 'expense':
      return await handleExpenseCommand(interaction, userId);
    default:
      return jsonResponse({
        type: 4,
        data: { content: 'Unknown command.', flags: 64 },
      });
  }
}

/**
 * Handle button/component interactions.
 */
async function handleComponent(interaction: any): Promise<Response> {
  const userId = BigInt(interaction.member?.user?.id || interaction.user?.id || '0');
  const customId = interaction.data?.custom_id;

  console.log(`[COMPONENT] User ${userId} clicked: ${customId}`);

  if (!isUserAllowed(userId)) {
    return jsonResponse({
      type: 4,
      data: { content: '❌ Unauthorized.', flags: 64 },
    });
  }

  if (customId?.startsWith('confirm:')) {
    const transactionJson = customId.replace('confirm:', '');
    try {
      const transaction: Transaction = JSON.parse(decodeURIComponent(transactionJson));
      await addTransaction(userId, transaction);

      return jsonResponse({
        type: 4,
        data: {
          content: `✅ **Saved!** Recorded ${formatCurrency(transaction.amount, transaction.currency)} for **${transaction.category}**.`,
        },
      });
    } catch (error) {
      console.error('[COMPONENT] Error saving transaction:', error);
      return jsonResponse({
        type: 4,
        data: { content: '❌ Failed to save transaction.', flags: 64 },
      });
    }
  }

  if (customId === 'cancel') {
    return jsonResponse({
      type: 4,
      data: { content: '❌ Transaction cancelled.' },
    });
  }

  return jsonResponse({
    type: 4,
    data: { content: 'Unknown action.' },
  });
}

/**
 * Handle /summary command.
 */
async function handleSummaryCommand(userId: bigint): Promise<Response> {
  try {
    const summaries = await getMonthlySummary(userId);
    const total = await getMonthlyTotal(userId);

    if (summaries.length === 0) {
      return jsonResponse({
        type: 4,
        data: {
          content: `📊 No expenses recorded for ${formatMonthYear()}. Start logging your expenses!`,
        },
      });
    }

    const fields = summaries.slice(0, 10).map((s) => ({
      name: s.category,
      value: `${formatCurrency(s.total)} (${s.count} transaction${s.count > 1 ? 's' : ''})`,
      inline: true,
    }));

    return jsonResponse({
      type: 4,
      data: {
        embeds: [{
          title: `📊 Monthly Summary - ${formatMonthYear()}`,
          description: `**Total Spent:** ${formatCurrency(total)}`,
          color: COLORS.INFO,
          fields,
        }],
      },
    });
  } catch (error) {
    console.error('[COMMAND] Error in summary command:', error);
    return jsonResponse({
      type: 4,
      data: { content: '❌ Failed to generate summary.', flags: 64 },
    });
  }
}

/**
 * Handle /help command.
 */
function handleHelpCommand(): Response {
  const helpText = `💰 **Family Finance Bot - Help**

**How to Log Expenses:**
Use \`/expense description:"Bought groceries for $120"\`

**Commands:**
• \`/expense\` - Log a new expense using natural language
• \`/summary\` - View your spending by category for this month
• \`/help\` - Show this help message
• \`/clear\` - Delete all your transaction data

**Categories:**
Food, Transportation, Utilities, Entertainment, Shopping, Healthcare, Education, Housing, Personal, Other

**Tips:**
• The bot will ask you to confirm before saving
• Click ✅ to save or ❌ to cancel`;

  return jsonResponse({
    type: 4,
    data: { content: helpText },
  });
}

/**
 * Handle /clear command.
 */
async function handleClearCommand(userId: bigint): Promise<Response> {
  try {
    await clearUserTransactions(userId);
    return jsonResponse({
      type: 4,
      data: { content: '🗑️ All your transaction data has been cleared.', flags: 64 },
    });
  } catch (error) {
    console.error('[COMMAND] Error in clear command:', error);
    return jsonResponse({
      type: 4,
      data: { content: '❌ Failed to clear transactions.', flags: 64 },
    });
  }
}

/**
 * Handle /expense command.
 */
async function handleExpenseCommand(interaction: any, userId: bigint): Promise<Response> {
  const description = interaction.data?.options?.[0]?.value;

  if (!description) {
    return jsonResponse({
      type: 4,
      data: { content: '❌ Please provide an expense description.', flags: 64 },
    });
  }

  console.log(`[EXPENSE] Parsing: "${description}"`);
  auditLog('EXPENSE_PARSE', userId, description.substring(0, 50));

  const parsed = await parseExpenseWithAI(description);

  if (!parsed.success) {
    return jsonResponse({
      type: 4,
      data: {
        content: `❌ ${parsed.error || 'Could not parse your expense.'}\n\nTry: "Bought groceries for $50"`,
      },
    });
  }

  const transaction: Transaction = {
    amount: parsed.amount!,
    category: parsed.category!,
    date: parsed.date!,
    note: parsed.note || description,
    currency: parsed.currency,
  };

  const transactionJson = encodeURIComponent(JSON.stringify(transaction));

  return jsonResponse({
    type: 4,
    data: {
      content: `📝 **I understood:**\n💰 **Amount:** ${formatCurrency(transaction.amount, transaction.currency)}\n📁 **Category:** ${transaction.category}\n📅 **Date:** ${transaction.date}\n📝 **Note:** ${transaction.note}\n\nClick a button to confirm or cancel.`,
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: '✅ Confirm',
            custom_id: `confirm:${transactionJson}`,
          },
          {
            type: 2,
            style: 4,
            label: '❌ Cancel',
            custom_id: 'cancel',
          },
        ],
      }],
    },
  });
}

// Start the bot
main().catch((error) => {
  console.error('[FATAL] Unhandled error:', error);
  Deno.exit(1);
});
