(sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
        tag: el.tagName,
        href: el.href,
        text: el.innerText?.slice(0,100),
        parent: el.parentElement?.innerText?.slice(0,100)
    };
}