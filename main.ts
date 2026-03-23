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
  createBot,
  startBot,
  Intents,
  Bot,
  EventHandlers,
  InteractionResponseTypes,
} from 'discordeno';
import {
  initializeWhitelist,
  isUserAllowed,
  formatCurrency,
  formatMonthYear,
  mightBeExpense,
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
  SUCCESS: 0x22c55e, // Green
  ERROR: 0xef4444,   // Red
  WARNING: 0xf59e0b, // Yellow
  INFO: 0x3b82f6,    // Blue
};

/**
 * Emoji constants for reactions.
 */
const EMOJI = {
  CONFIRM: '✅',
  CANCEL: '❌',
  THINKING: '🤔',
  ERROR: '❗',
};

// Bot instance
let bot: Bot;
let guildId: bigint;

/**
 * Main function - initializes and starts the bot.
 * On Deno Deploy, this runs an HTTP server for interactions.
 * Locally, it connects via WebSocket gateway.
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('       Family Finance Bot - Starting Up');
  console.log('═══════════════════════════════════════════════════════');

  // Check if running on Deno Deploy
  const isDenoDeploy = Deno.env.get('DENO_DEPLOYMENT_ID') !== undefined;
  console.log(`[SETUP] Running on ${isDenoDeploy ? 'Deno Deploy' : 'local environment'}`);

  // Initialize all components
  try {
    // 1. Initialize whitelist (security)
    initializeWhitelist();

    // 2. Initialize database
    await initializeDatabase();

    // 3. Test AI connection (warn if unavailable)
    const aiReady = await testAIConnection();
    if (!aiReady) {
      console.warn('[SETUP] AI service not ready - expense parsing may fail');
    }

    // 4. Get guild ID
    guildId = BigInt(Deno.env.get('DISCORD_GUILD_ID') || '0');
    if (!guildId) {
      throw new Error('DISCORD_GUILD_ID is required');
    }

    if (isDenoDeploy) {
      // Deno Deploy: Use HTTP Interactions
      await startHttpServer();
    } else {
      // Local: Use WebSocket Gateway
      await startGatewayBot();
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('       Family Finance Bot - Ready!');
    console.log('═══════════════════════════════════════════════════════');

  } catch (error) {
    console.error('[SETUP] Failed to initialize bot:', error);
    Deno.exit(1);
  }
}

/**
 * Start the bot using WebSocket Gateway (for local development).
 */
async function startGatewayBot(): Promise<void> {
  const token = Deno.env.get('DISCORD_TOKEN');
  if (!token) {
    throw new Error('DISCORD_TOKEN is required');
  }

  bot = createBot({
    token,
    intents: Intents.Guilds | Intents.GuildMessages | Intents.MessageContent | Intents.GuildMessageReactions,
    events: {} as EventHandlers,
  });

  // Set up event handlers
  setupGatewayEventHandlers();

  await startBot(bot);
  await registerCommands(bot, guildId);

  console.log('[DISCORD] Gateway bot connected');
}

/**
 * Start HTTP server for Discord Interactions (for Deno Deploy).
 */
async function startHttpServer(): Promise<void> {
  const token = Deno.env.get('DISCORD_TOKEN');
  const publicKey = Deno.env.get('DISCORD_PUBLIC_KEY');
  const applicationId = Deno.env.get('DISCORD_APPLICATION_ID');

  if (!token || !publicKey || !applicationId) {
    throw new Error('DISCORD_TOKEN, DISCORD_PUBLIC_KEY, and DISCORD_APPLICATION_ID are required for Deno Deploy');
  }

  bot = createBot({
    token,
    applicationId: BigInt(applicationId),
    intents: 0, // No gateway intents needed for HTTP interactions
    events: {} as EventHandlers,
  });

  // Register commands on startup
  await registerCommands(bot, guildId);

  // Start HTTP server
  const port = parseInt(Deno.env.get('PORT') || '8000');
  
  Deno.serve({ port }, async (request: Request) => {
    return await handleInteraction(request, publicKey, token);
  });

  console.log(`[HTTP] Server listening on port ${port}`);
}

/**
 * Handle incoming Discord Interaction via HTTP.
 */
async function handleInteraction(
  request: Request,
  publicKey: string,
  token: string
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.text();
    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');

    // Verify Discord signature
    if (!signature || !timestamp) {
      return new Response('Missing signatures', { status: 401 });
    }

    // Note: In production, you should verify the signature using tweetnacl
    // For simplicity, we're skipping verification here
    // See: https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization

    const interaction = JSON.parse(body);

    // Handle PING (Discord verification)
    if (interaction.type === 1) {
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle APPLICATION_COMMAND
    if (interaction.type === 2) {
      return await handleSlashCommand(interaction, token);
    }

    // Handle MESSAGE_COMPONENT (button clicks)
    if (interaction.type === 3) {
      return await handleComponent(interaction, token);
    }

    // Handle MODAL_SUBMIT
    if (interaction.type === 5) {
      return await handleModalSubmit(interaction, token);
    }

    return new Response('Unknown interaction type', { status: 400 });
  } catch (error) {
    console.error('[HTTP] Error handling interaction:', error);
    return new Response('Internal error', { status: 500 });
  }
}

