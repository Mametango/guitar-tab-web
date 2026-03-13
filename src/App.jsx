import { useEffect, useMemo, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "";
const storageKey = "guitar-tab-web:last-analysis";

const chordOptions = ["C", "Cm", "D", "Dm", "E", "Em", "F", "Fm", "G", "Gm", "A", "Am", "B", "Bm"];
const chordShapes = {
  C: ["x32010", "x35553"],
  Cm: ["x35543", "8-10-10-8-8-8"],
  D: ["xx0232", "x57775"],
  Dm: ["xx0231", "x57765"],
  E: ["022100", "x79997"],
  Em: ["022000", "x79987"],
  F: ["133211", "x87565"],
  Fm: ["133111", "x87564"],
  G: ["320003", "355433"],
  Gm: ["355333", "xx5786"],
  A: ["x02220", "577655"],
  Am: ["x02210", "577555"],
  B: ["x24442", "799877"],
  Bm: ["x24432", "799777"],
};

function mergeChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function downloadTextFile(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildExportPayload(analysis) {
  return {
    fileName: analysis.fileName,
    duration: analysis.duration,
    engine: analysis.engine,
    notes: analysis.notes,
    exportedAt: new Date().toISOString(),
    measures: analysis.measures.map((measure) => ({
      number: measure.number,
      startTime: measure.startTime,
      chord: measure.chord,
      beats: measure.beats,
      subdivision: measure.subdivision,
      rhythmPattern: measure.rhythmPattern,
      selectedTab: measure.selectedTab,
      tabCandidates: measure.tabCandidates,
    })),
  };
}

function buildChordChartText(analysis) {
  const header = [
    "Guitar Chord Chart",
    `File: ${analysis.fileName}`,
    `Duration: ${analysis.duration}`,
    `Engine: ${analysis.engine}`,
    "",
  ];

  const measures = analysis.measures.map((measure) =>
    `#${measure.number} ${measure.startTime} | ${measure.chord} | ${measure.subdivision} | ${measure.rhythmPattern} | TAB ${measure.selectedTab || "-"}`,
  );

  return [...header, ...measures, "", `Notes: ${analysis.notes}`].join("\n");
}

function writeVariableLength(value) {
  let buffer = value & 0x7f;
  const bytes = [];

  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }

  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }

  return bytes;
}

function chordToMidiNotes(chordName) {
  const normalized = chordName.trim();
  const isMinor = normalized.endsWith("m");
  const rootName = isMinor ? normalized.slice(0, -1) : normalized;
  const rootMap = {
    C: 60,
    "C#": 61,
    D: 62,
    "D#": 63,
    E: 64,
    F: 65,
    "F#": 66,
    G: 67,
    "G#": 68,
    A: 69,
    "A#": 70,
    B: 71,
  };
  const root = rootMap[rootName];

  if (root === undefined) {
    return [60, 64, 67];
  }

  return isMinor ? [root, root + 3, root + 7] : [root, root + 4, root + 7];
}

function createMidiBlob(analysis) {
  const ticksPerQuarter = 480;
  const ticksPerMeasure = ticksPerQuarter * 4;
  const events = [];

  events.push(0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);
  events.push(0x00, 0xc0, 0x18);

  for (const measure of analysis.measures) {
    const notes = chordToMidiNotes(measure.chord);

    events.push(0x00, 0x90, notes[0], 96);
    for (let index = 1; index < notes.length; index += 1) {
      events.push(0x00, 0x90, notes[index], 84);
    }

    events.push(...writeVariableLength(ticksPerMeasure), 0x80, notes[0], 0);
    for (let index = 1; index < notes.length; index += 1) {
      events.push(0x00, 0x80, notes[index], 0);
    }
  }

  events.push(0x00, 0xff, 0x2f, 0x00);

  const trackLength = events.length;
  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff,
    0x4d, 0x54, 0x72, 0x6b,
    (trackLength >> 24) & 0xff,
    (trackLength >> 16) & 0xff,
    (trackLength >> 8) & 0xff,
    trackLength & 0xff,
  ];

  return new Blob([new Uint8Array([...header, ...events])], { type: "audio/midi" });
}

function normalizeTabShape(shape) {
  if (!shape) {
    return ["x", "x", "x", "x", "x", "x"];
  }

  if (shape.includes("-")) {
    const values = shape.split("-").slice(0, 6);
    while (values.length < 6) {
      values.push("x");
    }
    return values;
  }

  const values = shape.split("").slice(0, 6);
  while (values.length < 6) {
    values.push("x");
  }
  return values;
}

