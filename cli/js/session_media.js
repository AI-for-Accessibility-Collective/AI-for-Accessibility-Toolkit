
            (action, value) => {
                const media = document.querySelector('video, audio');
                if (!media) return {error: 'No video or audio found on page'};

                const info = () => ({
                    type: media.tagName.toLowerCase(),
                    duration: media.duration,
                    currentTime: media.currentTime,
                    paused: media.paused,
                    muted: media.muted,
                    volume: media.volume,
                    playbackRate: media.playbackRate
                });

                switch (action) {
                    case 'play':
                        media.play();
                        return {...info(), msg: 'Playing'};
                    case 'pause':
                        media.pause();
                        return {...info(), msg: 'Paused'};
                    case 'toggle':
                        if (media.paused) media.play();
                        else media.pause();
                        return {...info(), msg: media.paused ? 'Paused' : 'Playing'};
                    case 'seek':
                        const seekTo = parseFloat(value) || 0;
                        media.currentTime = Math.max(0, Math.min(seekTo, media.duration));
                        return {...info(), msg: `Seeked to ${Math.floor(media.currentTime)}s`};
                    case 'rate':
                        const rate = parseFloat(value);
                        if (!isNaN(rate)) media.playbackRate = Math.max(0.25, Math.min(rate, 4.0));
                        return {...info(), msg: `Speed: ${media.playbackRate}x`};
                    case 'volume':
                        const vol = parseFloat(value);
                        if (!isNaN(vol)) media.volume = Math.max(0, Math.min(vol, 1));
                        return {...info(), msg: `Volume: ${Math.round(media.volume * 100)}%`};
                    case 'mute':
                        media.muted = !media.muted;
                        return {...info(), msg: media.muted ? 'Muted' : 'Unmuted'};
                    case 'status':
                    default:
                        return {...info(), msg: 'Status'};
                }
            }
        