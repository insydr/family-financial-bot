/**
 * Database operations for the Family Finance Bot
 * 
 * This module handles all Deno KV operations for:
 * - Storing and retrieving transactions
 * - Generating monthly summaries
 * - Managing pending confirmations
 */

import { getCurrentMonthRange, formatCurrency } from './utils.ts';

/**
 * Transaction data structure stored in Deno KV.
 */
export interface Transaction {
  /** The expense amount in the original currency */
  amount: number;
  /** Category determined by AI parsing (e.g., "Food", "Utilities") */
  category: string;
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** User-provided description/note */
  note: string;
  /** Original currency code */
  currency?: string;
}

/**
 * Pending confirmation data for user verification.
 */
export interface PendingConfirmation {
  /** The parsed transaction awaiting confirmation */
  transaction: Transaction;
  /** Timestamp when the confirmation was created */
  createdAt: number;
  /** The original message content */
  originalMessage: string;
}

/**
 * Summary statistics for a category.
 */
export interface CategorySummary {
  category: string;
  total: number;
  count: number;
}

// Deno KV instance - initialized once and reused
let kv: Deno.Kv | null = null;

/**
 * Initialize the Deno KV database connection.
 * Must be called once at bot startup.
 * 
 * On Deno Deploy, you need to create a KV database first:
 * 1. Go to Deno Deploy Dashboard
 * 2. Select your project
 * 3. Go to "Databases" tab
 * 4. Click "Create Database"
 * 
 * @returns The KV instance for direct access if needed
 */
export async function initializeDatabase(): Promise<Deno.Kv> {
  if (kv) {
    return kv;
  }

  try {
    // Check if Deno.openKv is available
    if (typeof Deno.openKv !== 'function') {
      throw new Error(
        'Deno KV is not available. On Deno Deploy, create a KV database in the dashboard first:\n' +
        '1. Go to your project in Deno Deploy Dashboard\n' +
        '2. Click "Databases" tab\n' +
        '3. Click "Create Database"\n' +
        '4. Redeploy the project'
      );
    }

    // Open the default KV database
    kv = await Deno.openKv();
    console.log('[DATABASE] Deno KV initialized successfully');
    return kv;
  } catch (error) {
    console.error('[DATABASE] Failed to initialize Deno KV:', error);
    
    // Provide more helpful error message
    if (error instanceof Error) {
      if (error.message.includes('not a function')) {
        throw new Error(
          'Deno KV is not available on this runtime.\n' +
          'On Deno Deploy: Create a KV database in the project dashboard first.\n' +
          'Locally: Run with Deno 2.0+ (KV is stable, no flags needed).'
        );
      }
      throw error;
    }
    throw new Error('Failed to initialize database. Please check Deno KV availability.');
  }
}

/**
 * Get the KV instance, throwing if not initialized.
 */
function getKv(): Deno.Kv {
  if (!kv) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return kv;
}

/**
 * Add a new transaction to the database.
 * 
 * Key structure: ["transactions", userId, timestamp]
 * This allows efficient querying by user and time range.
 * 
 * @param userId - The Discord user ID who made the expense
 * @param transaction - The transaction data to store
 * @returns The generated key for the transaction
 */
export async function addTransaction(
  userId: bigint,
  transaction: Transaction
): Promise<Deno.KvKey> {
  const db = getKv();
  const timestamp = Date.now();
  const key: Deno.KvKey = ['transactions', userId, timestamp];

  try {
    await db.set(key, transaction);
    console.log(`[DATABASE] Transaction saved for user ${userId}: ${formatCurrency(transaction.amount)} - ${transaction.category}`);
    return key;
  } catch (error) {
    console.error('[DATABASE] Failed to save transaction:', error);
    throw new Error('Failed to save transaction to database. Please try again.');
  }
}

/**
 * Get all transactions for a user within a date range.
 * 
 * @param userId - The Discord user ID
 * @param startDate - Start of the date range
 * @param endDate - End of the date range
 * @returns Array of transactions with their keys
 */
export async function getTransactionsByDateRange(
  userId: bigint,
  startDate: Date,
  endDate: Date
): Promise<Array<{ key: Deno.KvKey; value: Transaction }>> {
  const db = getKv();
  const transactions: Array<{ key: Deno.KvKey; value: Transaction }> = [];

  try {
    // Query transactions for this user
    // Note: We use a prefix scan and filter by date
    const iter = db.list<Transaction>({ prefix: ['transactions', userId] });
    
    for await (const entry of iter) {
      const transaction = entry.value;
      const transactionDate = new Date(transaction.date);
      
      // Check if transaction falls within the date range
      if (transactionDate >= startDate && transactionDate <= endDate) {
        transactions.push({
          key: entry.key,
          value: transaction,
        });
      }
    }

    return transactions;
  } catch (error) {
    console.error('[DATABASE] Failed to query transactions:', error);
    throw new Error('Failed to retrieve transactions from database.');
  }
}

