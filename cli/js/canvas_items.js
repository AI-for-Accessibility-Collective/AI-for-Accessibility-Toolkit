() => {
    return Array.from(document.querySelectorAll('canvas'))
        .filter(c => !c.getAttribute('aria-label') && !c.getAttribute('role'))
        .map((c, i) => ({ index: i, selector: c.id ? '#' + c.id : `canvas:nth-of-type(${i+1})` }));
}