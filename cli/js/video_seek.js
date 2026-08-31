(idx) => {
    const video = document.querySelectorAll('video')[idx];
    if (video) { video.pause(); video.currentTime = Math.min(2, video.duration / 4); }
}