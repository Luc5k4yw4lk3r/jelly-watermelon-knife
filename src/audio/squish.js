/**
 * Squish sintetizado con WebAudio: ráfaga de ruido por un bandpass que cae de
 * frecuencia, más un golpe grave. Sin samples ni assets.
 */
export const sfx = (() => {
  let ac = null, master = null, noiseBuf = null, lastAt = -1;

  function init() {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.7;
    master.connect(ac.destination);
    const len = Math.floor(ac.sampleRate * 0.5);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 0.35;
  }

  function squish(strength) {
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    const t = ac.currentTime;
    if (t - lastAt < 0.085) return;
    lastAt = t;
    const amp = 0.28 + 0.42 * strength;

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.15;
    bp.frequency.setValueAtTime(2100 + Math.random() * 700, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.2 + 0.1 * strength);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
    src.connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + 0.36);

    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(175, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.17);
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(amp * 0.6, t);
    g2.gain.exponentialRampToValueAtTime(0.0008, t + 0.24);
    o.connect(g2).connect(master);
    o.start(t); o.stop(t + 0.3);
  }

  return { init, squish };
})();
