/* Small independent startup entry: intentionally runs before React/3D dependencies. */
(()=>{
/** A cosmetic startup gate only. It never reads wallets, sessions or economic state. */
const OPENING_CLOSED = 'ember-world-opening-closed';
const ID = 'world-opening';
const DESKTOP = '/assets/opening/opening-720.a7b883661627006f.mp4';
const MOBILE = '/assets/opening/opening-540.878441a25175f3b8.mp4';
/** Direct service/return links stay direct; only a fresh World page has an opening. */
function openingRoute(pathname, search) {
    const portal = new URLSearchParams(search).get('portal');
    return (pathname === '/' || pathname === '/index.html') && !portal;
}
function createOpening(doc, win) {
    const overlay = doc.getElementById(ID), root = doc.getElementById('root');
    const video = overlay?.querySelector('video');
    const retry = overlay?.querySelector('[data-opening-retry]');
    const sound = overlay?.querySelector('[data-opening-sound]');
    const status = overlay?.querySelector('[data-opening-status]');
    if (!overlay || !root || !video || !retry || !status)
        return;
    let removed = false, closing = false, worldReady = root.dataset.worldReady === 'ready', clipDone = false, stall = 0, initial = 0, stuck = 0;
    const timers = new Set(), cleanups = [];
    const later = (fn, ms) => { const id = win.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
    const clear = (id) => { win.clearTimeout(id); timers.delete(id); };
    const listen = (target, type, fn) => { target.addEventListener(type, fn); cleanups.push(() => target.removeEventListener(type, fn)); };
    const param = new URLSearchParams(win.location.search).get('lang');
    let zh = param === 'zh';
    if (param !== 'zh' && param !== 'en')
        try {
            zh = win.localStorage.getItem('ember-world-language') === 'zh';
        }
        catch { /* optional preference */ }
    const text = (cn, en) => zh ? cn : en;
    const SOUND_KEY = 'ember-world-opening-sound-v1';
    const storedSound = () => {
        for (const key of [SOUND_KEY, 'ember-world-sound-v1'])
            for (const name of ['localStorage', 'sessionStorage'])
                try { const value = win[name]?.getItem(key); if (value === 'on' || value === 'off') return value === 'on'; } catch { /* optional preference */ }
        return true;
    };
    let soundWanted = storedSound();
    const saveSound = () => {
        for (const name of ['localStorage', 'sessionStorage'])
            try { const store = win[name]; if (store) { store.setItem(SOUND_KEY, soundWanted ? 'on' : 'off'); return; } } catch { /* optional preference */ }
    };
    const showSound = () => {
        if (!sound) return;
        const label = video.muted ? text('開啟開場聲音', 'Unmute opening') : text('將開場靜音', 'Mute opening');
        sound.setAttribute('aria-label', label); sound.setAttribute('title', label);
        sound.setAttribute('aria-pressed', String(!video.muted));
    };
    const quietRetry = () => {
        if (closing || removed || clipDone) return;
        video.muted = true; showSound();
        try { void video.play()?.catch(fallbackClip); } catch { fallbackClip(); }
    };

    overlay.setAttribute('aria-label', text('Ember World 開場', 'Ember World opening'));
    retry.textContent = text('重新載入', 'Reload');
    status.textContent = text('世界正在展開…', 'The world is unfolding…');
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = win.navigator.connection?.saveData === true;
    const stopVideo = () => { video.pause(); video.removeAttribute('src'); video.load(); };
    const remove = () => { if (removed)
        return; removed = true; for (const id of timers)
        win.clearTimeout(id); timers.clear(); for (const f of cleanups)
        f(); stopVideo(); overlay.remove(); };
    const close = (immediate = false) => {
        if (closing || removed)
            return;
        closing = true;
        for (const id of timers)
            win.clearTimeout(id);
        timers.clear();
        video.pause();
        overlay.dataset.state = 'leaving';
        root.inert = false;
        root.removeAttribute('aria-busy');
        win.dispatchEvent(new Event(OPENING_CLOSED));
        if (overlay.contains(doc.activeElement))
            root.querySelector('canvas,main')?.focus({ preventScroll: true });
        if (immediate || reduced.matches)
            remove();
        else
            later(remove, 360);
    };
    const finish = () => { if (worldReady && clipDone)
        close(); };
    const skipClip = () => { if (closing || removed || clipDone)
        return; clipDone = true; if (sound) sound.hidden = true; clear(stall); clear(initial); clear(stuck); video.pause(); status.textContent = text('正在準備世界…', 'Preparing the world…'); finish(); };
    const fallbackClip = () => { if (closing || removed || clipDone)
        return; video.hidden = true; stopVideo(); skipClip(); };
    if (!openingRoute(win.location.pathname, win.location.search)) {
        remove();
        win.dispatchEvent(new Event(OPENING_CLOSED));
        return { ready() { }, dispose: remove };
    }
    overlay.dataset.state = 'active';
    root.inert = true;
    root.setAttribute('aria-busy', 'true');
    listen(win, 'ember-world-ready', () => { if (root.dataset.worldReady === 'error')
        close(true);
    else {
        worldReady = true;
        finish();
    } });
    listen(retry, 'click', () => win.location.reload());
    if (sound) listen(sound, 'click', () => {
        if (closing || removed || clipDone || !video.src) return;
        soundWanted = video.muted; video.muted = !soundWanted; saveSound(); showSound();
        if (soundWanted) try { void video.play()?.catch(quietRetry); } catch { quietRetry(); }
    });
    // Neither a failed movie nor an autoplay restriction can block an otherwise ready World.
    listen(video, 'ended', skipClip);
    listen(video, 'error', fallbackClip);
    const waiting = () => { if (!clipDone && !closing) {
        clear(stall);
        stall = later(fallbackClip, 5000);
    } };
    listen(video, 'waiting', waiting);
    listen(video, 'stalled', waiting);
    listen(video, 'playing', () => clear(stall));
    // A window switch can pause the film (browsers pause muted video in a hidden tab to save power) without resuming it.
    // The film's own clock keeps running while the player is away: on return it continues from where it would be now,
    // or the World opens if it would have ended. A film that still does not move hands over to the normal loading wait.
    const clock = () => win.performance?.now?.() ?? Date.now();
    let awayAt = null, awayFrom = 0;
    const leave = () => { if (awayAt === null) { awayAt = clock(); awayFrom = video.currentTime || 0; } };
    /** Seek past the time spent away; true when the film would already have ended (the World is entered instead). */
    const catchUp = () => {
        if (awayAt === null) return false;
        const away = (clock() - awayAt) / 1000, now = video.currentTime || 0, target = awayFrom + Math.max(away, now - awayFrom);
        awayAt = null;
        if (Number.isFinite(video.duration) && video.duration > 0 && target >= video.duration - 0.25) { skipClip(); return true; }
        if (target > now + 0.25) try { video.currentTime = target; } catch { /* not seekable yet: it plays on from here */ }
        return false;
    };
    const resume = () => {
        if (closing || removed || clipDone || !video.src) return;
        if (doc.hidden) { leave(); return; }
        if (video.ended) { skipClip(); return; }
        if (catchUp()) return;
        if (!video.paused) return;
        clear(stuck);
        stuck = later(() => { if (video.ended) skipClip(); else if (video.paused) fallbackClip(); }, 3000);
        try { void video.play()?.catch(quietRetry); } catch { quietRetry(); }
    };
    // A browser can also pause a backgrounded film with no visibility event at all, even a few frames before its end, so
    // `ended` never fires and entry waits for a click (seen 2026-10-27). While the film runs it is checked every 2 s:
    // paused at its end counts as ended; paused mid-way after it had started gets the same single resume as a return.
    let started = false, idle = 0;
    listen(video, 'playing', () => { started = true; idle = 0; });
    const watch = () => {
        if (closing || removed || clipDone || !video.src) return;
        if (started && video.paused && !video.ended && !doc.hidden) {
            if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 0.5) { skipClip(); return; }
            if (++idle >= 2) { idle = 0; resume(); }
        }
        else idle = 0;
        later(watch, 2000);
    };
    later(watch, 2000);
    listen(doc, 'visibilitychange', resume);
    listen(doc, 'resume', resume);
    listen(win, 'pageshow', resume);
    listen(win, 'focus', resume);
    listen(video, 'playing', () => clear(stuck));
    listen(reduced, 'change', () => { if (reduced.matches)
        fallbackClip(); });
    listen(win, 'pagehide', () => { if (closing)
        remove();
    else
        close(true); });
    // A slow or failed app offers recovery instead of pretending to have finished loading.
    later(() => { if (!closing) {
        retry.hidden = false;
        status.textContent = text('載入較久，請稍候或重新載入。', 'Loading is taking longer. Please wait or reload.');
    } }, 30000);
    if (root.dataset.worldReady === 'error') {
        close(true);
        return;
    }
    if (reduced.matches || saveData) {
        clipDone = true;
        video.hidden = true;
    }
    else {
        video.muted = !soundWanted;
        showSound(); if (sound) sound.hidden = false;
        video.src = win.matchMedia('(max-width: 700px)').matches ? MOBILE : DESKTOP;
        // Bound an initial download stall without cutting off a movie that is actually playing.
        initial = later(fallbackClip, 12000);
        listen(video, 'playing', () => clear(initial));
        try {
            void video.play()?.catch(quietRetry);
        }
        catch {
            quietRetry();
        }
    }
    finish();
    return { ready(failed = false) { if (closing || removed)
            return; worldReady = true; if (failed)
            close(true);
        else
            finish(); }, dispose() { root.inert = false; root.removeAttribute('aria-busy'); remove(); } };
}
createOpening(document, window);

})();
