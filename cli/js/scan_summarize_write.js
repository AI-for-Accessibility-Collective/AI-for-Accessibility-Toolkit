(d) => {
    const el = document.querySelector(d.selector);
    if (el) {
        el.dataset.ai4a11ySummarized = 'true';
        const summaryBox = document.createElement('div');
        summaryBox.style.cssText = 'background: #fff3e0; padding: 12px; margin-bottom: 12px; border-left: 4px solid #ff9800; border-radius: 4px;';
        summaryBox.innerHTML = '<strong>Summary:</strong> ' + d.value;
        el.parentElement?.insertBefore(summaryBox, el);
    }
}