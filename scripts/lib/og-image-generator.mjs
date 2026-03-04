/**
 * OG Image Generator
 *
 * Currently provides category display names for articles.
 * OG image generation can be added later using @vercel/og or satori.
 */

/**
 * Get category display name
 * @param {string} category
 * @returns {string}
 */
export function getCategoryDisplayName(category) {
  const names = {
    guide: 'Guide',
    data: 'Data & Research',
    analysis: 'Analysis',
    'problem-solving': 'Problem-Solving',
    strategy: 'Strategy'
  };
  return names[category] || 'Guide';
}
