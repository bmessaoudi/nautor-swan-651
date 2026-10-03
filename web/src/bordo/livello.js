// Livello di una traccia audio (0..1), letto solo quando serve: niente cicli propri.
// Un solo AudioContext per tutte le tracce.
let ctx = null;

export function createLivello(mediaStreamTrack) {
  ctx ??= new AudioContext();
  const src = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const data = new Float32Array(an.fftSize);
  return {
    // energia RMS, riportata a una scala che per la voce parlata va da 0 a circa 1
    get() {
      an.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      return Math.min(1, Math.sqrt(sum / data.length) * 6);
    },
    stop() {
      src.disconnect();
    },
  };
}