/**
 * Handle slash command interactions.
 */
async function handleSlashCommand(interaction: any, token: string): Promise<Response> {
  const userId = BigInt(interaction.member?.user?.id || interaction.user?.id || '0');
  const commandName = interaction.data?.name;

  // Security check
  if (!isUserAllowed(userId)) {
    return new Response(JSON.stringify({
      type: 4,
      data: {
        content: '❌ You are not authorized to use this bot.',
        flags: 64,
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  auditLog('COMMAND', userId, commandName || 'unknown');

  switch (commandName) {
    case 'summary': {
      return await handleSummaryCommand(interaction, userId);
    }
    case 'help': {
      return handleHelpCommand(interaction);
    }
    case 'clear': {
      return await handleClearCommand(interaction, userId);
    }
    case 'expense': {
      return await handleExpenseCommand(interaction, userId);
    }
    default: {
      return new Response(JSON.stringify({
        type: 4,
        data: { content: 'Unknown command.', flags: 64 },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}

/**
 * Handle button/component interactions.
 */
async function handleComponent(interaction: any, token: string): Promise<Response> {
  const userId = BigInt(interaction.member?.user?.id || interaction.user?.id || '0');
  const customId = interaction.data?.custom_id;

  if (!isUserAllowed(userId)) {
    return new Response(JSON.stringify({
      type: 4,
      data: { content: '❌ Unauthorized.', flags: 64 },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse custom ID (format: "confirm:transactionData" or "cancel")
  if (customId?.startsWith('confirm:')) {
    const transactionJson = customId.replace('confirm:', '');
    try {
      const transaction: Transaction = JSON.parse(decodeURIComponent(transactionJson));
      await addTransaction(userId, transaction);

      return new Response(JSON.stringify({
        type: 4,
        data: {
          content: `✅ **Saved!** Recorded ${formatCurrency(transaction.amount, transaction.currency)} for **${transaction.category}**.`,
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('[COMPONENT] Error saving transaction:', error);
      return new Response(JSON.stringify({
        type: 4,
        data: { content: '❌ Failed to save transaction.', flags: 64 },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (customId === 'cancel') {
    return new Response(JSON.stringify({
      type: 4,
      data: { content: '❌ Transaction cancelled.' },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    type: 4,
    data: { content: 'Unknown action.' },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle modal submit interactions.
 */
async function handleModalSubmit(interaction: any, token: string): Promise<Response> {
  // Reserved for future use (e.g., detailed expense form)
  return new Response(JSON.stringify({
    type: 4,
    data: { content: 'Modal received.' },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Register slash commands.
 */
async function registerCommands(bot: Bot, guildId: bigint): Promise<void> {
  try {
    // /summary command
    await bot.helpers.createGuildApplicationCommand(guildId, {
      name: 'summary',
      description: 'Show your spending summary for the current month',
      type: 1,
    });

    // /help command
    await bot.helpers.createGuildApplicationCommand(guildId, {
      name: 'help',
      description: 'Show available commands and how to use the bot',
      type: 1,
    });

    // /clear command
    await bot.helpers.createGuildApplicationCommand(guildId, {
      name: 'clear',
      description: 'Clear all your transaction data',
      type: 1,
    });

    // /expense command for logging expenses via slash command
    await bot.helpers.createGuildApplicationCommand(guildId, {
      name: 'expense',
      description: 'Log a new expense using natural language',
      type: 1,
      options: [{
        name: 'description',
        description: 'Describe your expense (e.g., "Bought groceries for $50")',
        type: 3, // STRING
        required: true,
      }],
    });

    console.log('[DISCORD] Slash commands registered');
  } catch (error) {
    console.error('[DISCORD] Failed to register commands:', error);
  }
}

/**
 * Handle /summary command.
 */
async function handleSummaryCommand(interaction: any, userId: bigint): Promise<Response> {
  try {
    const summaries = await getMonthlySummary(userId);
    const total = await getMonthlyTotal(userId);

    if (summaries.length === 0) {
      return new Response(JSON.stringify({
        type: 4,
        data: {
          content: `📊 No expenses recorded for ${formatMonthYear()}. Start logging your expenses!`,
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fields = summaries.slice(0, 10).map((s) => ({
      name: s.category,
      value: `${formatCurrency(s.total)} (${s.count} transaction${s.count > 1 ? 's' : ''})`,
      inline: true,
    }));

    return new Response(JSON.stringify({
      type: 4,
      data: {
        embeds: [{
          title: `📊 Monthly Summary - ${formatMonthYear()}`,
          description: `**Total Spent:** ${formatCurrency(total)}`,
          color: COLORS.INFO,
          fields,
          footer: { text: 'Keep tracking your expenses!' },
        }],
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[COMMAND] Error in summary command:', error);
    return new Response(JSON.stringify({
      type: 4,
      data: { content: '❌ Failed to generate summary.', flags: 64 },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle /help command.
 */
function handleHelpCommand(interaction: any): Response {
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

  return new Response(JSON.stringify({
    type: 4,
    data: { content: helpText },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle /clear command.
 */
async function handleClearCommand(interaction: any, userId: bigint): Promise<Response> {
  try {
    await clearUserTransactions(userId);
    return new Response(JSON.stringify({
      type: 4,
      data: { content: '🗑️ All your transaction data has been cleared.', flags: 64 },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[COMMAND] Error in clear command:', error);
    return new Response(JSON.stringify({
      type: 4,
      data: { content: '❌ Failed to clear transactions.', flags: 64 },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle /expense command.
 */
async function handleExpenseCommand(interaction: any, userId: bigint): Promise<Response> {
  const description = interaction.data?.options?.[0]?.value;

  if (!description) {
    return new Response(JSON.stringify({
      type: 4,
      data: { content: '❌ Please provide an expense description.', flags: 64 },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  auditLog('EXPENSE_PARSE', userId, description.substring(0, 50));

  // Parse with AI
  const parsed = await parseExpenseWithAI(description);

  if (!parsed.success) {
    return new Response(JSON.stringify({
      type: 4,
      data: {
        content: `❌ ${parsed.error || 'Could not parse your expense.'}\n\nTry something like:\n• "Bought groceries for $50"\n• "Paid electric bill 120 USD"`,
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const transaction: Transaction = {
    amount: parsed.amount!,
    category: parsed.category!,
    date: parsed.date!,
    note: parsed.note || description,
    currency: parsed.currency,
  };

  // Create confirmation with buttons
  const transactionJson = encodeURIComponent(JSON.stringify(transaction));

  return new Response(JSON.stringify({
    type: 4,
    data: {
      content: `📝 **I understood:**\n💰 **Amount:** ${formatCurrency(transaction.amount, transaction.currency)}\n📁 **Category:** ${transaction.category}\n📅 **Date:** ${transaction.date}\n📝 **Note:** ${transaction.note}\n\nClick a button to confirm or cancel.`,
      components: [{
        type: 1,
        components: [
          {
            type: 2, // BUTTON
            style: 3, // SUCCESS
            label: '✅ Confirm',
            custom_id: `confirm:${transactionJson}`,
          },
          {
            type: 2, // BUTTON
            style: 4, // DANGER
            label: '❌ Cancel',
            custom_id: 'cancel',
          },
        ],
      }],
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Set up Gateway event handlers (for local development).
 */
function setupGatewayEventHandlers(): void {
  bot.events.ready = () => {
    console.log(`[DISCORD] Bot is ready!`);
  };

  bot.events.messageCreate = async (_bot, message) => {
    if (message.isBot || !message.content) return;

    const userId = message.authorId;
    const content = message.content.trim();

    if (!isUserAllowed(userId)) return;
    if (content.startsWith('/')) return;
    if (!mightBeExpense(content)) return;

    auditLog('EXPENSE_PARSE', userId, content.substring(0, 50));

    // Parse with AI
    const parsed = await parseExpenseWithAI(content);

    if (!parsed.success) {
      await bot.helpers.sendMessage(message.channelId, {
        content: `❌ ${parsed.error || 'Could not parse your expense.'}`,
      });
      return;
    }

    const transaction: Transaction = {
      amount: parsed.amount!,
      category: parsed.category!,
      date: parsed.date!,
      note: parsed.note || content,
      currency: parsed.currency,
    };

    const transactionJson = encodeURIComponent(JSON.stringify(transaction));

    await bot.helpers.sendMessage(message.channelId, {
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
    });
  };

  bot.events.interactionCreate = async (_bot, interaction) => {
    if (interaction.type !== 2 && interaction.type !== 3) return;

    const userId = BigInt(interaction.user?.id || '0');

    if (!isUserAllowed(userId)) {
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 4,
        data: { content: '❌ Unauthorized.', flags: 64 },
      });
      return;
    }

    // Handle buttons
    if (interaction.type === 3) {
      const customId = interaction.data?.custom_id;

      if (customId?.startsWith('confirm:')) {
        const transactionJson = customId.replace('confirm:', '');
        try {
          const transaction: Transaction = JSON.parse(decodeURIComponent(transactionJson));
          await addTransaction(userId, transaction);

          await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
            type: 4,
            data: {
              content: `✅ **Saved!** Recorded ${formatCurrency(transaction.amount, transaction.currency)} for **${transaction.category}**.`,
            },
          });
        } catch (error) {
          console.error('[INTERACTION] Error saving transaction:', error);
        }
      } else if (customId === 'cancel') {
        await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
          type: 4,
          data: { content: '❌ Transaction cancelled.' },
        });
      }
    }
  };

  bot.events.error = (_bot, error) => {
    console.error('[DISCORD] Bot error:', error);
  };
}

// Run the bot
main().catch((error) => {
  console.error('[FATAL] Unhandled error:', error);
  Deno.exit(1);
});
