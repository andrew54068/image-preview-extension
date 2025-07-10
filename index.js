console.log('[Preview Extension] Content script loaded successfully.');

// Debug mode - set to true to see more detailed logs
const DEBUG = true;

// Helper function to log only when debug mode is on
function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Image cache to store loaded images
const imageCache = new Map();

// Cache size limit (number of images to store)
const CACHE_SIZE_LIMIT = 50;

// Cache hit counter for statistics
let cacheHits = 0;

let previewContainer;
let hoverTimeout;
let currentImageUrl = null;

/**
 * Checks if a URL is a direct image link or can be converted to one.
 * @param {HTMLAnchorElement} anchor - The anchor element from the link.
 * @returns {string|null} The direct image URL or null.
 */
function getImageUrl(anchor) {
  const urlStr = anchor.href;

  // 1. Check for common image file extensions.
  if (/\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(urlStr)) {
    return urlStr;
  }

  // 2. Handle specific image hosts like imgur.
  // This rule converts a gallery link like https://imgur.com/hI9rZU3
  // into a direct image link like https://i.imgur.com/hI9rZU3.jpeg
  const imgurMatch = urlStr.match(/^https?:\/\/imgur\.com\/([a-zA-Z0-9]{7})$/);
  if (imgurMatch && imgurMatch[1]) {
    return `https://i.imgur.com/${imgurMatch[1]}.jpeg`;
  }

  return null;
}

/**
 * Creates and displays the image preview near the cursor.
 * @param {MouseEvent} event - The mouse event.
 * @param {string} imageUrl - The URL of the image to preview.
 */
function showPreview(event, imageUrl) {
  debugLog(`[Preview] Showing loading indicator for: ${imageUrl}`);
  
  // If we already have a preview container, remove it first
  if (previewContainer) {
    previewContainer.remove();
  }
  
  // Track the current image URL being loaded
  currentImageUrl = imageUrl;
  
  // Create and show the container immediately with a loading state
  previewContainer = document.createElement('div');
  previewContainer.id = 'image-preview-container';
  previewContainer.classList.add('loading');
  
  // Add a loading text to make it more visible
  const loadingText = document.createElement('div');
  loadingText.className = 'loading-text';
  loadingText.textContent = 'Loading...';
  previewContainer.appendChild(loadingText);
  
  // Add to DOM
  document.body.appendChild(previewContainer);
  
  // Force a reflow to ensure the loading state is visible
  void previewContainer.offsetWidth;
  
  // Set initial position near the cursor
  previewContainer.style.top = `${event.pageY + 20}px`;
  previewContainer.style.left = `${event.pageX + 20}px`;
  
  const img = document.createElement('img');

  // Helper to adjust the final position to prevent going off-screen.
  const adjustPosition = () => {
    let top = event.pageY + 20;
    let left = event.pageX + 20;

    if (left + previewContainer.offsetWidth > window.innerWidth + window.scrollX) {
      left = event.pageX - previewContainer.offsetWidth - 20;
    }
    if (top + previewContainer.offsetHeight > window.innerHeight + window.scrollY) {
      top = event.pageY - previewContainer.offsetHeight - 20;
    }
    previewContainer.style.top = `${top}px`;
    previewContainer.style.left = `${left}px`;
  };

  // When the image loads successfully:
  img.onload = () => {
    debugLog(`[Preview] Image loaded successfully: ${imageUrl}`);
    
    // Make sure this is still the current image we want to display
    if (imageUrl !== currentImageUrl || !previewContainer) return;
    
    // Clear the loading content
    previewContainer.innerHTML = '';
    previewContainer.classList.remove('loading');
    
    // Add the image
    previewContainer.appendChild(img);
    
    // Adjust position after the image is added
    adjustPosition();
    
    // Performance monitoring
    debugLog(`[Preview] Time to load: ${Date.now() - previewStartTime}ms`);
  };

  // When the image fails to load:
  img.onerror = () => {
    debugLog(`[Preview] Error: Image failed to load: ${imageUrl}`);
    
    // Make sure this is still the current image we want to display
    if (imageUrl !== currentImageUrl || !previewContainer) return;
    
    previewContainer.classList.remove('loading');
    previewContainer.classList.add('error');
    previewContainer.innerHTML = `<div class="error-content"><span class="error-icon">❌</span> <span class="error-text">Image failed to load</span></div>`;
    adjustPosition();
  };

  // For performance monitoring
  const previewStartTime = Date.now();
  debugLog(`[Preview] Starting to load image at: ${previewStartTime}`);
  
  // Check if the image is already in the cache
  if (imageCache.has(imageUrl)) {
    cacheHits++;
    debugLog(`[Preview] Cache hit for: ${imageUrl} (Total hits: ${cacheHits})`);
    
    // Clone the cached image data
    const cachedData = imageCache.get(imageUrl);
    
    // Skip loading and show immediately
    debugLog(`[Preview] Using cached image data, showing immediately`);
    previewContainer.classList.remove('loading');
    
    // Clear any loading content
    previewContainer.innerHTML = '';
    
    // Create a new image element with the cached source
    const cachedImg = new Image();
    cachedImg.src = cachedData.src;
    cachedImg.width = cachedData.width;
    cachedImg.height = cachedData.height;
    
    // Add the image to the container
    previewContainer.appendChild(cachedImg);
    
    // Adjust position immediately
    adjustPosition();
    
    // Log performance gain
    debugLog(`[Preview] Cache performance gain: ~${cachedData.loadTime}ms`);
    return; // Exit early since we've handled the display
  } 
  
  // Not in cache, load normally
  debugLog(`[Preview] Cache miss for: ${imageUrl}`);
  img.crossOrigin = 'anonymous';
  img.src = imageUrl;
  
  // Add to cache when loaded
  img.addEventListener('load', () => {
    // Store relevant image data in the cache
    const imageData = {
      src: imageUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      loadTime: Date.now() - previewStartTime
    };
    
    // Manage cache size - remove oldest entry if we exceed the limit
    if (imageCache.size >= CACHE_SIZE_LIMIT) {
      const oldestKey = imageCache.keys().next().value;
      imageCache.delete(oldestKey);
    }
    
    // Add to cache
    imageCache.set(imageUrl, imageData);
    debugLog(`[Preview] Added to cache: ${imageUrl}. Cache size: ${imageCache.size}`);
  }, { once: true });
}

