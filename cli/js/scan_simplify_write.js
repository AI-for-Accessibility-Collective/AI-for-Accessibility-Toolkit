(d) => {
    const el = document.querySelector(d.selector);
    if (el) {
        el.dataset.ai4a11ySimplified = 'true';
        el.dataset.ai4a11yOriginal = el.textContent;
        el.textContent = d.value;
        el.style.backgroundColor = '#e8f5e9';
        el.title = 'Text simplified for readability';
    }
}