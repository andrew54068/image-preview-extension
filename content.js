let previewContainer;
let hoverTimeout;

/**
 * Checks if a URL is a direct image link or can be converted to one.
 * @param {URL} url - The URL object from a link's href.
 * @returns {string|null} The direct image URL or null.
 */
function getImageUrl(url) {
  const urlStr = url.href;

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
  previewContainer = document.createElement('div');
  previewContainer.id = 'image-preview-container';

  const img = document.createElement('img');
  img.src = imageUrl;

  // Only show the preview once the image is loaded to get its dimensions.
  img.onload = () => {
    let top = event.pageY + 20;
    let left = event.pageX + 20;

    document.body.appendChild(previewContainer);

    // Adjust position to prevent going off-screen.
    if (left + previewContainer.offsetWidth > window.innerWidth + window.scrollX) {
      left = event.pageX - previewContainer.offsetWidth - 20;
    }
    if (top + previewContainer.offsetHeight > window.innerHeight + window.scrollY) {
      top = event.pageY - previewContainer.offsetHeight - 20;
    }

    previewContainer.style.top = `${top}px`;
    previewContainer.style.left = `${left}px`;
  };

  previewContainer.appendChild(img);
}

function hidePreview() {
  clearTimeout(hoverTimeout);
  if (previewContainer) {
    previewContainer.remove();
    previewContainer = null;
  }
}

// Use event delegation for efficiency. Listen for mouseover on the whole document.
document.addEventListener('mouseover', (event) => {
  if (event.target.tagName === 'A') {
    const imageUrl = getImageUrl(event.target);
    if (imageUrl) {
      // Use a short delay to prevent previews flashing while moving the mouse.
      hoverTimeout = setTimeout(() => showPreview(event, imageUrl), 250);
      // When the mouse leaves the link, hide the preview.
      event.target.addEventListener('mouseout', hidePreview, { once: true });
    }
  }
});