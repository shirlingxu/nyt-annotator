// Storage for annotations on current page
let annotations = [];
let currentAnnotationId = null;

// Global flag to track if the currently visible popup is for a saved note
let isViewingSavedNote = false; 

// Load annotations for current page
async function loadAnnotations() {
  const url = window.location.href;
  // Normalize URL - remove query parameters and hash for matching
  const normalizedUrl = normalizeUrl(url);
  // Get all stored data
  const allData = await chrome.storage.local.get(null);
  // Try exact match first
  if (allData[url]) {
    annotations = allData[url];
  } 
  // Try normalized match
  else if (allData[normalizedUrl]) {
    annotations = allData[normalizedUrl];
  }
  // Try to find similar URLs
  else {
    for (let storedUrl of Object.keys(allData)) {
      const storedNormalized = normalizeUrl(storedUrl);
      if (storedNormalized === normalizedUrl) {
        annotations = allData[storedUrl];
        // Migrate to current URL
        await chrome.storage.local.set({ [normalizedUrl]: annotations });
        break;
      }
    }
  }
  
  if (!annotations || annotations.length === 0) {
    annotations = [];
  }
  
  // Re-apply highlights after page load
  if (annotations.length > 0) {
    restoreHighlights();
  }
}

// Normalize URL by removing query parameters and hash
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Keep only protocol, host, and pathname
    return urlObj.protocol + '//' + urlObj.host + urlObj.pathname;
  } catch (e) {
    // If URL parsing fails, return as-is
    return url;
  }
}

// Restore highlights on page load
function restoreHighlights() {
  // Remove any existing highlights first to avoid duplicates
  const existingHighlights = document.querySelectorAll('.nyt-annotation-highlight');
  existingHighlights.forEach(h => {
    // Only remove if it matches one of our annotation IDs
    const annoId = h.getAttribute('data-anno-id');
    if (annotations.find(a => a.id === annoId)) {
      h.outerHTML = h.innerHTML;
    }
  });
  
  annotations.forEach(anno => {
    try {
      // Find the text in the page and highlight it
      highlightTextInPage(anno.text, anno.id, anno.contextBefore, anno.contextAfter);
    } catch (e) {
      // Silent fail
    }
  });
  
  // Attach click handlers to all highlights
  attachHighlightHandlers();
}

// Improved find and highlight function with context matching
function highlightTextInPage(searchText, annoId, contextBefore, contextAfter) {
  const articleBody = document.querySelector('article') || document.body;
  
  // Normalize the search text - be more aggressive with normalization
  const normalizedSearch = searchText.replace(/\s+/g, ' ').trim();
  
  // Try to find using context if available
  if (contextBefore || contextAfter) {
    const fullText = articleBody.textContent.replace(/\s+/g, ' ');
    const normalizedContext = ((contextBefore || '') + normalizedSearch + (contextAfter || '')).replace(/\s+/g, ' ');
    const index = fullText.indexOf(normalizedContext);
    
    if (index !== -1) {
      const searchStart = index + (contextBefore ? contextBefore.replace(/\s+/g, ' ').length : 0);
      if (highlightTextAtPosition(articleBody, normalizedSearch, searchStart, annoId)) {
        return true;
      }
    }
  }
  
  // Fallback to simple search
  return highlightTextAtPosition(articleBody, normalizedSearch, -1, annoId);
}

// Highlight text at a specific position or find it
function highlightTextAtPosition(container, searchText, startPosition, annoId) {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip script and style tags
        if (node.parentElement && (
          node.parentElement.tagName === 'SCRIPT' ||
          node.parentElement.tagName === 'STYLE' ||
          node.parentElement.classList.contains('nyt-annotation-highlight')
        )) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    },
    false
  );
  
  let currentPos = 0;
  let node;
  
  // First pass: find all text nodes and build a text map
  let textNodes = [];
  while (node = walker.nextNode()) {
    const text = node.nodeValue;
    if (text && text.trim().length > 0) {
      textNodes.push({
        node: node,
        text: text,
        normalizedText: text.replace(/\s+/g, ' '),
        startPos: currentPos,
        endPos: currentPos + text.length
      });
      currentPos += text.length;
    }
  }
  
  // Build the full normalized text
  let fullText = textNodes.map(n => n.normalizedText).join('');
  fullText = fullText.replace(/\s+/g, ' ');
  
  // Find the search text in the normalized full text
  let searchIndex = fullText.indexOf(searchText);
  if (searchIndex === -1) {
    // Try a fuzzy match - maybe some characters are different
    const searchWords = searchText.split(' ').filter(w => w.length > 3);
    
    for (let word of searchWords.slice(0, 3)) {
      const wordIndex = fullText.indexOf(word);
      if (wordIndex !== -1) {
        searchIndex = wordIndex;
        break;
      }
    }
    
    if (searchIndex === -1) {
      return false;
    }
  }
  
  // Now map back to the actual text nodes
  let charCount = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;
  
  for (let nodeInfo of textNodes) {
    const nodeNormalizedLength = nodeInfo.normalizedText.length;
    
    // Check if this node contains the start of our match
    if (startNode === null && charCount + nodeNormalizedLength > searchIndex) {
      startNode = nodeInfo.node;
      // Map the normalized position back to the original text position
      startOffset = Math.max(0, searchIndex - charCount);
    }
    
    // Check if this node contains the end of our match
    if (startNode !== null && charCount + nodeNormalizedLength >= searchIndex + searchText.length) {
      endNode = nodeInfo.node;
      endOffset = Math.min(nodeInfo.text.length, searchIndex + searchText.length - charCount);
      break;
    }
    
    charCount += nodeNormalizedLength;
  }
  
  if (!startNode || !endNode) {
    return false;
  }
  
  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    
    const highlight = document.createElement('span');
    highlight.className = 'nyt-annotation-highlight';
    highlight.setAttribute('data-anno-id', annoId);
    
    const contents = range.extractContents();
    highlight.appendChild(contents);
    range.insertNode(highlight);
    
    return true;
  } catch (e) {
    return false;
  }
}

