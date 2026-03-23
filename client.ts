/**
 * Discord client setup for the Family Finance Bot
 * 
 * This module configures the Discordeno bot client with:
 * - Intent configuration
 * - Event handlers
 * - Slash command registration
 */

import {
  createBot,
  startBot,
  Intents,
  Bot,
  EventHandlers,
} from 'discordeno';

/**
 * Create and configure the Discord bot instance.
 * 
 * @returns Configured bot instance
 */
export function createDiscordClient(): Bot {
  const token = Deno.env.get('DISCORD_TOKEN');
  
  if (!token) {
    throw new Error(
      'DISCORD_TOKEN environment variable is not set. ' +
      'Please provide your Discord bot token.'
    );
  }

  // Configure intents - we need:
  // - Guilds: For slash command registration
  // - GuildMessages: For reading expense messages
  // - GuildMessageReactions: For confirmation reactions
  // - DirectMessages: Optional, for DM support
  const intents = Intents.Guilds | Intents.GuildMessages | Intents.MessageContent | Intents.GuildMessageReactions;

  const bot = createBot({
    token,
    intents,
    // Event handlers will be attached separately
    events: {} as EventHandlers,
  });

  console.log('[DISCORD] Bot instance created');
  
  return bot;
}

/**
 * Start the bot and connect to Discord.
 * 
 * @param bot - The bot instance
 * @returns Promise that resolves when connected
 */
export async function connectBot(bot: Bot): Promise<void> {
  console.log('[DISCORD] Connecting to Discord...');
  
  try {
    await startBot(bot);
    console.log('[DISCORD] Bot connected successfully');
  } catch (error) {
    console.error('[DISCORD] Failed to connect:', error);
    throw new Error('Failed to connect to Discord. Check your token and network connection.');
  }
}

/**
 * Register slash commands for the bot.
 * Commands are registered per-guild for faster updates during development.
 * 
 * @param bot - The bot instance
 * @param guildId - The guild ID to register commands for
 */
export async function registerCommands(bot: Bot, guildId: bigint): Promise<void> {
  try {
    // Register /summary command
    await bot.helpers.createGuildApplicationCommand(guildId, {
      name: 'summary',
      description: 'Show your spending summary for the current month',
      type: 1, // CHAT_INPUT
      options: [],
    });

    // Register /help command
    await bot.helpers.createGuildApplicationCommand(guildId, {
      name: 'help',
      description: 'Show available commands and how to use the bot',
      type: 1, // CHAT_INPUT
      options: [],
    });

    // Register /clear command (for testing - removes all user's transactions)
    await bot.helpers.createGuildApplicationCommand(guildId, {
      name: 'clear',
      description: 'Clear all your transaction data (use with caution)',
      type: 1, // CHAT_INPUT
      options: [],
    });

    console.log('[DISCORD] Slash commands registered');
  } catch (error) {
    console.error('[DISCORD] Failed to register commands:', error);
    // Don't throw - the bot can still work with message-based commands
  }
}

/**
 * Send a message to a channel.
 * Helper function for cleaner code in event handlers.
 * 
 * @param bot - The bot instance
 * @param channelId - The channel ID
 * @param content - The message content
 */
export async function sendMessage(
  bot: Bot,
  channelId: bigint,
  content: string
): Promise<void> {
  try {
    await bot.helpers.sendMessage(channelId, { content });
  } catch (error) {
    console.error('[DISCORD] Failed to send message:', error);
  }
}

/**
 * Send a message with an embed for richer formatting.
 * 
 * @param bot - The bot instance
 * @param channelId - The channel ID
 * @param embed - The embed data
 */
export async function sendEmbed(
  bot: Bot,
  channelId: bigint,
  embed: {
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
  }
): Promise<void> {
  try {
    await bot.helpers.sendMessage(channelId, {
      embeds: [embed],
    });
  } catch (error) {
    console.error('[DISCORD] Failed to send embed:', error);
  }
}

/**
 * React to a message with an emoji.
 * 
 * @param bot - The bot instance
 * @param channelId - The channel ID
 * @param messageId - The message ID
 * @param emoji - The emoji to react with
 */
export async function addReaction(
  bot: Bot,
  channelId: bigint,
  messageId: bigint,
  emoji: string
): Promise<void> {
  try {
    await bot.helpers.addReaction(channelId, messageId, emoji);
  } catch (error) {
    console.error('[DISCORD] Failed to add reaction:', error);
  }
}

/**
 * Get the guild ID from environment variables.
 * 
 * @returns The guild ID as bigint
 * @throws Error if not configured
 */
export function getGuildId(): bigint {
  const guildIdStr = Deno.env.get('DISCORD_GUILD_ID');
  
  if (!guildIdStr) {
    throw new Error(
      'DISCORD_GUILD_ID environment variable is not set. ' +
      'Please provide your Discord server ID.'
    );
  }

  try {
    return BigInt(guildIdStr);
  } catch {
    throw new Error(
      'DISCORD_GUILD_ID is not a valid numeric ID. ' +
      'Please provide a valid Discord server ID (numbers only).'
    );
  }
}

/**
 * Helper to convert Snowflake strings to bigint.
 * Discord uses Snowflake IDs which are large integers.
 * 
 * @param id - The ID as string or bigint
 * @returns The ID as bigint
 */
export function toBigint(id: string | bigint): bigint {
  return typeof id === 'string' ? BigInt(id) : id;
}

/**
 * Helper to format a Snowflake as string for display.
 * 
 * @param id - The ID as bigint
 * @returns The ID as string
 */
export function formatSnowflake(id: bigint): string {
  return id.toString();
}
