let audioContext;

export async function playMockVoice() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  audioContext = audioContext || new AudioCtor();
  if (audioContext.resume) await audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  gain.gain.value = 0.03;
  oscillator.frequency.value = 440;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.08);
}
