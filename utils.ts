/**
 * Utility functions for the Family Finance Bot
 * 
 * This module contains helper functions for:
 * - Permission checks (whitelist security)
 * - Message formatting
 * - Date handling
 */

/**
 * Cached list of allowed user IDs for faster lookups.
 * Populated once at startup from the FAMILY_USER_IDS environment variable.
 */
let allowedUserIds: bigint[] = [];

/**
 * Initialize the whitelist from environment variables.
 * Must be called once at bot startup before any permission checks.
 * 
 * @throws Error if FAMILY_USER_IDS is not set or contains invalid IDs
 */
export function initializeWhitelist(): void {
  const familyUserIdsEnv = Deno.env.get('FAMILY_USER_IDS');
  
  if (!familyUserIdsEnv) {
    throw new Error(
      'FAMILY_USER_IDS environment variable is not set. ' +
      'Please provide a comma-separated list of Discord user IDs.'
    );
  }

  // Parse comma-separated user IDs and convert to BigInt
  const ids = familyUserIdsEnv.split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0)
    .map(id => {
      try {
        return BigInt(id);
      } catch {
        console.warn(`[SECURITY] Invalid user ID in whitelist: "${id}". Skipping.`);
        return null;
      }
    })
    .filter((id): id is bigint => id !== null);

  if (ids.length === 0) {
    throw new Error(
      'FAMILY_USER_IDS contains no valid Discord user IDs. ' +
      'Please provide at least one valid numeric user ID.'
    );
  }

  allowedUserIds = ids;
  console.log(`[SECURITY] Whitelist initialized with ${ids.length} user(s)`);
}

/**
 * Check if a Discord user ID is in the whitelist.
 * 
 * SECURITY NOTE: This is the primary access control mechanism.
 * All commands that modify or view financial data must check this first.
 * 
 * @param userId - The Discord user ID to check
 * @returns true if the user is allowed, false otherwise
 */
export function isUserAllowed(userId: bigint): boolean {
  const isAllowed = allowedUserIds.includes(userId);
  
  if (!isAllowed) {
    // Log unauthorized access attempts for security monitoring
    console.warn(`[SECURITY] Unauthorized access attempt by user ID: ${userId}`);
  }
  
  return isAllowed;
}

/**
 * Format a currency amount for display.
 * 
 * @param amount - The numeric amount
 * @param currency - The currency code (default: USD)
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(amount);
}

/**
 * Get the current month's date range for filtering transactions.
 * 
 * @returns Object with start and end dates for the current month
 */
export function getCurrentMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  
  return { start, end };
}

/**
 * Format a date for display in summaries.
 * 
 * @param date - The date to format
 * @returns Formatted date string (e.g., "March 2024")
 */
export function formatMonthYear(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Parse a date string from the AI response.
 * If no date is provided or parsing fails, returns today's date.
 * 
 * @param dateStr - The date string from AI parsing
 * @returns ISO date string (YYYY-MM-DD)
 */
export function parseOrToday(dateStr: string | undefined): string {
  if (!dateStr) {
    return new Date().toISOString().split('T')[0];
  }

  try {
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) {
      return new Date().toISOString().split('T')[0];
    }
    return parsed.toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Extract potential expense message from user input.
 * Performs basic validation to filter out obviously non-expense messages.
 * 
 * @param content - The message content
 * @returns true if the message might be an expense entry
 */
export function mightBeExpense(content: string): boolean {
  // Look for common expense patterns:
  // - Currency symbols ($, €, £, ¥)
  // - Numbers followed by currency codes (USD, EUR, etc.)
  // - Keywords like "bought", "paid", "spent", "cost"
  
  const currencyPattern = /[$€£¥]|\b\d+\s*(USD|EUR|GBP|JPY|CNY)\b/i;
  const keywordPattern = /\b(bought|paid|spent|cost|purchase|expense|bill)\b/i;
  
  return currencyPattern.test(content) || keywordPattern.test(content);
}

/**
 * Generate a unique key for pending confirmations.
 * Uses user ID and timestamp to prevent collisions.
 * 
 * @param userId - The Discord user ID
 * @returns Unique confirmation key
 */
export function generateConfirmationKey(userId: bigint): string {
  return `${userId}-${Date.now()}`;
}

/**
 * Log an action with timestamp for audit purposes.
 * 
 * @param action - The action being performed
 * @param userId - The user performing the action
 * @param details - Additional details to log
 */
export function auditLog(action: string, userId: bigint, details?: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[AUDIT] ${timestamp} | User: ${userId} | Action: ${action}${details ? ` | Details: ${details}` : ''}`);
}
