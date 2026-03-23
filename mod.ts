/**
 * Family Finance Bot - Main Entry Point
 * 
 * A Discord bot for managing family finances with AI-powered expense parsing.
 * Uses Deno KV for storage and OpenRouter for natural language processing.
 * 
 * @author Family Finance Bot Team
 * @version 1.0.0
 */

import { load } from 'std/dotenv';
import {
  createDiscordClient,
  connectBot,
  registerCommands,
  sendMessage,
  sendEmbed,
  addReaction,
  getGuildId,
} from './client.ts';
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
  storePendingConfirmation,
  getPendingConfirmation,
  removePendingConfirmation,
  clearUserTransactions,
  type Transaction,
  type PendingConfirmation,
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

// Store pending confirmations in memory for quick access
// Map of userId -> Map of messageId -> confirmation
const pendingConfirmationsCache = new Map<bigint, Map<bigint, PendingConfirmation>>();

/**
 * Main function - initializes and starts the bot.
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('       Family Finance Bot - Starting Up');
  console.log('═══════════════════════════════════════════════════════');

  // Load environment variables from .env file
  try {
    await load({ export: true });
    console.log('[SETUP] Environment variables loaded from .env');
  } catch {
    console.log('[SETUP] No .env file found, using system environment');
  }

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

    // 4. Create and configure Discord client
    const bot = createDiscordClient();
    const guildId = getGuildId();

    // Set up event handlers
    setupEventHandlers(bot, guildId);

    // 5. Connect to Discord
    await connectBot(bot);

    // 6. Register slash commands
    await registerCommands(bot, guildId);

    console.log('═══════════════════════════════════════════════════════');
    console.log('       Family Finance Bot - Ready!');
    console.log('═══════════════════════════════════════════════════════');

    // Handle graceful shutdown
    setupShutdownHandlers();

  } catch (error) {
    console.error('[SETUP] Failed to initialize bot:', error);
    Deno.exit(1);
  }
}

/**
 * Set up Discord event handlers.
 */
function setupEventHandlers(bot: ReturnType<typeof createDiscordClient>, guildId: bigint): void {
  // Handle ready event
  bot.events.ready = () => {
    console.log(`[DISCORD] Bot is ready! Serving guild: ${guildId}`);
  };

  // Handle new messages
  bot.events.messageCreate = async (_bot, message) => {
    // Ignore bot messages
    if (message.isBot) return;

    // Ignore empty messages
    if (!message.content) return;

    const userId = message.authorId;
    const channelId = message.channelId;
    const content = message.content.trim();

    // Check if user is allowed (whitelist security)
    if (!isUserAllowed(userId)) {
      // Silently ignore unauthorized users (or optionally send a message)
      return;
    }

    // Handle slash commands (these come as messages with specific format)
    if (content.startsWith('/')) {
      // Let slash command handler deal with it
      return;
    }

    // Check if this might be an expense message
    if (!mightBeExpense(content)) {
      // Not an expense, don't process
      return;
    }

    auditLog('EXPENSE_PARSE', userId, content.substring(0, 50));

    // Show "thinking" reaction
    await addReaction(bot, channelId, message.id, EMOJI.THINKING);

    // Parse with AI
    const parsed = await parseExpenseWithAI(content);

    if (!parsed.success) {
      await sendMessage(
        bot,
        channelId,
        `❌ ${parsed.error || 'Could not parse your expense.'}\n\nTry saying something like:\n• "Bought groceries for $50"\n• "Paid electric bill 120 USD"`
      );
      return;
    }

    // Create confirmation message
    const transaction: Transaction = {
      amount: parsed.amount!,
      category: parsed.category!,
      date: parsed.date!,
      note: parsed.note || content,
      currency: parsed.currency,
    };

    const confirmationMessage = `📝 **I understood:**\n` +
      `💰 **Amount:** ${formatCurrency(transaction.amount, transaction.currency)}\n` +
      `📁 **Category:** ${transaction.category}\n` +
      `📅 **Date:** ${transaction.date}\n` +
      `📝 **Note:** ${transaction.note}\n\n` +
      `React with ${EMOJI.CONFIRM} to confirm or ${EMOJI.CANCEL} to cancel.`;

    // Send confirmation message
    const sentMessage = await bot.helpers.sendMessage(channelId, { content: confirmationMessage });
    
    // Store pending confirmation
    const confirmation: PendingConfirmation = {
      transaction,
      createdAt: Date.now(),
      originalMessage: content,
    };

    await storePendingConfirmation(userId, sentMessage.id, confirmation);
    
    // Cache for quick access
    let userConfirmations = pendingConfirmationsCache.get(userId);
    if (!userConfirmations) {
      userConfirmations = new Map();
      pendingConfirmationsCache.set(userId, userConfirmations);
    }
    userConfirmations.set(sentMessage.id, confirmation);

    // Add reaction options
    await addReaction(bot, channelId, sentMessage.id, EMOJI.CONFIRM);
    await addReaction(bot, channelId, sentMessage.id, EMOJI.CANCEL);
  };

  // Handle reactions for confirmations
  bot.events.reactionAdd = async (_bot, payload) => {
    const userId = payload.userId;
    const messageId = payload.messageId;
    const channelId = payload.channelId;
    const emoji = payload.emoji.name;

    // Only handle confirm/cancel reactions
    if (emoji !== EMOJI.CONFIRM && emoji !== EMOJI.CANCEL) return;

    // Check if user is allowed
    if (!isUserAllowed(userId)) return;

    // Get pending confirmation
    let confirmation = pendingConfirmationsCache.get(userId)?.get(messageId);
    if (!confirmation) {
      confirmation = await getPendingConfirmation(userId, messageId);
    }

    if (!confirmation) {
      // No pending confirmation, ignore
      return;
    }

    auditLog('REACTION', userId, `${emoji} for ${confirmation.transaction.amount}`);

    if (emoji === EMOJI.CONFIRM) {
      // User confirmed - save the transaction
      try {
        await addTransaction(userId, confirmation.transaction);
        
        await sendMessage(
          bot,
          channelId,
          `✅ **Saved!** Recorded ${formatCurrency(confirmation.transaction.amount, confirmation.transaction.currency)} for **${confirmation.transaction.category}**.`
        );
      } catch (error) {
        await sendMessage(
          bot,
          channelId,
          `❌ Failed to save transaction. Please try again.`
        );
        console.error('[HANDLER] Failed to save confirmed transaction:', error);
      }
    } else if (emoji === EMOJI.CANCEL) {
      // User cancelled
      await sendMessage(
        bot,
        channelId,
        `❌ Transaction cancelled. No worries! Just send another message when ready.`
      );
    }

    // Clean up
    await removePendingConfirmation(userId, messageId);
    pendingConfirmationsCache.get(userId)?.delete(messageId);
  };

  // Handle slash commands
  bot.events.interactionCreate = async (_bot, interaction) => {
    // Only handle application commands
    if (interaction.type !== 2) return; // APPLICATION_COMMAND

    const userId = interaction.user.id;
    const commandName = interaction.data?.name;

    // Security check
    if (!isUserAllowed(userId)) {
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: '❌ You are not authorized to use this bot.',
          flags: 64, // EPHEMERAL - only visible to user
        },
      });
      return;
    }

    auditLog('COMMAND', userId, commandName || 'unknown');

    switch (commandName) {
      case 'summary': {
        await handleSummaryCommand(bot, interaction, userId);
        break;
      }
      case 'help': {
        await handleHelpCommand(bot, interaction);
        break;
      }
      case 'clear': {
        await handleClearCommand(bot, interaction, userId);
        break;
      }
      default: {
        await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
          type: 4,
          data: {
            content: 'Unknown command.',
            flags: 64,
          },
        });
      }
    }
  };

  // Handle errors
  bot.events.error = (_bot, error) => {
    console.error('[DISCORD] Bot error:', error);
  };

  // Handle debug (optional - can be noisy)
  // bot.events.debug = (_bot, message) => {
  //   console.log('[DEBUG]', message);
  // };
}

