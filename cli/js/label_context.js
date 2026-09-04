(sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
        tag: el.tagName,
        type: el.type || el.role,
        href: el.href,
        innerHTML: el.innerHTML.slice(0, 200),
        parent: el.parentElement?.innerText?.slice(0, 100),
        nearby: el.parentElement?.parentElement?.innerText?.slice(0, 200)
    };
}