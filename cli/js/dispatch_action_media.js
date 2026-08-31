(args) => {
                const m = document.querySelector('video, audio');
                if (!m) return {error: 'no media element'};
                if (args.op === 'play') m.play();
                else if (args.op === 'pause') m.pause();
                else if (args.op === 'seek') m.currentTime = args.value;
                else if (args.op === 'rate') m.playbackRate = args.value;
                else if (args.op === 'volume') m.volume = Math.max(0, Math.min(1, args.value));
                return {duration: m.duration, currentTime: m.currentTime,
                        paused: m.paused, rate: m.playbackRate, volume: m.volume};
            }