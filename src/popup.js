document.addEventListener('DOMContentLoaded', function() {

// Get current tab's annotations
async function getCurrentAnnotations() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab.url || !tab.url.includes('nytimes.com')) {
    return null;
  }
  
  const result = await chrome.storage.local.get([tab.url]);
  return {
    url: tab.url,
    title: tab.title,
    annotations: result[tab.url] || []
  };
}

// Format annotations as text
function formatAnnotationsAsText(data) {
  if (!data || data.annotations.length === 0) {
    return null;
  }
  
  let text = `Article: ${data.title}\n`;
  text += `URL: ${data.url}\n`;
  text += `Date Exported: ${new Date().toLocaleString()}\n`;
  text += `\n${'='.repeat(30)}\n\n`;
  
  data.annotations.forEach((anno, index) => {
    text += `Annotation ${index + 1}\n`;
    text += `${'─'.repeat(30)}\n`;
    text += `Quote:\n"${anno.text}"\n\n`;
    text += `Note:\n${anno.note}\n\n`;
    text += `Created: ${new Date(anno.timestamp).toLocaleString()}\n`;
    text += `\n`;
  });
  
  return text;
}

  // Copy to clipboard
  const copyToClipboardBtn = document.getElementById('copyToClipboard');
  if (copyToClipboardBtn) {
    copyToClipboardBtn.addEventListener('click', async () => {
      const data = await getCurrentAnnotations();
      
      if (!data) {
        alert('Please navigate to a New York Times article to export annotations.');
        return;
      }
      
      if (data.annotations.length === 0) {
        alert('No annotations found for this page.');
        return;
      }
      
      const text = formatAnnotationsAsText(data);
      
      try {
        // Copy to clipboard
        await navigator.clipboard.writeText(text);
        
        alert('Annotations copied to clipboard!');
      } catch (err) {
        alert('Unable to copy to clipboard. Please try the "Download as Text File" option instead.');
      }
    });
  }

// Download as text file
document.getElementById('exportText').addEventListener('click', async () => {
  const data = await getCurrentAnnotations();
  
  if (!data) {
    alert('Please navigate to a New York Times article to export annotations.');
    return;
  }
  
  if (data.annotations.length === 0) {
    alert('No annotations found for this page.');
    return;
  }
  
  const text = formatAnnotationsAsText(data);
  
  // Create and download text file
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `nyt-annotations-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  alert('Annotations downloaded!');
});

});
