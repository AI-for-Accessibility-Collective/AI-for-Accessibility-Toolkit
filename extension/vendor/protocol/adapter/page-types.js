// Kinds of web page, for an adapter that runs on one kind of page rather than
// on every page its URL patterns match (descriptor `pageTypes`). Built on
// schema.org's page and main-entity types (https://schema.org/WebPage and its
// subtypes, Product, Article, Recipe, Event, ...), the vocabulary pages use
// to say what they are; a few kinds schema.org has no type for (sign-in,
// home, web app) come from what people look for on the web.
//
// A page is of a kind when it says so in its own markup (JSON-LD, microdata,
// og:type: declaredPageType), and otherwise as a model judges from what it
// shows (the extension's runtime/page-type.js, the toolkit's `pageType` AI
// task). Pure: no DOM, no network.

export const PAGE_TYPES = Object.freeze([
  { id: 'article', name: 'Articles', about: 'a news story, blog post or other long read', schema: ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle', 'OpinionNewsArticle', 'ReportageNewsArticle', 'LiveBlogPosting'], og: ['article'] },
  { id: 'reference', name: 'Reference and documentation pages', about: 'an encyclopedia entry, manual or technical documentation', schema: ['TechArticle', 'APIReference', 'HowTo'], og: [] },
  { id: 'product', name: 'Product pages', about: 'one product or service for sale, with its price and a way to buy it', schema: ['Product', 'ProductGroup', 'IndividualProduct', 'ProductModel', 'Car', 'Vehicle'], og: ['product', 'og:product', 'product.item'] },
  { id: 'product-list', name: 'Shop listings', about: 'a category, collection or list of many products', schema: ['OfferCatalog', 'ProductCollection'], og: ['product.group'] },
  { id: 'search-results', name: 'Search results', about: 'results for a search the person made', schema: ['SearchResultsPage'], og: [] },
  { id: 'checkout', name: 'Cart and checkout pages', about: 'a shopping cart, checkout, payment or order page', schema: ['CheckoutPage'], og: [] },
  { id: 'sign-in', name: 'Sign-in pages', about: 'signing in, signing up or resetting a password', schema: [], og: [] },
  { id: 'form', name: 'Forms', about: 'a page that is mainly a form to fill in: contact, application, booking or survey', schema: ['ContactPage'], og: [] },
  { id: 'video', name: 'Video pages', about: 'a page built around one video or stream', schema: ['VideoObject', 'VideoGallery', 'BroadcastEvent'], og: ['video', 'video.movie', 'video.episode', 'video.tv_show', 'video.other'] },
  { id: 'recipe', name: 'Recipes', about: 'a recipe with ingredients and steps', schema: ['Recipe'], og: [] },
  { id: 'event', name: 'Event pages', about: 'one event with its date and place', schema: ['Event', 'MusicEvent', 'SportsEvent', 'TheaterEvent', 'BusinessEvent', 'EducationEvent', 'Festival'], og: [] },
  { id: 'profile', name: 'Profile pages', about: 'a person, account or organisation\'s profile', schema: ['ProfilePage', 'Person'], og: ['profile'] },
  { id: 'discussion', name: 'Discussions and Q&A', about: 'a forum thread, comments, social posts or questions and answers', schema: ['QAPage', 'FAQPage', 'DiscussionForumPosting', 'SocialMediaPosting', 'Question'], og: [] },
  { id: 'listing', name: 'Listings and directories', about: 'a list of places, jobs, homes or other items that are not products', schema: ['RealEstateListing', 'JobPosting', 'ItemList', 'CollectionPage'], og: [] },
  { id: 'home', name: 'Home pages', about: 'a site\'s front page that leads to its sections', schema: [], og: [] },
  { id: 'app', name: 'Web apps', about: 'an inbox, editor, map, dashboard or other tool used in the page', schema: ['WebApplication', 'SoftwareApplication'], og: [] },
]);

export const PAGE_TYPE_IDS = Object.freeze(PAGE_TYPES.map(t => t.id));
export const pageTypeById = (id) => PAGE_TYPES.find(t => t.id === id) || null;

// Types every page of a site carries, which say nothing about this page.
const SITE_WIDE = new Set(['WebSite', 'Organization', 'Corporation', 'LocalBusiness', 'BreadcrumbList', 'SiteNavigationElement', 'WPHeader', 'WPFooter', 'WPSideBar', 'ImageObject', 'Brand', 'Offer', 'AggregateRating', 'Review', 'Rating', 'PostalAddress', 'ContactPoint', 'SearchAction', 'ReadAction', 'EntryPoint', 'Thing', 'WebPage']);

/**
 * The kind of page its own markup says it is, or null when it says none or
 * says two different kinds (a model decides then).
 * @param {{types?: string[], ogType?: string}} declared  schema.org types found on the page (JSON-LD @type, microdata itemtype), and og:type
 */
export function declaredPageType({ types = [], ogType = '' } = {}) {
  const found = new Set();
  for (const raw of types) {
    const t = String(raw || '').replace(/^https?:\/\/schema\.org\//i, '').trim();
    if (!t || SITE_WIDE.has(t)) continue;
    const kind = PAGE_TYPES.find(k => k.schema.includes(t));
    if (kind) found.add(kind.id);
  }
  const og = String(ogType || '').trim().toLowerCase();
  if (og && og !== 'website') {
    const kind = PAGE_TYPES.find(k => k.og.includes(og));
    if (kind) found.add(kind.id);
  }
  // A product page lists offers and reviews; a listing page carries ItemList
  // with products: the more specific kind wins where both are said.
  if (found.has('product') && found.has('listing')) found.delete('listing');
  if (found.has('reference') && found.has('article')) found.delete('article');
  return found.size === 1 ? [...found][0] : null;
}
