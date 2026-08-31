(d) => {
    const el = document.querySelector(d.selector);
    if (el) {
        el.dataset.ai4a11ySummarized = 'true';
        const summaryBox = document.createElement('div');
        summaryBox.style.cssText = 'background: #fff3e0; padding: 12px; margin-bottom: 12px; border-left: 4px solid #ff9800; border-radius: 4px;';
        // d.value is model output, and the model read text from a page the
        // user does not control. Building the box out of an element and a
        // text node keeps the browser from parsing that value as markup, so
        // a value such as <img src=x onerror=...> shows as characters
        // instead of running. Same visible result as before.
        const label = document.createElement('strong');
        label.textContent = 'Summary:';
        summaryBox.appendChild(label);
        summaryBox.appendChild(document.createTextNode(' ' + d.value));
        el.parentElement?.insertBefore(summaryBox, el);
    }
}