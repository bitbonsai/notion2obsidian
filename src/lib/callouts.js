import { PATTERNS } from "./utils.js";

// ============================================================================
// Notion Callout Conversion
// ============================================================================

// Icon to Obsidian callout mapping
export const ICON_TO_CALLOUT = {
  'wind_blue.svg': { type: 'note', emoji: '💨' },
  'token_blue.svg': { type: 'note', emoji: '📘' },
  'token_green.svg': { type: 'tip', emoji: '📗' },
  'token_yellow.svg': { type: 'example', emoji: '📙' },
  'token_red.svg': { type: 'warning', emoji: '📕' },
  'warning-sign_yellow.svg': { type: 'warning', emoji: '⚠️' },
  'warning-sign_red.svg': { type: 'danger', emoji: '🚨' },
  'info_blue.svg': { type: 'info', emoji: 'ℹ️' },
  'check_green.svg': { type: 'success', emoji: '✅' },
  'cross_red.svg': { type: 'failure', emoji: '❌' },
  'lightbulb_yellow.svg': { type: 'tip', emoji: '💡' },
  'important_red.svg': { type: 'important', emoji: '❗' },
  'question_blue.svg': { type: 'question', emoji: '❓' },
  'gear_blue.svg': { type: 'abstract', emoji: '⚙️' },
  'target_red.svg': { type: 'important', emoji: '🎯' },
  'fire_red.svg': { type: 'danger', emoji: '🔥' },
  'star_yellow.svg': { type: 'tip', emoji: '⭐' },
  'bookmark_blue.svg': { type: 'quote', emoji: '🔖' }
};

/**
 * Converts Notion callouts to Obsidian callouts
 * @param {string} content - The markdown content to process
 * @returns {Object} - { content: string, calloutsConverted: number }
 */
export function convertNotionCallouts(content) {
  let calloutsConverted = 0;
  let processedContent = content;

  // Handle <aside> callouts (like wind_blue.svg example)
  processedContent = processedContent.replace(PATTERNS.notionAsideCallout, (match, iconFile, calloutContent) => {
    const calloutInfo = ICON_TO_CALLOUT[iconFile] || { type: 'note', emoji: '📄' };

    // Clean up the content - remove extra whitespace and newlines
    const cleanContent = calloutContent
      .replace(/^\s*\n+/, '') // Remove leading newlines
      .replace(/\n+\s*$/, '') // Remove trailing newlines
      .replace(/\n\n+/g, '\n\n') // Normalize multiple newlines
      .split('\n')
      .map(line => line.trim() ? `> ${line}` : '>')
      .join('\n');

    // Extract title if it starts with **text**
    const titleMatch = calloutContent.match(/^\s*\*\*([^*]+)\*\*/);
    const title = titleMatch ? titleMatch[1] : '';
    const contentWithoutTitle = titleMatch ?
      calloutContent.replace(/^\s*\*\*[^*]+\*\*\s*\n?/, '') : calloutContent;

    const finalTitle = title ? ` ${calloutInfo.emoji} ${title}` : '';

    calloutsConverted++;
    return `> [!${calloutInfo.type}]${finalTitle}\n> ${contentWithoutTitle.trim().split('\n').join('\n> ')}`;
  });

  // Handle standalone callouts (img + ** pattern, less common)
  processedContent = processedContent.replace(PATTERNS.notionCallout, (match, iconFile, title, content) => {
    const calloutInfo = ICON_TO_CALLOUT[iconFile] || { type: 'note', emoji: '📄' };

    // Clean up the content
    const cleanContent = content
      .replace(/^\s*\n+/, '')
      .replace(/\n+\s*$/, '')
      .trim();

    const finalTitle = title ? ` ${calloutInfo.emoji} ${title}` : '';

    calloutsConverted++;
    return `> [!${calloutInfo.type}]${finalTitle}\n> ${cleanContent.split('\n').join('\n> ')}`;
  });

  return { content: processedContent, calloutsConverted };
}

