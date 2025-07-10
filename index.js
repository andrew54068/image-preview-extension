console.log('[Preview Extension] Content script loaded successfully.');

// Debug mode - set to true to see more detailed logs
const DEBUG = true;

// Helper function to log only when debug mode is on
function debugLog(...args) {
  if (DEBUG) {
    console.log('[ImagePreview]', ...args);
  }
}

// Always log important events regardless of debug mode
function infoLog(...args) {
  console.log('[ImagePreview]', ...args);
}

// Image cache to store loaded images (using localStorage for persistence)
const imageCache = {
  // Internal cache for quick access during session
  _cache: new Map(),
  
  // Get an image from cache
  get: function(url) {
    // First try memory cache
    if (this._cache.has(url)) {
      return this._cache.get(url);
    }
    return null;
  },
  
  // Check if image is in cache
  has: function(url) {
    return this._cache.has(url);
  },
  
  // Set an image in cache
  set: function(url, data) {
    // Add to memory cache
    this._cache.set(url, data);
    
    // Manage cache size
    if (this._cache.size > CACHE_SIZE_LIMIT) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }
    
    return true;
  },
  
  // Get cache size
  get size() {
    return this._cache.size;
  },
  
  // Clear the cache
  clear: function() {
    this._cache.clear();
    return true;
  },
  
  // Get all keys
  keys: function() {
    return this._cache.keys();
  }
};

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
  debugLog(`Showing loading indicator for: ${imageUrl}`);
  
  // Ensure any existing preview is completely removed
  hideAllPreviews();
  
  // Track the current image URL being loaded
  currentImageUrl = imageUrl;
  
  // Create and show the container immediately with a loading state
  previewContainer = document.createElement('div');
  previewContainer.id = 'image-preview-container'; // Use a fixed ID for easier cleanup
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
    // Make sure this is still the current image we want to display
    if (imageUrl !== currentImageUrl || !previewContainer) return;
    
    // Performance monitoring
    const loadTime = Date.now() - previewStartTime;
    infoLog(`✅ Image loaded: ${imageUrl} (${loadTime}ms)`);
    
    // Transform the loading container into the image container
    // This is more efficient than creating a new container
    previewContainer.innerHTML = '';
    previewContainer.classList.remove('loading');
    previewContainer.appendChild(img);
    
    // Adjust position after the image is added
    adjustPosition();
  };

  // When the image fails to load:
  img.onerror = () => {
    // Make sure this is still the current image we want to display
    if (imageUrl !== currentImageUrl || !previewContainer) return;
    
    if (DEBUG) infoLog(`❌ ERROR: Image failed to load: ${imageUrl}`);
    
    // Update container with error message
    previewContainer.classList.remove('loading');
    previewContainer.classList.add('error');
    previewContainer.innerHTML = `<div class="error-content"><span class="error-icon">❌</span> <span class="error-text">Image failed to load</span></div>`;
    adjustPosition();
  };

  // For performance monitoring
  const previewStartTime = Date.now();
  debugLog(`[Preview] Starting to load image at: ${previewStartTime}`);
  
  // Check if the image is already in the cache - fast path
  if (imageCache.has(imageUrl)) {
    cacheHits++;
    infoLog(`🔄 CACHE HIT: ${imageUrl} (Hit #${cacheHits})`);
    
    // Get cached data
    const cachedData = imageCache.get(imageUrl);
    
    // Use the existing loading container to display the cached image
    // This avoids creating a new container
    const cachedImg = new Image();
    
    // When the cached image is ready
    cachedImg.onload = () => {
      // Clear loading content and show image
      previewContainer.innerHTML = '';
      previewContainer.classList.remove('loading');
      previewContainer.appendChild(cachedImg);
      
      // Mark as from cache
      cachedImg.classList.add('from-cache');
      cachedImg.setAttribute('title', `From cache (Hit #${cacheHits})`);
      
      // Adjust position
      adjustPosition();
      
      // Log performance gain
      debugLog(`Cache performance gain: ~${cachedData.loadTime}ms`);
    };
    
    // Set the source to trigger loading from browser cache
    cachedImg.src = cachedData.src;
    
    return; // Exit early since we've handled the display
  } 
  
  // Not in cache, load normally
  infoLog(`📥 CACHE MISS: ${imageUrl}`);
  
  // Only set crossOrigin if needed (for cross-origin images)
  if (imageUrl.startsWith('http') && !imageUrl.includes(window.location.hostname)) {
    img.crossOrigin = 'anonymous';
  }
  
  // Set source to start loading
  img.src = imageUrl;
  
  // Add to cache when loaded
  img.addEventListener('load', () => {
    // Cache the image data
    const loadTime = Date.now() - previewStartTime;
    
    // Store in cache with minimal data
    imageCache.set(imageUrl, {
      src: imageUrl,
      loadTime: loadTime,
      timestamp: Date.now()
    });
    
    debugLog(`Added to cache: ${imageUrl}. Cache size: ${imageCache.size}`);
  }, { once: true });
}

function hidePreview() {
  debugLog('Hiding preview.');
  clearTimeout(hoverTimeout);
  currentImageUrl = null;
  lastHoveredUrl = null;
  hideAllPreviews(); // Use the more thorough cleanup function
}

// Helper function to ensure all preview containers are removed
function hideAllPreviews() {
  // Find and remove ALL existing preview containers
  const containers = document.querySelectorAll('#image-preview-container');
  containers.forEach(container => container.remove());
  
  // Reset the previewContainer variable
  previewContainer = null;
}

// Use event delegation for efficiency. Listen for mouseover on the whole document.
// Use a more efficient mouseover handler with debouncing
let lastHoveredLink = null;
let lastHoveredUrl = null;

document.addEventListener('mouseover', (event) => {
  // Find the nearest parent anchor tag, which handles links with nested elements
  const link = event.target.closest('a');

  if (link) {
    const imageUrl = getImageUrl(link);
    
    // Only process if we have a valid image URL
    if (imageUrl) {
      // Skip if it's the same URL we're already showing
      if (imageUrl === lastHoveredUrl && previewContainer) {
        return;
      }
      
      // Update tracking variables
      lastHoveredLink = link;
      lastHoveredUrl = imageUrl;
      
      // Clear any existing timeout
      clearTimeout(hoverTimeout);
      
      // Use a shorter delay for responsiveness
      hoverTimeout = setTimeout(() => showPreview(event, imageUrl), 100);
      
      // When the mouse leaves the link, hide the preview
      link.addEventListener('mouseout', () => {
        hidePreview();
        lastHoveredLink = null;
        lastHoveredUrl = null;
      }, { once: true });
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
  infoLog(`Cache cleared. Removed ${cacheSize} items.`);
}

// Function to get cache statistics
function getCacheStats() {
  const stats = {
    size: imageCache.size,
    limit: CACHE_SIZE_LIMIT,
    hits: cacheHits,
    urls: Array.from(imageCache.keys())
  };
  
  // Log the stats to console for easy debugging
  infoLog('📊 Cache Statistics:', stats);
  
  return stats;
}

// Function to test the cache with a specific URL
function testCache(url) {
  if (!url) {
    infoLog('Please provide a URL to test');
    return;
  }
  
  infoLog(`Testing cache for: ${url}`);
  if (imageCache.has(url)) {
    infoLog(`✅ URL is in cache: ${url}`);
    return imageCache.get(url);
  } else {
    infoLog(`❌ URL not in cache: ${url}`);
    return null;
  }
}

// Log that we've reached the end of the script
debugLog('[Preview Extension] Script execution completed');