/**
 * Handle /summary slash command.
 */
async function handleSummaryCommand(
  bot: ReturnType<typeof createDiscordClient>,
  interaction: any,
  userId: bigint
): Promise<void> {
  try {
    const summaries = await getMonthlySummary(userId);
    const total = await getMonthlyTotal(userId);

    if (summaries.length === 0) {
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 4,
        data: {
          content: `📊 No expenses recorded for ${formatMonthYear()}. Start logging your expenses!`,
        },
      });
      return;
    }

    // Build summary embed
    const fields = summaries.map((s) => ({
      name: s.category,
      value: `${formatCurrency(s.total)} (${s.count} transaction${s.count > 1 ? 's' : ''})`,
      inline: true,
    }));

    await sendEmbed(bot, interaction.channelId, {
      title: `📊 Monthly Summary - ${formatMonthYear()}`,
      description: `**Total Spent:** ${formatCurrency(total)}`,
      color: COLORS.INFO,
      fields,
      footer: { text: 'Keep tracking your expenses!' },
    });

    // Acknowledge the interaction
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: { content: 'Summary displayed above.' },
    });
  } catch (error) {
    console.error('[COMMAND] Error in summary command:', error);
    
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: {
        content: '❌ Failed to generate summary. Please try again.',
        flags: 64,
      },
    });
  }
}

/**
 * Handle /help slash command.
 */
async function handleHelpCommand(
  bot: ReturnType<typeof createDiscordClient>,
  interaction: any
): Promise<void> {
  const helpText = `💰 **Family Finance Bot - Help**

**How to Log Expenses:**
Simply type a message describing your expense:
• "Bought groceries for $120"
• "Paid electricity bill 50 USD"
• "Spent ¥500 on train tickets"

**Commands:**
• \`/summary\` - View your spending by category for this month
• \`/help\` - Show this help message
• \`/clear\` - Delete all your transaction data

**Categories:**
Food, Transportation, Utilities, Entertainment, Shopping, Healthcare, Education, Housing, Personal, Other

**Tips:**
• The bot will ask you to confirm before saving
• React ✅ to save or ❌ to cancel
• All amounts are in your specified currency`;

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: { content: helpText },
  });
}

/**
 * Handle /clear slash command.
 */
async function handleClearCommand(
  bot: ReturnType<typeof createDiscordClient>,
  interaction: any,
  userId: bigint
): Promise<void> {
  try {
    await clearUserTransactions(userId);
    
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: {
        content: '🗑️ All your transaction data has been cleared.',
        flags: 64,
      },
    });
  } catch (error) {
    console.error('[COMMAND] Error in clear command:', error);
    
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: {
        content: '❌ Failed to clear transactions. Please try again.',
        flags: 64,
      },
    });
  }
}

/**
 * Set up graceful shutdown handlers.
 */
function setupShutdownHandlers(): void {
  const shutdown = async () => {
    console.log('\n[SHUTDOWN] Shutting down gracefully...');
    // Could add cleanup logic here
    Deno.exit(0);
  };

  Deno.addSignalListener('SIGINT', shutdown);
  Deno.addSignalListener('SIGTERM', shutdown);
}

// Run the bot
main().catch((error) => {
  console.error('[FATAL] Unhandled error:', error);
  Deno.exit(1);
});