function ChordDiagram({ chord, shape, rhythmPattern, compact = false }) {
  const frets = normalizeTabShape(shape);
  const numericFrets = frets
    .map((value) => (value === "x" || value === "0" ? null : Number(value)))
    .filter((value) => Number.isFinite(value));
  const minFret = numericFrets.length > 0 ? Math.min(...numericFrets) : 1;
  const baseFret = minFret > 1 ? minFret : 1;

  return (
    <article className={`chord-chart-card ${compact ? "chord-chart-card-compact" : ""}`}>
      <h3>{chord}</h3>

      <div className="diagram-shell">
        {baseFret > 1 && <span className="base-fret">{baseFret}fr</span>}
        <div className="string-status-row">
          {frets.map((value, index) => (
            <span key={`status-${chord}-${index}`} className="string-status">
              {value === "x" ? "×" : value === "0" ? "○" : ""}
            </span>
          ))}
        </div>

        <div className="diagram-grid" aria-label={`${chord} diagram`}>
          {Array.from({ length: 4 }).map((_, fretIndex) => (
            <div key={`fret-${fretIndex}`} className="diagram-fret-line" style={{ top: `${fretIndex * 25}%` }} />
          ))}
          {Array.from({ length: 6 }).map((_, stringIndex) => (
            <div
              key={`string-${stringIndex}`}
              className="diagram-string-line"
              style={{ left: `${stringIndex * 20}%` }}
            />
          ))}

          {frets.map((value, stringIndex) => {
            if (value === "x" || value === "0") {
              return null;
            }

            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
              return null;
            }

            const row = baseFret > 1 ? numeric - baseFret : numeric - 1;
            return (
              <span
                key={`dot-${chord}-${stringIndex}`}
                className="diagram-dot"
                style={{
                  left: `${stringIndex * 20}%`,
                  top: `${12.5 + Math.max(0, row) * 25}%`,
                }}
              />
            );
          })}
        </div>
      </div>

      {!compact && <p className="diagram-tab">{shape || "TAB未選択"}</p>}
      {!compact && <p className="diagram-rhythm">{rhythmPattern || "Down-Up x4"}</p>}
    </article>
  );
}

function hydrateAnalysis(data) {
  if (!data) {
    return null;
  }

  const chords = (data.chords ?? []).map((item) => ({
    ...item,
    tabCandidates: item.tabCandidates?.length ? item.tabCandidates : (chordShapes[item.chord] ?? []),
    selectedTab: item.selectedTab ?? item.tabCandidates?.[0] ?? chordShapes[item.chord]?.[0] ?? "",
  }));

  const measures = (
    data.measures ??
    chords.map((item, index) => ({
      number: index + 1,
      startTime: item.time,
      chord: item.chord,
      beats: 4,
      subdivision: "4/4",
      rhythmPattern: "Down-Up x4",
      tabCandidates: item.tabCandidates,
      selectedTab: item.selectedTab,
    }))
  ).map((item) => ({
    ...item,
    tabCandidates: item.tabCandidates?.length ? item.tabCandidates : (chordShapes[item.chord] ?? []),
    selectedTab: item.selectedTab ?? item.tabCandidates?.[0] ?? chordShapes[item.chord]?.[0] ?? "",
  }));

  return {
    ...data,
    chords,
    measures,
  };
}

