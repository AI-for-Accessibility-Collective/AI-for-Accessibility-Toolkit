(state) => {
                const api = window.ai4a11y;
                // Whether the page took the state is the answer the caller
                // needs. `api?.setSessionState?.(state)` gave back undefined
                // both when it published and when there was nothing there to
                // publish through, so a page that never heard the profile was
                // cleared was reported as one that had.
                if (!api || typeof api.setSessionState !== 'function') return false;
                api.setSessionState(state);
                return true;
            }
