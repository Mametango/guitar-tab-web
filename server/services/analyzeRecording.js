const chordShapes = {
  C: ["x32010", "x35553"],
  G: ["320003", "355433"],
  Am: ["x02210", "577555"],
  F: ["133211", "x87565"],
  D: ["xx0232", "x57775"],
  Em: ["022000", "x79987"],
  A: ["x02220", "577655"],
};

const progressions = [
  ["C", "G", "Am", "F"],
  ["Em", "C", "G", "D"],
  ["A", "D", "F", "E"],
];
const rhythmPatterns = ["Down x4", "Down-Up x4", "Down Down-Up Up-Down-Up", "Arpeggio 8th"];

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const chordTemplates = Array.from({ length: 12 }, (_, root) => ([
  {
    name: noteNames[root],
    intervals: [0, 4, 7],
  },
  {
    name: `${noteNames[root]}m`,
    intervals: [0, 3, 7],
  },
])).flat();

function hashBuffer(buffer) {
  let total = 0;

  for (const byte of buffer.values()) {
    total = (total + byte) % 100000;
  }

  return total;
}

function estimatePitchClassFromFrequency(frequency) {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return null;
  }

  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  return ((midi % 12) + 12) % 12;
}

function parseWavFile(buffer) {
  if (buffer.length < 44) {
    throw new Error("WAV file is too short.");
  }

  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("File is not a valid WAV container.");
  }

  let offset = 12;
  let audioFormat = null;
  let numChannels = null;
  let sampleRate = null;
  let bitsPerSample = null;
  let dataOffset = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = buffer.readUInt16LE(chunkDataStart);
      numChannels = buffer.readUInt16LE(chunkDataStart + 2);
      sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataStart + 14);
    }

    if (chunkId === "data") {
      dataOffset = chunkDataStart;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1) {
    throw new Error("Only PCM WAV files are supported right now.");
  }

  if (bitsPerSample !== 16) {
    throw new Error("Only 16-bit WAV files are supported right now.");
  }

  if (!numChannels || !sampleRate || dataOffset === null || dataSize === null) {
    throw new Error("WAV metadata is incomplete.");
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = numChannels * bytesPerSample;
  const frameCount = Math.floor(dataSize / frameSize);
  const samples = new Float32Array(frameCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let mixed = 0;

    for (let channelIndex = 0; channelIndex < numChannels; channelIndex += 1) {
      const sampleOffset = dataOffset + frameIndex * frameSize + channelIndex * bytesPerSample;
      mixed += buffer.readInt16LE(sampleOffset) / 32768;
    }

    samples[frameIndex] = mixed / numChannels;
  }

  return { sampleRate, samples };
}

function computeAutoCorrelationFrequency(samples, sampleRate) {
  let rms = 0;

  for (let index = 0; index < samples.length; index += 1) {
    rms += samples[index] * samples[index];
  }

  rms = Math.sqrt(rms / samples.length);

  if (rms < 0.015) {
    return null;
  }

  const minFrequency = 70;
  const maxFrequency = 350;
  const minLag = Math.floor(sampleRate / maxFrequency);
  const maxLag = Math.floor(sampleRate / minFrequency);

  let bestLag = -1;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;

    for (let index = 0; index < samples.length - lag; index += 1) {
      correlation += samples[index] * samples[index + lag];
    }

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorrelation <= 0) {
    return null;
  }

  return sampleRate / bestLag;
}

function scoreChord(chroma, chord) {
  let score = 0;

  for (let index = 0; index < 12; index += 1) {
    if (chord.intervals.includes((index - noteNames.indexOf(chord.name.replace("m", "")) + 12) % 12)) {
      score += chroma[index];
    } else {
      score -= chroma[index] * 0.35;
    }
  }

  return score;
}

function findBestChord(chroma) {
  let best = { name: "N.C.", score: -Infinity };

  for (const chord of chordTemplates) {
    const rootName = chord.name.endsWith("m") ? chord.name.slice(0, -1) : chord.name;
    const root = noteNames.indexOf(rootName);
    let score = 0;

    for (let index = 0; index < 12; index += 1) {
      const interval = (index - root + 12) % 12;
      if (chord.intervals.includes(interval)) {
        score += chroma[index];
      } else {
        score -= chroma[index] * 0.35;
      }
    }

    if (score > best.score) {
      best = { name: chord.name, score };
    }
  }

  return best.name;
}

