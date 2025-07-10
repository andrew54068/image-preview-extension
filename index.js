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

// Global variables for tracking state
let hoverTimeout = null;
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
 * Module for managing the preview container
 */
const PreviewContainer = {
  // Reference to the current container
  element: null,
  
  /**
   * Create a new preview container or reuse the existing one
   * @returns {HTMLElement} The preview container
   */
  create: function() {
    // Check if we already have a container with this ID
    const existingContainer = document.getElementById('image-preview-container');
    
    if (existingContainer) {
      // Reuse the existing container but clear its contents
      existingContainer.innerHTML = '';
      existingContainer.className = '';
      this.element = existingContainer;
    } else {
      // Create a new container only if needed
      this.element = document.createElement('div');
      this.element.id = 'image-preview-container';
      document.body.appendChild(this.element);
    }
    
    return this.element;
  },
  
  /**
   * Show the loading state in the container
   */
  showLoading: function() {
    if (!this.element) this.create();
    
    this.element.innerHTML = '';
    this.element.className = 'loading';
    
    // Make sure the container is positioned at the top of the stacking order
    this.element.style.zIndex = '10000';
    
    // Force a reflow to ensure the loading state is visible
    void this.element.offsetWidth;
  },
  
  /**
   * Show an error message in the container
   * @param {string} message - The error message to show
   */
  showError: function(message = 'Failed to load image') {
    if (!this.element) this.create();
    
    this.element.innerHTML = '';
    this.element.className = 'error';
    
    const errorMsg = document.createElement('div');
    errorMsg.className = 'error-message';
    errorMsg.textContent = message;
    this.element.appendChild(errorMsg);
  },
  
  /**
   * Position the container near the cursor
   * @param {MouseEvent} event - The mouse event
   */
  positionAtCursor: function(event) {
    if (!this.element) return;
    
    // Store the initial position to ensure we always use the same container
    this.lastEventX = event.pageX;
    this.lastEventY = event.pageY;
    
    this.element.style.top = `${event.pageY + 20}px`;
    this.element.style.left = `${event.pageX + 20}px`;
  },
  
  /**
   * Adjust the position to prevent going off-screen
   * @param {MouseEvent} event - The original mouse event
   */
  adjustPosition: function(event) {
    if (!this.element) return;
    
    let top = event.pageY + 20;
    let left = event.pageX + 20;

    if (left + this.element.offsetWidth > window.innerWidth + window.scrollX) {
      left = event.pageX - this.element.offsetWidth - 20;
    }
    if (top + this.element.offsetHeight > window.innerHeight + window.scrollY) {
      top = event.pageY - this.element.offsetHeight - 20;
    }
    
    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;
  },
  
  /**
   * Remove the current container
   */
  remove: function() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  },
  
  /**
   * Remove all preview containers from the page
   */
  removeAll: function() {
    // Remove by ID
    const containers = document.querySelectorAll('#image-preview-container');
    containers.forEach(container => container.remove());
    
    // Also remove any with the old class name (for backward compatibility)
    const oldContainers = document.querySelectorAll('.image-preview-container');
    oldContainers.forEach(container => container.remove());
    
    this.element = null;
  }
};

/**
 * Creates and displays the image preview near the cursor.
 * @param {MouseEvent} event - The mouse event.
 * @param {string} imageUrl - The URL of the image to preview.
 */
function showPreview(event, imageUrl) {
  debugLog(`Showing preview for: ${imageUrl}`);
  
  // Cancel any previous image loads
  hideAllImageLoads();
  
  // Track the current image URL being loaded
  currentImageUrl = imageUrl;
  
  // Create a brand new container with a tracking ID
  PreviewContainer.create();
  
  // Show loading state and position the container
  PreviewContainer.showLoading();
  PreviewContainer.positionAtCursor(event);
  
  // Start performance monitoring
  const previewStartTime = Date.now();
  
  // Check if the image is already in the cache - fast path
  if (imageCache.has(imageUrl)) {
    cacheHits++;
    infoLog(`🔄 CACHE HIT: ${imageUrl} (Hit #${cacheHits})`);
    
    // Get cached data
    const cachedData = imageCache.get(imageUrl);
    
    // Create a new image element
    const cachedImg = new Image();
    
    // Set the source to trigger loading from browser cache
    cachedImg.src = cachedData.src;
    
    return; // Exit early since we've handled the display
  } 
  
  // Not in cache, load normally
  infoLog(`📥 CACHE MISS: ${imageUrl}`);
  
  // Create new image element
  const img = new Image();
  
  // When the image loads successfully:
  img.onload = () => {
    // Make sure this is still the current image we want to display
    if (imageUrl !== currentImageUrl) return;
    
    // Remove loading class
    PreviewContainer.element.classList.remove('loading');
    
    // Cache the image data
    imageCache.set(imageUrl, {
      src: imageUrl,
      loadTime: loadTime,
      timestamp: Date.now()
    });
    
    // debugLog(`Added to cache: ${imageUrl}. Cache size: ${imageCache.size}`);
  };

  // When the image fails to load:
  img.onerror = () => {
    if (imageUrl !== currentImageUrl) return;
    
    infoLog(`❌ Failed to load image: ${imageUrl}`);
    
    // Show error state
    PreviewContainer.showError('Failed to load image');
    
    // Adjust position for the error message
    PreviewContainer.adjustPosition(event);
  };
  
  // Only set crossOrigin if needed (for cross-origin images)
  if (imageUrl.startsWith('http') && !imageUrl.includes(window.location.hostname)) {
    img.crossOrigin = 'anonymous';
  }
  
  // Set source to start loading
  img.src = imageUrl;
}

/**
 * Cancels all pending image loads to prevent race conditions
 */
function hideAllImageLoads() {
  // Reset tracking variables to cancel any pending image loads
  currentImageUrl = null;
}

/**
 * Hides the preview and cleans up resources
 */
function hidePreview() {
  debugLog('Hiding preview.');
  clearTimeout(hoverTimeout);
  currentImageUrl = null;
  lastHoveredUrl = null;
  
  // Use the PreviewContainer module to remove all containers
  PreviewContainer.removeAll();
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
      if (imageUrl === lastHoveredUrl && PreviewContainer.element) {
        return;
      }
      
      // Always hide any existing preview before showing a new one
      hidePreview();
      
      // Update tracking variables
      lastHoveredLink = link;
      lastHoveredUrl = imageUrl;
      
      // Clear any existing timeout
      clearTimeout(hoverTimeout);
      
      // Use a shorter delay for responsiveness
      hoverTimeout = setTimeout(() => {
        // Make sure we're not trying to show multiple previews
        if (imageUrl !== lastHoveredUrl) return;
        
        showPreview(event, imageUrl);
      }, 100);
      
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

// Initialize the extension
debugLog('[Preview Extension] Script execution started');

// Clean up any existing containers on script load
document.addEventListener('DOMContentLoaded', () => {
hideAllPreviews();
});

// Log that we've reached the end of the script
debugLog('[Preview Extension] Script execution completed');