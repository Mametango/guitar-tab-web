import { useEffect, useMemo, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "";
const defaultAuthorName = "名無しの弾き語りさん";
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
const stringOpenMidi = [40, 45, 50, 55, 59, 64];

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

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function createMeasure(chord, index) {
  const tabCandidates = chordShapes[chord] ?? [];
  return {
    number: index + 1,
    startTime: `0:${String(index * 4).padStart(2, "0")}`,
    chord,
    beats: 4,
    subdivision: "4/4",
    rhythmPattern: "Down-Up x4",
    tabCandidates,
    selectedTab: tabCandidates[0] ?? "",
  };
}

function createAnalysisFromChordText(input) {
  const measures = input
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((chord, index) => createMeasure(chord, index));

  return {
    fileName: "manual-input",
    duration: `00:${String(measures.length * 4).padStart(2, "0")}`,
    engine: "manual-chord-entry",
    notes: "PCで入力したコード進行です。必要に応じてTABとリズムを調整して公開できます。",
    chords: measures.map((measure) => ({
      time: measure.startTime,
      chord: measure.chord,
      tabCandidates: measure.tabCandidates,
      selectedTab: measure.selectedTab,
    })),
    measures,
  };
}

function createDefaultDraft() {
  const chordText = "C | G | Am | F";
  return {
    title: "新しい譜面",
    chordText,
    analysis: hydrateAnalysis(createAnalysisFromChordText(chordText)),
  };
}

function hydrateAnalysis(data) {
  if (!data) {
    return null;
  }

  const measures = (data.measures ?? []).map((measure, index) => {
    const tabCandidates = measure.tabCandidates?.length ? measure.tabCandidates : (chordShapes[measure.chord] ?? []);
    return {
      number: measure.number ?? index + 1,
      startTime: measure.startTime ?? `0:${String(index * 4).padStart(2, "0")}`,
      chord: measure.chord ?? "C",
      beats: measure.beats ?? 4,
      subdivision: measure.subdivision ?? "4/4",
      rhythmPattern: measure.rhythmPattern ?? "Down-Up x4",
      tabCandidates,
      selectedTab: measure.selectedTab ?? tabCandidates[0] ?? "",
    };
  });

  const chords = measures.map((measure) => ({
    time: measure.startTime,
    chord: measure.chord,
    tabCandidates: measure.tabCandidates,
    selectedTab: measure.selectedTab,
  }));

  return {
    ...data,
    fileName: data.fileName ?? "manual-input",
    duration: data.duration ?? `00:${String(measures.length * 4).padStart(2, "0")}`,
    engine: data.engine ?? "manual-chord-entry",
    notes: data.notes ?? "",
    chords,
    measures,
  };
}

function getRoute() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  const mode = parts[0] === "play" ? "play" : "edit";
  const scoreId = parts.length > 1 ? parts[1] : "";
  return { mode, scoreId };
}