// Wrap the found text nodes in a highlight span
function wrapFoundNodes(foundNodes, annoId) {
  if (foundNodes.length === 0) return false;
  
  try {
    const range = document.createRange();
    const firstNode = foundNodes[0];
    const lastNode = foundNodes[foundNodes.length - 1];
    
    range.setStart(firstNode.node, firstNode.start);
    range.setEnd(lastNode.node, lastNode.end);
    
    const highlight = document.createElement('span');
    highlight.className = 'nyt-annotation-highlight';
    highlight.setAttribute('data-anno-id', annoId);
    
    const contents = range.extractContents();
    highlight.appendChild(contents);
    range.insertNode(highlight);
    
    return true;
  } catch (e) {
    return false;
  }
}

// Attach click handlers to all highlights
function attachHighlightHandlers() {
  const highlights = document.querySelectorAll('.nyt-annotation-highlight');
  
  highlights.forEach(highlight => {
    const annoId = highlight.getAttribute('data-anno-id');
    const annotation = annotations.find(a => a.id === annoId);
    
    if (annotation) {
      highlight.onclick = (e) => {
        e.stopPropagation();
        showNoteView(highlight, annotation);
      };
    }
  });
}

// Save annotations for current page
async function saveAnnotations() {
  const url = window.location.href;
  const normalizedUrl = normalizeUrl(url);
  
  // Save to normalized URL for consistency
  await chrome.storage.local.set({ [normalizedUrl]: annotations });
  
  // Also save to exact URL for backwards compatibility
  if (url !== normalizedUrl) {
    await chrome.storage.local.set({ [url]: annotations });
  }
}

// Generate unique ID
function generateId() {
  return 'anno_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Remove existing button
function removeAnnotationButton() {
  const existingButton = document.getElementById('nyt-anno-button');
  if (existingButton) {
    existingButton.remove();
  }
}

// Handle text selection
document.addEventListener('mouseup', (e) => {
  // Don't show button if clicking on our own UI
  if (e.target.closest('#nyt-anno-button') || e.target.closest('#nyt-anno-popup')) {
    return;
  }
  
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    if (selectedText.length > 0) {
      removeNotePopup();
      removeAnnotationButton();
      
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      showAnnotationButton(rect, selectedText, range);
    } else {
      removeAnnotationButton();
    }
  }, 10);
});

// Show button to add annotation
function showAnnotationButton(rect, text, range) {
  const button = document.createElement('div');
  button.id = 'nyt-anno-button';
  button.textContent = '💬 Add Note';
  
  // Use fixed positioning for better reliability
  button.style.position = 'fixed';
  button.style.left = (rect.left + rect.width / 2 - 50) + 'px';
  button.style.top = (rect.top - 40) + 'px';
  button.style.zIndex = '999999';
  
  button.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    createAnnotation(text, range);
    button.remove();
  };
  
  document.body.appendChild(button);
}

// Helper function to get text context around a position
function getTextContext(node, offset, length) {
  try {
    let text = '';
    let currentNode = node;
    
    // Get text from the node
    if (currentNode.nodeType === Node.TEXT_NODE) {
      text = currentNode.textContent;
    } else if (currentNode.textContent) {
      text = currentNode.textContent;
    }
    
    // Get surrounding text from parent if needed
    if (currentNode.parentNode && text.length < Math.abs(length)) {
      text = currentNode.parentNode.textContent || '';
    }
    
    if (length < 0) {
      // Get text before
      return text.substring(Math.max(0, offset + length), offset);
    } else {
      // Get text after
      return text.substring(offset, Math.min(text.length, offset + length));
    }
  } catch (e) {
    return '';
  }
}

