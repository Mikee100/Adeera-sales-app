/**
 * Input sanitization utilities to prevent XSS and injection attacks
 */

/**
 * Escapes HTML special characters to prevent XSS attacks
 */
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return text.replace(/[&<>"'/]/g, (char) => map[char] || char);
}

/**
 * Removes or escapes potentially dangerous script tags and event handlers
 */
function removeScriptTags(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/on\w+\s*=\s*[^\s>]*/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/data:text\/html/gi, '');
}

/**
 * Removes SQL injection patterns (basic protection)
 */
function removeSqlInjection(text: string): string {
  // Remove common SQL injection patterns
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/gi,
    /('|(\\')|(;)|(--)|(\/\*)|(\*\/)|(\+)|(\%))/g,
  ];
  
  let sanitized = text;
  for (const pattern of sqlPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }
  
  return sanitized;
}

/**
 * Sanitizes text input for safe storage and display
 * Removes XSS vectors, script tags, and dangerous patterns
 */
export function sanitizeText(input: string | null | undefined, maxLength: number = 1000): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Trim whitespace
  let sanitized = input.trim();

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Remove script tags and event handlers
  sanitized = removeScriptTags(sanitized);

  // Remove SQL injection patterns
  sanitized = removeSqlInjection(sanitized);

  // Escape HTML entities
  sanitized = escapeHtml(sanitized);

  return sanitized;
}

/**
 * Sanitizes customer name (more restrictive)
 */
export function sanitizeCustomerName(input: string | null | undefined): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Trim and limit length
  let sanitized = input.trim();
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }

  // Remove script tags
  sanitized = removeScriptTags(sanitized);

  // Remove SQL injection patterns
  sanitized = removeSqlInjection(sanitized);

  // Escape HTML but allow common punctuation
  sanitized = sanitized.replace(/[<>]/g, ''); // Remove < and > but keep other chars

  return sanitized;
}

/**
 * Sanitizes phone number (removes non-numeric characters except +)
 */
export function sanitizePhoneNumber(input: string | null | undefined): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove all characters except digits, +, spaces, hyphens, and parentheses
  let sanitized = input.replace(/[^\d+\s\-()]/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  // Limit length (international phone numbers can be up to 15 digits)
  if (sanitized.length > 20) {
    sanitized = sanitized.substring(0, 20);
  }

  return sanitized;
}

/**
 * Sanitizes notes/description fields (allows more characters but still safe)
 */
export function sanitizeNotes(input: string | null | undefined, maxLength: number = 2000): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Trim whitespace
  let sanitized = input.trim();

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Remove script tags and event handlers
  sanitized = removeScriptTags(sanitized);

  // Remove SQL injection patterns
  sanitized = removeSqlInjection(sanitized);

  // Escape HTML entities but preserve line breaks
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  return sanitized;
}

/**
 * Sanitizes an object's string properties recursively
 */
export function sanitizeObject<T extends Record<string, any>>(
  obj: T,
  fieldSanitizers: { [key: string]: (value: any) => string } = {}
): T {
  const sanitized = { ...obj };

  for (const key in sanitized) {
    if (sanitized.hasOwnProperty(key)) {
      const value = sanitized[key];

      if (typeof value === 'string') {
        // Use custom sanitizer if provided, otherwise use default
        if (fieldSanitizers[key]) {
          sanitized[key] = fieldSanitizers[key](value);
        } else {
          sanitized[key] = sanitizeText(value);
        }
      } else if (Array.isArray(value)) {
        // Recursively sanitize array items
        sanitized[key] = value.map((item) =>
          typeof item === 'string' ? sanitizeText(item) : item
        );
      } else if (value && typeof value === 'object') {
        // Recursively sanitize nested objects
        sanitized[key] = sanitizeObject(value, fieldSanitizers);
      }
    }
  }

  return sanitized;
}