function navigateTo(pathname) {
  const normalized = pathname.replace(/^\//, "");
  window.location.hash = normalized ? `#/${normalized}` : "#/";
}

function ChordDiagram({ chord, shape, rhythmPattern, onPlay }) {
  const frets = normalizeTabShape(shape);
  const numericFrets = frets
    .map((value) => (value === "x" || value === "0" ? null : Number(value)))
    .filter((value) => Number.isFinite(value));
  const minFret = numericFrets.length > 0 ? Math.min(...numericFrets) : 1;
  const baseFret = minFret > 1 ? minFret : 1;

  return (
    <article className="chord-card">
      <button type="button" className="ghost-button inline-action" onClick={onPlay}>
        音を鳴らす
      </button>
      <h3>{chord}</h3>
      <div className="diagram-shell">
        {baseFret > 1 && <span className="base-fret">{baseFret}fr</span>}
        <div className="string-status-row">
          {frets.map((value, index) => (
            <span key={`${chord}-${index}`} className="string-status">
              {value === "x" ? "X" : value === "0" ? "O" : ""}
            </span>
          ))}
        </div>
        <div className="diagram-grid" aria-label={`${chord} chord diagram`}>
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
      <p className="diagram-tab">{shape || "TABなし"}</p>
      <p className="diagram-rhythm">{rhythmPattern || "Down-Up x4"}</p>
    </article>
  );
}

function App() {
  const defaultDraft = createDefaultDraft();
  const [route, setRoute] = useState(() => getRoute());
  const [scoreTitle, setScoreTitle] = useState(defaultDraft.title);
  const [manualChordText, setManualChordText] = useState(defaultDraft.chordText);
  const [analysis, setAnalysis] = useState(defaultDraft.analysis);
  const [scoreId, setScoreId] = useState(() => getRoute().scoreId);
  const [publicScores, setPublicScores] = useState([]);
  const [audioFile, setAudioFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingScore, setIsLoadingScore] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMeasure, setPlaybackMeasure] = useState(0);
  const [tempoBpm, setTempoBpm] = useState(72);
  const [recordingLabel, setRecordingLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [audioContextState, setAudioContextState] = useState(null);
  const [recorder, setRecorder] = useState(null);
  const [isRecording, setIsRecording] = useState(false);

  const shareUrl = useMemo(() => {
    if (!scoreId) {
      return "";
    }

    return `${window.location.origin}${window.location.pathname}#/play/${scoreId}`;
  }, [scoreId]);

  const chordSummary = useMemo(() => {
    if (!analysis) {
      return [];
    }

    const seen = new Set();
    return analysis.measures.filter((measure) => {
      if (seen.has(measure.chord)) {
        return false;
      }

      seen.add(measure.chord);
      return true;
    });
  }, [analysis]);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRoute());
    };

    window.addEventListener("hashchange", handlePopState);
    return () => window.removeEventListener("hashchange", handlePopState);
  }, []);

  useEffect(() => {
    async function loadScores() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/scores`);
        if (!response.ok) {
          throw new Error("公開譜面を取得できませんでした。");
        }

        const data = await response.json();
        setPublicScores(Array.isArray(data.scores) ? data.scores : []);
      } catch {
        setPublicScores([]);
      }
    }

    loadScores();
  }, []);

  useEffect(() => {
    async function loadScoreByRoute() {
      if (!route.scoreId) {
        setScoreId("");
        if (route.mode === "edit") {
          const nextDraft = createDefaultDraft();
          setScoreTitle(nextDraft.title);
          setManualChordText(nextDraft.chordText);
          setAnalysis(nextDraft.analysis);
          setErrorMessage("");
        }
        return;
      }

      setIsLoadingScore(true);
      setErrorMessage("");
      setAnalysis(null);

      try {
        const response = await fetch(`${apiBaseUrl}/api/scores/${route.scoreId}`);
        if (!response.ok) {
          throw new Error("譜面を読み込めませんでした。");
        }

        const data = await response.json();
        setScoreId(data.id);
        setScoreTitle(data.title ?? "新しい譜面");
        setAnalysis(hydrateAnalysis(data));
        setManualChordText(
          (data.measures ?? [])
            .map((measure) => measure.chord)
            .filter(Boolean)
            .join(" | "),
        );
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "譜面の読み込みに失敗しました。");
      } finally {
        setIsLoadingScore(false);
      }
    }

    loadScoreByRoute();
  }, [route.scoreId]);

  useEffect(() => {
    if (!analysis || !isPlaying) {
      return undefined;
    }

    const intervalMs = Math.max(500, (60 / tempoBpm) * 4000);

    if (playbackMeasure >= analysis.measures.length - 1) {
      const doneTimer = window.setTimeout(() => {
        setIsPlaying(false);
      }, intervalMs);
      return () => window.clearTimeout(doneTimer);
    }

    const timer = window.setTimeout(() => {
      setPlaybackMeasure((current) => Math.min(current + 1, analysis.measures.length - 1));
    }, intervalMs);

    return () => window.clearTimeout(timer);
  }, [analysis, isPlaying, playbackMeasure, tempoBpm]);

  const summaryText = analysis
    ? `${analysis.measures.length}小節 / ${chordSummary.length}コード / ${analysis.engine}`
    : "まだ譜面がありません";

  const performanceItems = analysis?.measures ?? [];

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] ?? null;
    setAudioFile(file);
    setErrorMessage("");
    setSaveMessage("");
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
        throw new Error("音声解析に失敗しました。");
      }

      const data = await response.json();
      const nextAnalysis = hydrateAnalysis(data);
      setAnalysis(nextAnalysis);
      setManualChordText(nextAnalysis.measures.map((measure) => measure.chord).join(" | "));
      setPlaybackMeasure(0);
      setIsPlaying(false);
      setSaveMessage("解析結果を編集画面に反映しました。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "音声解析に失敗しました。");
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
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
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

          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const samples = new Float32Array(totalLength);
          let offset = 0;
          chunks.forEach((chunk) => {
            samples.set(chunk, offset);
            offset += chunk.length;
          });

          const buffer = new ArrayBuffer(44 + samples.length * 2);
          const view = new DataView(buffer);
          const writeString = (position, value) => {
            for (let index = 0; index < value.length; index += 1) {
              view.setUint8(position + index, value.charCodeAt(index));
            }
          };

          writeString(0, "RIFF");
          view.setUint32(4, 36 + samples.length * 2, true);
          writeString(8, "WAVE");
          writeString(12, "fmt ");
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, audioContext.sampleRate, true);
          view.setUint32(28, audioContext.sampleRate * 2, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          writeString(36, "data");
          view.setUint32(40, samples.length * 2, true);

          let sampleOffset = 44;
          for (let index = 0; index < samples.length; index += 1) {
            const sample = Math.max(-1, Math.min(1, samples[index]));
            view.setInt16(sampleOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            sampleOffset += 2;
          }

          await audioContext.close();

          const wavBlob = new Blob([buffer], { type: "audio/wav" });
          const file = new File([wavBlob], `recording-${Date.now()}.wav`, { type: "audio/wav" });
          setAudioFile(file);
          setRecordingLabel("録音をWAVに変換してセットしました。");
          setIsRecording(false);
          setRecorder(null);
        },
      });

      setIsRecording(true);
      setRecordingLabel("録音中です。止めるとWAVとして解析できます。");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "マイクの利用に失敗しました。");
    }
  };

  const handleStopRecording = () => {
    if (recorder) {
      recorder.stop();
    }
  };

  const handleManualCreate = () => {
    const nextAnalysis = hydrateAnalysis(createAnalysisFromChordText(manualChordText));

    if (!nextAnalysis.measures.length) {
      setErrorMessage("`C | G | Am | F` のようにコードを入力してください。");
      return;
    }

    setAnalysis(nextAnalysis);
    setPlaybackMeasure(0);
    setIsPlaying(false);
    setErrorMessage("");
    setSaveMessage("入力したコード進行から譜面を作成しました。");
  };

  const handleChordChange = (index, nextChord) => {
    setAnalysis((current) => {
      if (!current) {
        return current;
      }

      const nextCandidates = chordShapes[nextChord] ?? [];
      const measures = current.measures.map((measure, measureIndex) =>
        measureIndex === index
          ? { ...measure, chord: nextChord, tabCandidates: nextCandidates, selectedTab: nextCandidates[0] ?? "" }
          : measure,
      );

      return {
        ...current,
        measures,
        chords: measures.map((measure) => ({
          time: measure.startTime,
          chord: measure.chord,
          tabCandidates: measure.tabCandidates,
          selectedTab: measure.selectedTab,
        })),
      };
    });
  };

  const handleRhythmChange = (index, nextPattern) => {
    setAnalysis((current) => {
      if (!current) {
        return current;
      }

      const measures = current.measures.map((measure, measureIndex) =>
        measureIndex === index ? { ...measure, rhythmPattern: nextPattern } : measure,
      );

      return {
        ...current,
        measures,
        chords: measures.map((measure) => ({
          time: measure.startTime,
          chord: measure.chord,
          tabCandidates: measure.tabCandidates,
          selectedTab: measure.selectedTab,
        })),
      };
    });
  };

  const handleTabSelect = (index, shape) => {
    setAnalysis((current) => {
      if (!current) {
        return current;
      }

      const measures = current.measures.map((measure, measureIndex) =>
        measureIndex === index ? { ...measure, selectedTab: shape } : measure,
      );

      return {
        ...current,
        measures,
        chords: measures.map((measure) => ({
          time: measure.startTime,
          chord: measure.chord,
          tabCandidates: measure.tabCandidates,
          selectedTab: measure.selectedTab,
        })),
      };
    });
  };

  const ensureAudioContext = async () => {
    if (audioContextState) {
      if (audioContextState.state === "suspended") {
        await audioContextState.resume();
      }
      return audioContextState;
    }

    const context = new window.AudioContext();
    setAudioContextState(context);
    return context;
  };

  const handlePlayChord = async (shape) => {
    const context = await ensureAudioContext();
    const frets = normalizeTabShape(shape);
    const now = context.currentTime;

    frets.forEach((value, index) => {
      if (value === "x") {
        return;
      }

      const fret = value === "0" ? 0 : Number(value);
      if (!Number.isFinite(fret)) {
        return;
      }

      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      const startAt = now + index * 0.045;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(midiToFrequency(stringOpenMidi[index] + fret), startAt);
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.6);
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 1.7);
    });
  };

  const refreshScores = async () => {
    const response = await fetch(`${apiBaseUrl}/api/scores`);
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    setPublicScores(Array.isArray(data.scores) ? data.scores : []);
  };

  const handleSaveScore = async () => {
    if (!analysis) {
      setErrorMessage("保存する譜面がありません。");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    setSaveMessage("");

    try {
      const payload = {
        id: scoreId || undefined,
        title: scoreTitle,
        authorName: defaultAuthorName,
        ...analysis,
      };

      const response = await fetch(`${apiBaseUrl}/api/scores`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("譜面の保存に失敗しました。");
      }

      const saved = await response.json();
      setScoreId(saved.id);
      setScoreTitle(saved.title);
      setAnalysis(hydrateAnalysis(saved));
      setSaveMessage("公開譜面として保存しました。iPadでは再生画面を開いて使えます。");
      await refreshScores();

      if (route.mode === "edit" && !route.scoreId) {
        navigateTo(`/edit/${saved.id}`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "譜面の保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyShareUrl = async () => {
    if (!shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setSaveMessage("再生URLをコピーしました。");
    } catch {
      setSaveMessage("再生URLを表示しました。手動でコピーしてください。");
    }
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

  if (route.mode === "play") {
    return (
      <div className="app-shell play-shell">
        <header className="hero hero-play">
          <div>
            <p className="eyebrow">みんなのギター広場</p>
            <h1>{scoreTitle}</h1>
            <p className="hero-copy">
              {defaultAuthorName} が公開した譜面です。iPadで開いて、再生しながら弾ける表示にしています。
            </p>
          </div>
          <div className="play-hero-card">
            <p>作者</p>
            <strong>{defaultAuthorName}</strong>
            <p>概要</p>
            <strong>{summaryText}</strong>
          </div>
        </header>

        {isLoadingScore && <section className="panel">譜面を読み込み中です。</section>}
        {errorMessage && <section className="panel error-panel">{errorMessage}</section>}

        {analysis && (
          <main className="play-layout">
            <section className="panel player-toolbar">
              <div className="toolbar-block">
                <span className="toolbar-label">再生</span>
                <div className="performance-actions">
                  <button type="button" className="secondary-button" disabled={isPlaying} onClick={handleStartPlayback}>
                    スタート
                  </button>
                  <button type="button" className="secondary-button" onClick={handleStopPlayback}>
                    停止
                  </button>
                </div>
              </div>
              <div className="toolbar-block">
                <span className="toolbar-label">テンポ</span>
                <label className="tempo-control">
                  <input
                    type="range"
                    min="50"
                    max="140"
                    value={tempoBpm}
                    onChange={(event) => setTempoBpm(Number(event.target.value))}
                  />
                  <strong>{tempoBpm} BPM</strong>
                </label>
              </div>
              <div className="toolbar-block">
                <span className="toolbar-label">移動</span>
                <div className="performance-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setPlaybackMeasure((current) => Math.max(0, current - 1))}
                  >
                    前の小節
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      setPlaybackMeasure((current) => Math.min(current + 1, Math.max(0, performanceItems.length - 1)))
                    }
                  >
                    次の小節
                  </button>
                </div>
              </div>
            </section>

            <section className="performance-canvas">
              <div className="performance-target-band" aria-hidden="true" />
              <div
                className="performance-strip"
                style={{ transform: `translateX(calc(50vw - ${playbackMeasure * 312 + 170}px))` }}
              >
                {performanceItems.map((measure, index) => (
                  <article
                    key={`play-${measure.number}`}
                    className={`performance-screen-card ${index === playbackMeasure ? "performance-screen-card-active" : ""}`}
                  >
                    <p className="performance-number">#{measure.number}</p>
                    <ChordDiagram
                      chord={measure.chord}
                      shape={measure.selectedTab}
                      rhythmPattern={measure.rhythmPattern}
                      onPlay={() => handlePlayChord(measure.selectedTab)}
                    />
                  </article>
                ))}
              </div>
            </section>

            <section className="panel cue-panel">
              <div>
                <p className="section-kicker">現在の小節</p>
                <h2>
                  {performanceItems[playbackMeasure]?.chord ?? "-"} / {performanceItems[playbackMeasure]?.rhythmPattern ?? "-"}
                </h2>
              </div>
              <div>
                <p className="section-kicker">次のコード</p>
                <h2>{performanceItems[playbackMeasure + 1]?.chord ?? "END"}</h2>
              </div>
              <button type="button" className="ghost-button" onClick={() => navigateTo(`/edit/${scoreId}`)}>
                編集画面へ
              </button>
            </section>
          </main>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">みんなのギター広場</p>
        <h1>PCで譜面を作って、iPadで見ながら弾ける共有型ギター譜サービス</h1>
        <p className="hero-copy">
          入力者は {defaultAuthorName} として保存されます。コード進行を作って公開すると、再生専用URLをiPadで開いてそのまま演奏に使えます。
        </p>
      </header>

      <section className="workspace-bar">
        <div className="workspace-summary">
          <strong>現在の譜面</strong>
          <span>{summaryText}</span>
        </div>
        <div className="workspace-tabs">
          <button type="button" className="workspace-tab" onClick={() => navigateTo("/")}>
            新規作成
          </button>
          {scoreId && (
            <button type="button" className="workspace-tab" onClick={() => navigateTo(`/play/${scoreId}`)}>
              iPad再生画面
            </button>
          )}
        </div>
      </section>

      <main className="editor-layout">
        <section className="panel editor-main">
          <div className="panel-head">
            <div>
              <p className="section-kicker">譜面編集</p>
              <h2>{scoreId ? "保存済み譜面を編集" : "新しい譜面を作る"}</h2>
            </div>
            <div className="author-badge">{defaultAuthorName}</div>
          </div>

          <label className="field-stack">
            <span>譜面タイトル</span>
            <input
              className="text-input"
              value={scoreTitle}
              onChange={(event) => setScoreTitle(event.target.value)}
              placeholder="例: 卒業式で弾く曲"
            />
          </label>

          <div className="editor-grid">
            <section className="editor-card">
              <p className="section-kicker">手入力</p>
              <p className="helper-text">`C | G | Am | F` の形式で入力して、譜面の土台を作ります。</p>
              <textarea
                className="manual-textarea"
                value={manualChordText}
                onChange={(event) => setManualChordText(event.target.value)}
              />
              <div className="button-row">
                <button type="button" className="primary-button" onClick={handleManualCreate}>
                  コード進行から譜面作成
                </button>
              </div>
            </section>

            <section className="editor-card">
              <p className="section-kicker">音声入力</p>
              <p className="helper-text">WAVを解析してコード候補を作れます。まずは手入力メイン、音声は補助として使えます。</p>
              <label className="upload-box">
                <span>音声ファイルを選ぶ</span>
                <input type="file" accept="audio/*" onChange={handleFileChange} />
              </label>
              <div className="recording-actions">
                <button type="button" className="secondary-button" disabled={isRecording} onClick={handleStartRecording}>
                  録音開始
                </button>
                <button type="button" className="secondary-button" disabled={!isRecording} onClick={handleStopRecording}>
                  録音停止
                </button>
              </div>
              <p className="helper-text">{recordingLabel || "録音するとWAV化して解析できます。"}</p>
              <button type="button" className="ghost-button" disabled={!audioFile || isAnalyzing} onClick={handleAnalyze}>
                {isAnalyzing ? "解析中..." : "音声から譜面候補を作る"}
              </button>
            </section>
          </div>

          {errorMessage && <p className="error-text">{errorMessage}</p>}
          {saveMessage && <p className="success-text">{saveMessage}</p>}

          {analysis && (
            <>
              <section className="editor-card">
                <div className="panel-head">
                  <div>
                    <p className="section-kicker">小節編集</p>
                    <h3>公開前にコードとTABを整える</h3>
                  </div>
                  <div className="summary-pill">{summaryText}</div>
                </div>
                <div className="measure-grid">
                  {analysis.measures.map((measure, index) => (
                    <article key={`measure-${measure.number}`} className="measure-card">
                      <div className="measure-head">
                        <p className="measure-number">#{measure.number}</p>
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
                      <label className="field-stack">
                        <span>リズム</span>
                        <input
                          className="rhythm-input"
                          value={measure.rhythmPattern}
                          onChange={(event) => handleRhythmChange(index, event.target.value)}
                        />
                      </label>
                      <div className="shape-list">
                        {(measure.tabCandidates?.length ? measure.tabCandidates : ["TABなし"]).map((shape) => (
                          <button
                            key={`${measure.number}-${shape}`}
                            type="button"
                            className={`shape-chip ${measure.selectedTab === shape ? "shape-chip-active" : ""}`}
                            onClick={() => handleTabSelect(index, shape)}
                          >
                            {shape}
                          </button>
                        ))}
                      </div>
                      <p className="selected-tab">選択中TAB: <code>{measure.selectedTab || "TABなし"}</code></p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="editor-card">
                <div className="panel-head">
                  <div>
                    <p className="section-kicker">公開プレビュー</p>
                    <h3>iPad再生画面に近い見え方</h3>
                  </div>
                </div>
                <div className="preview-strip">
                  {chordSummary.map((measure) => (
                    <ChordDiagram
                      key={`preview-${measure.number}`}
                      chord={measure.chord}
                      shape={measure.selectedTab}
                      rhythmPattern={measure.rhythmPattern}
                      onPlay={() => handlePlayChord(measure.selectedTab)}
                    />
                  ))}
                </div>
              </section>
            </>
          )}

          <section className="panel-footer">
            <button type="button" className="primary-button save-button" disabled={isSaving} onClick={handleSaveScore}>
              {isSaving ? "保存中..." : "公開譜面として保存"}
            </button>
            {shareUrl && (
              <div className="share-box">
                <p className="section-kicker">iPad再生URL</p>
                <code>{shareUrl}</code>
                <div className="button-row">
                  <button type="button" className="ghost-button" onClick={handleCopyShareUrl}>
                    URLをコピー
                  </button>
                  <button type="button" className="ghost-button" onClick={() => navigateTo(`/play/${scoreId}`)}>
                    再生画面を開く
                  </button>
                </div>
              </div>
            )}
          </section>
        </section>

        <aside className="panel public-sidebar">
          <p className="section-kicker">公開譜面</p>
          <h2>みんなのギター広場に保存された譜面</h2>
          <p className="helper-text">公開済みの譜面は、編集画面でも再生画面でもすぐ開けます。</p>
          <div className="public-score-list">
            {publicScores.map((score) => (
              <article key={score.id} className="public-score-card">
                <p className="public-score-meta">{score.authorName}</p>
                <h3>{score.title}</h3>
                <p>{score.measureCount}小節 / {score.duration}</p>
                <div className="button-row">
                  <button type="button" className="ghost-button" onClick={() => navigateTo(`/edit/${score.id}`)}>
                    編集で開く
                  </button>
                  <button type="button" className="ghost-button" onClick={() => navigateTo(`/play/${score.id}`)}>
                    iPad再生
                  </button>
                </div>
              </article>
            ))}
            {!publicScores.length && <p className="helper-text">まだ公開譜面はありません。</p>}
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