// Create new annotation
function createAnnotation(text, range) {
  const id = generateId();
  
  // Store the original range information before modifying DOM
  const startContainer = range.startContainer;
  const startOffset = range.startOffset;
  const endContainer = range.endContainer;
  const endOffset = range.endOffset;
  
  // Clone the range to avoid modifying the original
  const clonedRange = range.cloneRange();
  
  try {
    // Extract contents from the cloned range
    const contents = clonedRange.extractContents();
    
    // Create wrapper highlight span
    const highlight = document.createElement('span');
    highlight.className = 'nyt-annotation-highlight';
    highlight.setAttribute('data-anno-id', id);
    
    // Move the extracted contents into the highlight
    highlight.appendChild(contents);
    
    // Insert the highlight at the start of where we extracted content
    clonedRange.insertNode(highlight);
    
    // Clean up any empty text nodes
    if (highlight.parentNode) {
      highlight.parentNode.normalize();
    }
    
    // Attach click handler immediately
    highlight.onclick = (e) => {
      e.stopPropagation();
      const annotation = annotations.find(a => a.id === id);
      if (annotation) {
        showNoteView(highlight, annotation);
      }
    };
    
    // Save annotation with additional context for better restoration
    const annotation = {
      id: id,
      text: text,
      note: '', // Will be filled when user saves (or remain '' if unsaved)
      timestamp: new Date().toISOString(),
      // Store context for better restoration
      contextBefore: getTextContext(startContainer, startOffset, -50),
      contextAfter: getTextContext(endContainer, endOffset, 50)
    };
    
    // Add to annotations array temporarily (will be properly saved when note is added)
    annotations.push(annotation);
    
    // Show note input
    showNoteInput(highlight, id, text);
    
  } catch (error) {
    alert('Failed to create highlight. Please try selecting the text again.');
    // Clean up the annotation we added
    annotations = annotations.filter(a => a.id !== id);
  }
  
  // Clear selection
  window.getSelection().removeAllRanges();
}

// New function to remove the unsaved annotation (note: '') and its highlight from the DOM.
function removeUnsavedAnnotation() {
    // Find the temporary highlight, which is marked by an empty note string: ''
    // Saved-but-empty notes are now stored as ' ', so this safely targets ONLY unsaved annotations.
    const unsavedAnno = annotations.find(a => a.note === ''); 
    
    if (unsavedAnno) {
        // 1. Remove from DOM by unwrapping the highlight span
        const highlight = document.querySelector(`[data-anno-id="${unsavedAnno.id}"]`);
        if (highlight) {
            highlight.outerHTML = highlight.innerHTML; 
        }
        
        // 2. Remove from annotations array
        annotations = annotations.filter(a => a.id !== unsavedAnno.id);
    }
}

// Show note input popup
function showNoteInput(element, id, text) {
  removeNotePopup();
  currentAnnotationId = id;
  
  // Ensure flag is false when in the input/edit flow
  isViewingSavedNote = false;
  
  const rect = element.getBoundingClientRect();
  
  const popup = document.createElement('div');
  popup.id = 'nyt-anno-popup';
  popup.innerHTML = `
    <div class="nyt-anno-popup-header">Add Note</div>
    <textarea id="nyt-anno-textarea" placeholder="Write your note here..."></textarea>
    <div class="nyt-anno-popup-buttons">
      <button id="nyt-anno-save">Save</button>
      <button id="nyt-anno-cancel">Cancel</button>
    </div>
  `;
  
  // Use fixed positioning to avoid scroll issues
  popup.style.position = 'fixed';
  popup.style.left = rect.left + 'px';
  popup.style.top = (rect.bottom + 5) + 'px';
  popup.style.zIndex = '999999';
  
  document.body.appendChild(popup);
  
  const textarea = document.getElementById('nyt-anno-textarea');
  textarea.focus();
  
  // Find existing annotation if editing
  const existing = annotations.find(a => a.id === id);
  if (existing) {
    // If the saved note is the temporary ' ' value, show as empty
    textarea.value = existing.note === ' ' ? '' : existing.note;
  }
  
  document.getElementById('nyt-anno-save').onclick = () => {
    const note = textarea.value;
    saveNote(id, text, note);
    removeNotePopup();
  };
  
  document.getElementById('nyt-anno-cancel').onclick = () => {
    if (!existing || !existing.note) {
      // Remove annotation if it was just created and not saved
      annotations = annotations.filter(a => a.id !== id);
      element.outerHTML = element.innerHTML;
    }
    removeNotePopup();
  };
}