function hidePreview() {
  debugLog('[Preview] Hiding preview.');
  clearTimeout(hoverTimeout);
  currentImageUrl = null;
  if (previewContainer) {
    previewContainer.remove();
    previewContainer = null;
  }
}

// Use event delegation for efficiency. Listen for mouseover on the whole document.
document.addEventListener('mouseover', (event) => {
  // Find the nearest parent anchor tag, which handles links with nested elements.
  const link = event.target.closest('a');

  if (link) {
    const imageUrl = getImageUrl(link);
    if (imageUrl) {
      debugLog(`[Preview] Found image link, setting timeout: ${imageUrl}`);
      
      // Clear any existing timeout
      clearTimeout(hoverTimeout);
      
      // Use a shorter delay to improve responsiveness (reduced from 300ms to 150ms)
      hoverTimeout = setTimeout(() => showPreview(event, imageUrl), 150);
      
      // When the mouse leaves the link, hide the preview.
      link.addEventListener('mouseout', hidePreview, { once: true });
    }
  }
});

// Add a listener for the extension's initialization to verify it's working
document.addEventListener('DOMContentLoaded', () => {
  debugLog('[Preview Extension] DOM fully loaded and parsed');
});

// Function to clear the image cache if needed
function clearImageCache() {
  const cacheSize = imageCache.size;
  imageCache.clear();
  cacheHits = 0;
  debugLog(`[Preview] Image cache cleared. Removed ${cacheSize} items.`);
}

// Function to get cache statistics
function getCacheStats() {
  return {
    size: imageCache.size,
    limit: CACHE_SIZE_LIMIT,
    hits: cacheHits,
    urls: Array.from(imageCache.keys())
  };
}

// Log that we've reached the end of the script
debugLog('[Preview Extension] Script execution completed');