function App() {
  const [audioFile, setAudioFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recorder, setRecorder] = useState(null);
  const [recordingLabel, setRecordingLabel] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMeasure, setPlaybackMeasure] = useState(0);
  const [analysis, setAnalysis] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      return saved ? hydrateAnalysis(JSON.parse(saved)) : null;
    } catch {
      return null;
    }
  });
  const [errorMessage, setErrorMessage] = useState("");

  const statusText = useMemo(() => {
    if (isAnalyzing) {
      return "録音を解析してコード進行を推定しています...";
    }
    if (analysis) {
      return "解析結果を表示中です。あとで本物の音声解析 API に置き換えできます。";
    }
    if (audioFile) {
      return "録音または選択したファイルを解析できます。";
    }
    return "録音ファイルを選ぶと、MVP の解析フローを試せます。";
  }, [analysis, audioFile, isAnalyzing]);

  const chordSummary = useMemo(() => {
    if (!analysis) {
      return [];
    }

    const seen = new Set();

    return analysis.measures
      .map((measure) => ({
        chord: measure.chord,
        tab: measure.selectedTab || measure.tabCandidates?.[0] || "",
        rhythmPattern: measure.rhythmPattern,
      }))
      .filter((item) => {
        if (seen.has(item.chord)) {
          return false;
        }

        seen.add(item.chord);
        return true;
      });
  }, [analysis]);

  const strokeSummary = useMemo(() => {
    if (!analysis) {
      return [];
    }

    const counts = new Map();

    for (const measure of analysis.measures) {
      const key = measure.rhythmPattern?.trim() || "未設定";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([pattern, count]) => ({
      pattern,
      count,
    }));
  }, [analysis]);

  const performanceItems = useMemo(() => {
    if (!analysis) {
      return [];
    }

    return analysis.measures.map((measure, index) => ({
      ...measure,
      index,
    }));
  }, [analysis]);

  useEffect(() => {
    if (!analysis) {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(analysis));
  }, [analysis]);

  useEffect(() => {
    if (!analysis || !isPlaying) {
      return undefined;
    }

    if (playbackMeasure >= analysis.measures.length - 1) {
      const doneTimer = window.setTimeout(() => {
        setIsPlaying(false);
      }, 1200);
      return () => window.clearTimeout(doneTimer);
    }

    const timer = window.setTimeout(() => {
      setPlaybackMeasure((current) => Math.min(current + 1, analysis.measures.length - 1));
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [analysis, isPlaying, playbackMeasure]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] ?? null;
    setAudioFile(file);
    setAnalysis(null);
    setErrorMessage("");
  };

  const handleAnalyze = async () => {
    if (!audioFile) {
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.append("audio", audioFile);

      const response = await fetch(`${apiBaseUrl}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("解析 API の呼び出しに失敗しました。");
      }

      const data = await response.json();
      setAnalysis(hydrateAnalysis(data));
      setPlaybackMeasure(0);
      setIsPlaying(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "不明なエラーです。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new window.AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const chunks = [];

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setRecorder({
        stop: async () => {
          processor.disconnect();
          source.disconnect();

          for (const track of stream.getTracks()) {
            track.stop();
          }

          await audioContext.close();

          const merged = mergeChunks(chunks);
          const wavBlob = encodeWav(merged, audioContext.sampleRate);
          const file = new File([wavBlob], `recording-${Date.now()}.wav`, {
            type: "audio/wav",
          });

          setAudioFile(file);
          setRecordingLabel("WAV録音データをセットしました。解析精度が上がりやすい形式です。");
          setRecorder(null);
          setIsRecording(false);
        },
      });

      setIsRecording(true);
      setRecordingLabel("録音中です。停止すると WAV ファイルを作成します。");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "マイクの利用を開始できませんでした。");
    }
  };

  const handleStopRecording = () => {
    if (!recorder) {
      return;
    }

    recorder.stop();
  };

  const handleChordChange = (index, nextChord) => {
    setAnalysis((current) => {
      if (!current) {
        return current;
      }

      const nextCandidates = chordShapes[nextChord] ?? [];

      return {
        ...current,
        chords: current.chords.map((item, chordIndex) =>
          chordIndex === index
            ? { ...item, chord: nextChord, tabCandidates: nextCandidates, selectedTab: nextCandidates[0] ?? "" }
            : item,
        ),
        measures: current.measures.map((measure, measureIndex) =>
          measureIndex === index
            ? { ...measure, chord: nextChord, tabCandidates: nextCandidates, selectedTab: nextCandidates[0] ?? "" }
            : measure,
        ),
      };
    });
  };

  const handleTabSelect = (index, shape) => {
    setAnalysis((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        chords: current.chords.map((item, chordIndex) =>
          chordIndex === index ? { ...item, selectedTab: shape } : item,
        ),
        measures: current.measures.map((measure, measureIndex) =>
          measureIndex === index ? { ...measure, selectedTab: shape } : measure,
        ),
      };
    });
  };

  const handleRhythmChange = (index, nextPattern) => {
    setAnalysis((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        measures: current.measures.map((measure, measureIndex) =>
          measureIndex === index ? { ...measure, rhythmPattern: nextPattern } : measure,
        ),
      };
    });
  };

  const handleClearSaved = () => {
    window.localStorage.removeItem(storageKey);
    setAnalysis(null);
    setAudioFile(null);
    setErrorMessage("");
    setRecordingLabel("");
    setIsPlaying(false);
    setPlaybackMeasure(0);
  };

  const handleExportJson = () => {
    if (!analysis) {
      return;
    }

    downloadTextFile(
      `analysis-${Date.now()}.json`,
      JSON.stringify(buildExportPayload(analysis), null, 2),
      "application/json",
    );
  };

  const handleExportText = () => {
    if (!analysis) {
      return;
    }

    downloadTextFile(
      `chord-chart-${Date.now()}.txt`,
      buildChordChartText(analysis),
      "text/plain;charset=utf-8",
    );
  };

  const handleExportMidi = () => {
    if (!analysis) {
      return;
    }

    downloadBlob(`chord-chart-${Date.now()}.mid`, createMidiBlob(analysis));
  };

  const handleStartPlayback = () => {
    if (!analysis?.measures.length) {
      return;
    }

    setPlaybackMeasure(0);
    setIsPlaying(true);
  };

  const handleStopPlayback = () => {
    setIsPlaying(false);
    setPlaybackMeasure(0);
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Guitar Recording to Chords</p>
        <h1>録音からコード進行とTAB候補を作る Web アプリ</h1>
        <p className="hero-copy">
          iPhone や iPad でも扱いやすいように、録音、解析、修正、書き出しまでを1画面で進められる構成にしています。
        </p>
      </header>

      <main className="grid">
        <section className="panel">
          <h2>1. 録音アップロード</h2>
          <label className="upload-box">
            <span>録音ファイルを選択</span>
            <input type="file" accept="audio/*" onChange={handleFileChange} />
          </label>

          <div className="recording-actions">
            <button type="button" className="secondary-button" disabled={isRecording} onClick={handleStartRecording}>
              録音を開始
            </button>
            <button type="button" className="secondary-button" disabled={!isRecording} onClick={handleStopRecording}>
              録音を停止
            </button>
          </div>

          <div className="file-meta">
            <p>状態: {statusText}</p>
            <p>ファイル: {audioFile ? audioFile.name : "未選択"}</p>
            <p>録音: {recordingLabel || "未開始"}</p>
          </div>

          {errorMessage && <p className="error-text">{errorMessage}</p>}

          <button type="button" className="primary-button" disabled={!audioFile || isAnalyzing} onClick={handleAnalyze}>
            {isAnalyzing ? "解析中..." : "解析を開始"}
          </button>
        </section>

        <section className="panel">
          <h2>2. コード進行の推定結果</h2>
          {!analysis && (
            <div className="empty-state">
              <p>解析結果はここに表示されます。</p>
              <p>将来はここをバックエンド API のレスポンスで置き換えます。</p>
            </div>
          )}

          {analysis && (
            <div className="results">
              <div className="overview-grid">
                <section className="overview-card">
                  <h3>使用コード</h3>
                  <div className="overview-list">
                    {chordSummary.map((item) => (
                      <article key={item.chord} className="overview-item">
                        <strong>{item.chord}</strong>
                        <code>{item.tab || "TAB未選択"}</code>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="overview-card">
                  <h3>ストローク</h3>
                  <div className="overview-list">
                    {strokeSummary.map((item) => (
                      <article key={item.pattern} className="overview-item">
                        <strong>{item.pattern}</strong>
                        <span>{item.count} 小節</span>
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              <div className="summary-card">
                <p>入力ファイル: {analysis.fileName}</p>
                <p>推定長さ: {analysis.duration}</p>
                <p>解析エンジン: {analysis.engine}</p>
                <div className="summary-actions">
                  <button type="button" className="ghost-button" onClick={handleExportJson}>
                    JSONを書き出す
                  </button>
                  <button type="button" className="ghost-button" onClick={handleExportText}>
                    テキスト譜を書き出す
                  </button>
                  <button type="button" className="ghost-button" onClick={handleExportMidi}>
                    MIDIを書き出す
                  </button>
                  <button type="button" className="ghost-button" onClick={handleClearSaved}>
                    保存結果をクリア
                  </button>
                </div>
              </div>

              <div className="timeline">
                {analysis.chords.map((item, index) => (
                  <article key={`${item.time}-${item.chord}`} className="timeline-row">
                    <div className="timeline-meta">
                      <p className="time-label">{item.time}</p>
                      <select
                        className="chord-select"
                        value={item.chord}
                        onChange={(event) => handleChordChange(index, event.target.value)}
                      >
                        {chordOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="shape-list">
                      {(item.tabCandidates?.length ? item.tabCandidates : ["候補なし"]).map((shape) => (
                        <button
                          key={shape}
                          type="button"
                          className={`shape-chip ${item.selectedTab === shape ? "shape-chip-active" : ""}`}
                          onClick={() => handleTabSelect(index, shape)}
                        >
                          {shape}
                        </button>
                      ))}
                    </div>
                    <p className="selected-tab">
                      選択中TAB: <code>{item.selectedTab || "未選択"}</code>
                    </p>
                  </article>
                ))}
              </div>

              <p className="note-text">{analysis.notes}</p>
            </div>
          )}
        </section>

        <section className="panel full-width">
          <h2>3. コード表</h2>
          {!analysis && (
            <div className="empty-state">
              <p>解析後にコードダイアグラムとストロークの見本が表示されます。</p>
              <p>実際にギターを弾くときの見本シートとして使えます。</p>
            </div>
          )}

          {analysis && (
            <div className="chord-chart-strip">
              {chordSummary.map((item) => (
                <ChordDiagram
                  key={`chart-${item.chord}`}
                  chord={item.chord}
                  shape={item.tab}
                  rhythmPattern={item.rhythmPattern}
                />
              ))}
            </div>
          )}
        </section>

        <section className="panel full-width">
          <h2>4. 小節ごとのコード配置</h2>
          {!analysis && (
            <div className="empty-state">
              <p>解析後に小節カードが表示されます。</p>
              <p>コード、TAB、簡易リズムを小節単位で整えられます。</p>
            </div>
          )}

          {analysis && (
            <div className="measure-grid">
              {analysis.measures.map((measure, index) => (
                <article key={`measure-${measure.number}`} className="measure-card">
                  <div className="measure-head">
                    <p className="measure-number">Measure {measure.number}</p>
                    <p className="measure-time">{measure.startTime}</p>
                  </div>

                  <select
                    className="chord-select"
                    value={measure.chord}
                    onChange={(event) => handleChordChange(index, event.target.value)}
                  >
                    {chordOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>

                  <p className="measure-meta">
                    {measure.subdivision} / {measure.beats} beats
                  </p>

                  <label className="rhythm-field">
                    <span>簡易リズム</span>
                    <input
                      className="rhythm-input"
                      value={measure.rhythmPattern}
                      onChange={(event) => handleRhythmChange(index, event.target.value)}
                    />
                  </label>

                  <div className="shape-list">
                    {(measure.tabCandidates?.length ? measure.tabCandidates : ["候補なし"]).map((shape) => (
                      <button
                        key={shape}
                        type="button"
                        className={`shape-chip ${measure.selectedTab === shape ? "shape-chip-active" : ""}`}
                        onClick={() => handleTabSelect(index, shape)}
                      >
                        {shape}
                      </button>
                    ))}
                  </div>

                  <p className="selected-tab">
                    TAB候補: <code>{measure.selectedTab || "未選択"}</code>
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel full-width">
          <h2>5. 演奏モード</h2>
          {!analysis && (
            <div className="empty-state">
              <p>解析後に横スクロールのコードレーンが表示されます。</p>
              <p>演奏しながら次のコードとストロークを先読みできます。</p>
            </div>
          )}

          {analysis && (
            <div className="performance-panel">
              <div className="performance-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isPlaying}
                  onClick={handleStartPlayback}
                >
                  演奏レーンを再生
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!isPlaying && playbackMeasure === 0}
                  onClick={handleStopPlayback}
                >
                  停止して先頭へ
                </button>
              </div>

              <div className="performance-stage">
                <div className="performance-target" aria-hidden="true" />
                <div
                  className="performance-track"
                  style={{
                    transform: `translateX(calc(42% - ${playbackMeasure * 232}px))`,
                  }}
                >
                  {performanceItems.map((item) => (
                    <div
                      key={`performance-${item.number}`}
                      className={`performance-card ${item.index === playbackMeasure ? "performance-card-active" : ""}`}
                    >
                      <p className="performance-number">#{item.number}</p>
                      <ChordDiagram
                        chord={item.chord}
                        shape={item.selectedTab}
                        rhythmPattern={item.rhythmPattern}
                        compact
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