function analyzeWavChords(buffer) {
  const { sampleRate, samples } = parseWavFile(buffer);
  const segmentDurationSeconds = 2;
  const segmentSize = sampleRate * segmentDurationSeconds;
  const pitchWindowSize = 2048;
  const hopSize = 1024;
  const chords = [];

  for (let start = 0; start < samples.length; start += segmentSize) {
    const segment = samples.subarray(start, Math.min(start + segmentSize, samples.length));
    if (segment.length < pitchWindowSize) {
      continue;
    }

    const chroma = new Array(12).fill(0);

    for (let offset = 0; offset + pitchWindowSize <= segment.length; offset += hopSize) {
      const window = segment.subarray(offset, offset + pitchWindowSize);
      const frequency = computeAutoCorrelationFrequency(window, sampleRate);
      const pitchClass = estimatePitchClassFromFrequency(frequency);

      if (pitchClass !== null) {
        chroma[pitchClass] += 1;
      }
    }

    const totalEnergy = chroma.reduce((sum, value) => sum + value, 0);
    if (totalEnergy === 0) {
      continue;
    }

    const chord = findBestChord(chroma);
    const seconds = Math.floor(start / sampleRate);

    chords.push({
      time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
      chord,
      tabCandidates: chordShapes[chord] ?? [],
    });
  }

  return {
    duration: `${String(Math.floor(samples.length / sampleRate / 60)).padStart(2, "0")}:${String(Math.floor(samples.length / sampleRate) % 60).padStart(2, "0")}`,
    chords,
  };
}

function buildMeasures(chords) {
  return chords.map((item, index) => ({
    number: index + 1,
    startTime: item.time,
    chord: item.chord,
    beats: 4,
    subdivision: "4/4",
    rhythmPattern: rhythmPatterns[index % rhythmPatterns.length],
    tabCandidates: item.tabCandidates ?? [],
    selectedTab: item.tabCandidates?.[0] ?? "",
  }));
}

function buildMockAnalysis(buffer) {
  const seed = hashBuffer(buffer);
  const progression = progressions[seed % progressions.length];
  const stepSeconds = 4;
  const chords = progression.map((chord, index) => ({
    time: `0:${String(index * stepSeconds).padStart(2, "0")}`,
    chord,
    tabCandidates: chordShapes[chord] ?? [],
  }));

  return {
    duration: `00:${String(progression.length * stepSeconds).padStart(2, "0")}`,
    chords,
    measures: buildMeasures(chords),
    engine: "mock-chord-analyzer-v1",
    notes:
      "Placeholder analysis was used because this file format is not yet decoded by the local analyzer. WAV (PCM 16-bit) is currently supported for simple chord estimation.",
  };
}

export async function analyzeRecording({ fileName, mimeType, size, buffer }) {
  const lowerName = fileName.toLowerCase();
  const looksLikeWav = mimeType === "audio/wav" || mimeType === "audio/x-wav" || lowerName.endsWith(".wav");

  if (!looksLikeWav) {
    return {
      fileName,
      mimeType,
      size,
      ...buildMockAnalysis(buffer),
    };
  }

  try {
    const result = analyzeWavChords(buffer);

    return {
      fileName,
      mimeType,
      size,
      duration: result.duration,
      chords: result.chords,
      measures: buildMeasures(result.chords),
      engine: "wav-chord-analyzer-v1",
      notes:
        result.chords.length > 0
          ? "Simple local WAV analysis was used. Results are approximate and work best on clean single-guitar recordings."
          : "WAV decoding worked, but no stable chord windows were detected. Try a cleaner recording or stronger chord attacks.",
    };
  } catch (error) {
    return {
      fileName,
      mimeType,
      size,
      ...buildMockAnalysis(buffer),
      notes:
        `WAV analysis failed and fell back to placeholder analysis. ${error instanceof Error ? error.message : "Unknown error."}`,
    };
  }
}