/**
 * Get monthly spending summary grouped by category.
 * 
 * @param userId - The Discord user ID
 * @returns Array of category summaries sorted by total (descending)
 */
export async function getMonthlySummary(
  userId: bigint
): Promise<CategorySummary[]> {
  const { start, end } = getCurrentMonthRange();
  const transactions = await getTransactionsByDateRange(userId, start, end);

  // Group transactions by category
  const categoryTotals = new Map<string, { total: number; count: number }>();

  for (const { value } of transactions) {
    const existing = categoryTotals.get(value.category) || { total: 0, count: 0 };
    categoryTotals.set(value.category, {
      total: existing.total + value.amount,
      count: existing.count + 1,
    });
  }

  // Convert to array and sort by total descending
  const summaries: CategorySummary[] = Array.from(categoryTotals.entries())
    .map(([category, data]) => ({
      category,
      total: data.total,
      count: data.count,
    }))
    .sort((a, b) => b.total - a.total);

  return summaries;
}

/**
 * Calculate the grand total for a user this month.
 * 
 * @param userId - The Discord user ID
 * @returns The total amount spent this month
 */
export async function getMonthlyTotal(userId: bigint): Promise<number> {
  const summaries = await getMonthlySummary(userId);
  return summaries.reduce((sum, s) => sum + s.total, 0);
}

/**
 * Store a pending confirmation for user verification.
 * Uses a short TTL to prevent memory bloat.
 * 
 * @param userId - The Discord user ID
 * @param messageId - The Discord message ID for the confirmation
 * @param confirmation - The pending confirmation data
 */
export async function storePendingConfirmation(
  userId: bigint,
  messageId: bigint,
  confirmation: PendingConfirmation
): Promise<void> {
  const db = getKv();
  const key: Deno.KvKey = ['pending_confirmations', userId, messageId];

  try {
    // Store with a 5-minute expiry (300,000 ms)
    // Note: Deno KV doesn't have native TTL, so we handle expiry in retrieval
    await db.set(key, {
      ...confirmation,
      expiresAt: Date.now() + 300000, // 5 minutes
    });
  } catch (error) {
    console.error('[DATABASE] Failed to store pending confirmation:', error);
    throw new Error('Failed to store confirmation. Please try again.');
  }
}

/**
 * Retrieve and remove a pending confirmation.
 * 
 * @param userId - The Discord user ID
 * @param messageId - The Discord message ID
 * @returns The pending confirmation or null if not found/expired
 */
export async function getPendingConfirmation(
  userId: bigint,
  messageId: bigint
): Promise<PendingConfirmation | null> {
  const db = getKv();
  const key: Deno.KvKey = ['pending_confirmations', userId, messageId];

  try {
    const entry = await db.get<PendingConfirmation & { expiresAt?: number }>(key);
    
    if (!entry.value) {
      return null;
    }

    // Check if expired
    if (entry.value.expiresAt && entry.value.expiresAt < Date.now()) {
      await db.delete(key);
      return null;
    }

    return {
      transaction: entry.value.transaction,
      createdAt: entry.value.createdAt,
      originalMessage: entry.value.originalMessage,
    };
  } catch (error) {
    console.error('[DATABASE] Failed to retrieve pending confirmation:', error);
    return null;
  }
}

/**
 * Remove a pending confirmation after it's been handled.
 * 
 * @param userId - The Discord user ID
 * @param messageId - The Discord message ID
 */
export async function removePendingConfirmation(
  userId: bigint,
  messageId: bigint
): Promise<void> {
  const db = getKv();
  const key: Deno.KvKey = ['pending_confirmations', userId, messageId];
  
  try {
    await db.delete(key);
  } catch (error) {
    console.error('[DATABASE] Failed to remove pending confirmation:', error);
    // Don't throw - this is not critical
  }
}

/**
 * Close the database connection gracefully.
 * Should be called during bot shutdown.
 */
export async function closeDatabase(): Promise<void> {
  if (kv) {
    try {
      kv.close();
      kv = null;
      console.log('[DATABASE] Deno KV connection closed');
    } catch (error) {
      console.error('[DATABASE] Error closing database:', error);
    }
  }
}

/**
 * Delete all transactions for a user (for testing/reset purposes).
 * 
 * @param userId - The Discord user ID
 */
export async function clearUserTransactions(userId: bigint): Promise<void> {
  const db = getKv();
  
  try {
    const iter = db.list({ prefix: ['transactions', userId] });
    
    for await (const entry of iter) {
      await db.delete(entry.key);
    }
    
    console.log(`[DATABASE] All transactions cleared for user ${userId}`);
  } catch (error) {
    console.error('[DATABASE] Failed to clear transactions:', error);
    throw new Error('Failed to clear user transactions.');
  }
}
