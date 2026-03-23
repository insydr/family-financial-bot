/**
 * AI integration for the Family Finance Bot
 * 
 * This module handles OpenRouter API calls for natural language parsing.
 * The AI extracts structured expense data from user messages.
 */

/**
 * Parsed expense data from AI analysis.
 */
export interface ParsedExpense {
  /** Whether the parsing was successful */
  success: boolean;
  /** The extracted amount (numeric) */
  amount?: number;
  /** The determined category */
  category?: string;
  /** The extracted or inferred date (ISO format: YYYY-MM-DD) */
  date?: string;
  /** The user's original note/description */
  note?: string;
  /** Detected currency code */
  currency?: string;
  /** Error message if parsing failed */
  error?: string;
}

/**
 * System prompt for the AI parser.
 * 
 * IMPORTANT: This prompt is carefully crafted to:
 * 1. Output ONLY valid JSON (no markdown, no explanations)
 * 2. Handle various date formats and infer "today" when not specified
 * 3. Categorize expenses into standard categories
 * 4. Handle edge cases like missing amounts or unclear descriptions
 */
const SYSTEM_PROMPT = `You are a financial transaction parser. Your job is to extract structured expense data from natural language messages.

RULES:
1. Output ONLY valid JSON. No markdown, no code blocks, no explanations.
2. If the message is NOT about an expense, output: {"success": false, "error": "Not an expense message"}
3. Always extract or infer the amount (convert to number, no currency symbols)
4. If no date is mentioned, use today's date: ${new Date().toISOString().split('T')[0]}
5. Categories must be one of: Food, Transportation, Utilities, Entertainment, Shopping, Healthcare, Education, Housing, Personal, Other
6. The note should be a brief description of what was purchased/paid for

OUTPUT FORMAT (strict JSON):
{
  "success": true,
  "amount": 50.00,
  "category": "Food",
  "date": "2024-03-15",
  "note": "groceries at supermarket",
  "currency": "USD"
}

EXAMPLES:
Input: "Bought groceries for $120"
Output: {"success":true,"amount":120,"category":"Food","date":"${new Date().toISOString().split('T')[0]}","note":"groceries","currency":"USD"}

Input: "Paid electricity bill 50 USD yesterday"
Output: {"success":true,"amount":50,"category":"Utilities","date":"${new Date(Date.now() - 86400000).toISOString().split('T')[0]}","note":"electricity bill","currency":"USD"}

Input: "Spent ¥500 on train tickets"
Output: {"success":true,"amount":500,"category":"Transportation","date":"${new Date().toISOString().split('T')[0]}","note":"train tickets","currency":"JPY"}

Input: "Hello, how are you?"
Output: {"success":false,"error":"Not an expense message"}`;

/**
 * Parse an expense message using OpenRouter's AI.
 * 
 * @param message - The user's message text
 * @returns Parsed expense data or error
 */
export async function parseExpenseWithAI(message: string): Promise<ParsedExpense> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  
  if (!apiKey) {
    console.error('[AI] OPENROUTER_API_KEY not configured');
    return {
      success: false,
      error: 'AI service not configured. Please set OPENROUTER_API_KEY.',
    };
  }

  try {
    console.log(`[AI] Parsing message: "${message.substring(0, 50)}..."`);
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/family-finance-bot',
        'X-Title': 'Family Finance Bot',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3-8b-instruct:free',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        temperature: 0.1, // Low temperature for consistent parsing
        max_tokens: 200,  // We only need a short JSON response
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI] OpenRouter API error: ${response.status} - ${errorText}`);
      
      // Handle specific error cases
      if (response.status === 401) {
        return {
          success: false,
          error: 'Invalid API key for AI service.',
        };
      }
      if (response.status === 429) {
        return {
          success: false,
          error: 'AI service rate limit reached. Please try again in a moment.',
        };
      }
      if (response.status >= 500) {
        return {
          success: false,
          error: 'AI service is temporarily unavailable. Please try again later.',
        };
      }
      
      return {
        success: false,
        error: `AI service error: ${response.status}`,
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('[AI] Empty response from OpenRouter');
      return {
        success: false,
        error: 'AI returned an empty response.',
      };
    }

    // Parse the JSON response
    try {
      // Strip any potential markdown code blocks
      let jsonContent = content.trim();
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.slice(7);
      } else if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.slice(3);
      }
      if (jsonContent.endsWith('```')) {
        jsonContent = jsonContent.slice(0, -3);
      }
      jsonContent = jsonContent.trim();

      const parsed: ParsedExpense = JSON.parse(jsonContent);
      
      if (!parsed.success) {
        return parsed;
      }

      // Validate required fields
      if (typeof parsed.amount !== 'number' || isNaN(parsed.amount)) {
        return {
          success: false,
          error: 'Could not extract a valid amount from the message.',
        };
      }

      // Ensure category is valid
      const validCategories = [
        'Food', 'Transportation', 'Utilities', 'Entertainment',
        'Shopping', 'Healthcare', 'Education', 'Housing', 'Personal', 'Other'
      ];
      
      if (!parsed.category || !validCategories.includes(parsed.category)) {
        parsed.category = 'Other';
      }

      // Default currency to USD if not specified
      if (!parsed.currency) {
        parsed.currency = 'USD';
      }

      console.log(`[AI] Successfully parsed: ${parsed.amount} ${parsed.currency} - ${parsed.category}`);
      
      return parsed;
    } catch (parseError) {
      console.error('[AI] Failed to parse AI response as JSON:', content);
      return {
        success: false,
        error: 'AI returned an invalid response format.',
      };
    }
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error('[AI] Network error:', error);
      return {
        success: false,
        error: 'Could not connect to AI service. Please check your internet connection.',
      };
    }
    
    console.error('[AI] Unexpected error:', error);
    return {
      success: false,
      error: 'An unexpected error occurred while processing your message.',
    };
  }
}

/**
 * Test the AI connection and configuration.
 * Useful for startup diagnostics.
 * 
 * @returns true if AI service is working, false otherwise
 */
export async function testAIConnection(): Promise<boolean> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  
  if (!apiKey) {
    console.warn('[AI] OPENROUTER_API_KEY not set - AI parsing will not work');
    return false;
  }

  try {
    // Simple test request
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      console.log('[AI] OpenRouter connection successful');
      return true;
    } else {
      console.warn(`[AI] OpenRouter connection failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error('[AI] OpenRouter connection test failed:', error);
    return false;
  }
}