// Save note to storage
function saveNote(id, text, note) {
  const existing = annotations.find(a => a.id === id);
  if (existing) {
    // If the note is empty when saving, store a single space ' ' instead of ''
    // This ensures that removeUnsavedAnnotation() does not delete the highlight later.
    existing.note = note.trim().length > 0 ? note : ' ';
    existing.timestamp = new Date().toISOString();
  }
  saveAnnotations();
}

// Remove note popup
function removeNotePopup() {
  const popup = document.getElementById('nyt-anno-popup');
  if (popup) popup.remove();
}

// Render existing annotations
function renderAnnotations() {
  annotations.forEach(anno => {
    const highlights = document.querySelectorAll(`[data-anno-id="${anno.id}"]`);
    highlights.forEach(highlight => {
      highlight.onclick = (e) => {
        e.stopPropagation();
        showNoteView(highlight, anno);
      };
    });
  });
}

// Show existing note with update/remove options
function showNoteView(element, annotation) {
  removeNotePopup();
  
  // Set flag to prevent cleanup on click-out
  isViewingSavedNote = true;
  
  const rect = element.getBoundingClientRect();

  // Display the stored note, handling the sentinel ' ' value
  const noteContent = annotation.note === ' ' ? '' : escapeHtml(annotation.note);
  
  const popup = document.createElement('div');
  popup.id = 'nyt-anno-popup';
  popup.innerHTML = `
    <div class="nyt-anno-popup-header">Your Note</div>
    <div class="nyt-anno-view-text">"${escapeHtml(annotation.text)}"</div>
    <div class="nyt-anno-view-note">${noteContent || ' '}</div>
    <div class="nyt-anno-view-time">${new Date(annotation.timestamp).toLocaleString()}</div>
    <div class="nyt-anno-popup-buttons">
      <button id="nyt-anno-edit" class="nyt-anno-btn-edit">Edit</button>
      <button id="nyt-anno-delete" class="nyt-anno-btn-delete">Delete</button>
      <button id="nyt-anno-close" class="nyt-anno-btn-close">Close</button>
    </div>
  `;
  
  // Use fixed positioning to avoid scroll issues
  popup.style.position = 'fixed';
  popup.style.left = rect.left + 'px';
  popup.style.top = (rect.bottom + 5) + 'px';
  popup.style.zIndex = '999999';
  
  document.body.appendChild(popup);
  
  document.getElementById('nyt-anno-edit').onclick = (e) => {
    e.stopPropagation();
    removeNotePopup();
    // Clear flag when entering edit mode
    isViewingSavedNote = false; 
    showNoteInput(element, annotation.id, annotation.text);
  };
  
  document.getElementById('nyt-anno-delete').onclick = (e) => {
    e.stopPropagation();
    if (confirm('Delete this annotation?')) {
      deleteAnnotation(annotation.id);
      removeNotePopup();
      // Clear flag on delete
      isViewingSavedNote = false;
    }
  };
  
  document.getElementById('nyt-anno-close').onclick = (e) => {
    e.stopPropagation();
    removeNotePopup();
    // Clear flag on button close
    isViewingSavedNote = false;
  };
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Delete annotation
function deleteAnnotation(id) {
  annotations = annotations.filter(a => a.id !== id);
  saveAnnotations();
  
  const highlight = document.querySelector(`[data-anno-id="${id}"]`);
  if (highlight) {
    highlight.outerHTML = highlight.innerHTML;
  }
}

// Initialize - wait for page to be fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadAnnotations);
} else {
  // Page already loaded
  loadAnnotations();
}

// Also try to restore after delays (for dynamic content)
setTimeout(() => {
  if (annotations.length > 0) {
    restoreHighlights();
  }
}, 1000);

setTimeout(() => {
  if (annotations.length > 0) {
    restoreHighlights();
  }
}, 2000);

setTimeout(() => {
  if (annotations.length > 0) {
    restoreHighlights();
  }
}, 3000);

// Also listen for when the page becomes visible (in case user switches tabs)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && annotations.length > 0) {
    setTimeout(restoreHighlights, 500);
  }
});

// Handle clicking outside popups
document.addEventListener('click', (e) => {
  if (!e.target.closest('#nyt-anno-popup') && !e.target.closest('#nyt-anno-button') && !e.target.closest('.nyt-annotation-highlight')) {
    
    // Only run cleanup if we were not just viewing a saved note
    const shouldCleanup = !isViewingSavedNote;
    
    removeNotePopup();
    removeAnnotationButton();
    
    // Reset flag immediately as the saved note view is closed
    isViewingSavedNote = false; 

    if (shouldCleanup) {
        // Runs only if an unsaved  note was open
        removeUnsavedAnnotation();
    }
  }
});