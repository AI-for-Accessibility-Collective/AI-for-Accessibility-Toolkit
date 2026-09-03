
            () => {
                const main = document.querySelector('main, [role="main"], article, .content, #content');
                const target = main || document.body;
                return (target.innerText || '').slice(0, 2000);
            }
        