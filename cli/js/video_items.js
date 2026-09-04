() => {
    return Array.from(document.querySelectorAll('video'))
        .filter(v => !v.getAttribute('aria-label') && !v.getAttribute('aria-describedby'))
        .map((v, i) => ({ index: i, selector: v.id ? '#' + v.id : `video:nth-of-type(${i+1})` }));
}