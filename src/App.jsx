import { useEffect, useMemo, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "";
const defaultAuthorName = "名無しの弾き語りさん";
const defaultSectionName = "Aメロ";
const defaultManualText = `[イントロ] C | G | Am | F
[Aメロ] C | G | Am | F
[サビ] F | G | C | C`;
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
const swipeThreshold = 48;
const tapThreshold = 10;

function createId(prefix = "section") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
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

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function makeMeasure(chord, index, sectionName, sectionId) {
  const tabCandidates = chordShapes[chord] ?? [];
  return {
    id: `${sectionId}-measure-${index + 1}`,
    number: index + 1,
    startTime: `0:${String(index * 4).padStart(2, "0")}`,
    chord,
    beats: 4,
    subdivision: "4/4",
    rhythmPattern: "Down-Up x4",
    tabCandidates,
    selectedTab: tabCandidates[0] ?? "",
    sectionName,
    sectionId,
  };
}

function normalizeSection(section, index) {
  const sectionId = section.id || createId("section");
  const sectionName = section.name?.trim() || `${defaultSectionName}${index + 1}`;
  const measures = (section.measures ?? []).map((measure, measureIndex) => {
    const chord = measure.chord || "C";
    const tabCandidates = measure.tabCandidates?.length ? measure.tabCandidates : (chordShapes[chord] ?? []);
    return {
      id: measure.id || `${sectionId}-measure-${measureIndex + 1}`,
      number: measure.number ?? measureIndex + 1,
      startTime: measure.startTime ?? `0:${String(measureIndex * 4).padStart(2, "0")}`,
      chord,
      beats: measure.beats ?? 4,
      subdivision: measure.subdivision ?? "4/4",
      rhythmPattern: measure.rhythmPattern ?? "Down-Up x4",
      tabCandidates,
      selectedTab: measure.selectedTab ?? tabCandidates[0] ?? "",
      sectionName,
      sectionId,
    };
  });

  return {
    id: sectionId,
    name: sectionName,
    measures,
  };
}

function createSectionsFromText(input) {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedSections = lines.map((line, index) => {
    const match = line.match(/^\[(.+?)\]\s*(.+)$/);
    const name = match?.[1]?.trim() || (index === 0 ? defaultSectionName : `セクション${index + 1}`);
    const progressionText = match?.[2] ?? line;
    const sectionId = createId("section");
    const measures = progressionText
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((chord, measureIndex) => makeMeasure(chord, measureIndex, name, sectionId));

    return {
      id: sectionId,
      name,
      measures,
    };
  });

  if (!parsedSections.length) {
    return [{
      id: createId("section"),
      name: defaultSectionName,
      measures: [],
    }];
  }

  return parsedSections;
}

function flattenMeasures(sections) {
  return sections.flatMap((section) =>
    section.measures.map((measure, index) => ({
      ...measure,
      number: index + 1,
      sectionName: section.name,
      sectionId: section.id,
    })),
  );
}

function toChordTimeline(sections) {
  return flattenMeasures(sections).map((measure) => ({
    time: measure.startTime,
    chord: measure.chord,
    tabCandidates: measure.tabCandidates,
    selectedTab: measure.selectedTab,
    sectionName: measure.sectionName,
    sectionId: measure.sectionId,
  }));
}

function buildScoreFromSections({ title, sections, fileName = "manual-input", engine = "manual-chord-entry", notes = "" }) {
  const normalizedSections = sections.map(normalizeSection);
  const measureCount = normalizedSections.reduce((sum, section) => sum + section.measures.length, 0);

  return {
    title: title?.trim() || "新しい譜面",
    fileName,
    duration: `00:${String(measureCount * 4).padStart(2, "0")}`,
    engine,
    notes,
    sections: normalizedSections,
    measures: flattenMeasures(normalizedSections),
    chords: toChordTimeline(normalizedSections),
  };
}

function hydrateScore(data) {
  if (!data) {
    return null;
  }

  if (Array.isArray(data.sections) && data.sections.length) {
    return buildScoreFromSections({
      title: data.title,
      sections: data.sections,
      fileName: data.fileName,
      engine: data.engine,
      notes: data.notes,
    });
  }

  const fallbackName = data.measures?.[0]?.sectionName || defaultSectionName;
  const fallbackId = createId("section");
  const fallbackMeasures = (data.measures ?? []).map((measure, index) => ({
    ...makeMeasure(measure.chord || "C", index, fallbackName, fallbackId),
    ...measure,
    sectionName: measure.sectionName || fallbackName,
    sectionId: measure.sectionId || fallbackId,
  }));

  return buildScoreFromSections({
    title: data.title,
    sections: [{
      id: fallbackId,
      name: fallbackName,
      measures: fallbackMeasures,
    }],
    fileName: data.fileName,
    engine: data.engine,
    notes: data.notes,
  });
}

function createDefaultDraft() {
  const sections = createSectionsFromText(defaultManualText);
  return {
    title: "新しい譜面",
    manualText: defaultManualText,
    score: buildScoreFromSections({
      title: "新しい譜面",
      sections,
      notes: "セクション単位で整理した譜面です。",
    }),
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

function buildSavePayload(score, scoreId, title) {
  const hydrated = buildScoreFromSections({
    title,
    sections: score.sections,
    fileName: score.fileName,
    engine: score.engine,
    notes: score.notes,
  });

  return {
    id: scoreId || undefined,
    title: title.trim() || hydrated.title,
    authorName: defaultAuthorName,
    fileName: hydrated.fileName,
    duration: hydrated.duration,
    engine: hydrated.engine,
    notes: hydrated.notes,
    sections: hydrated.sections,
    measures: hydrated.measures,
    chords: hydrated.chords,
  };
}

function ChordDiagram({ chord, shape, rhythmPattern, onPlay }) {
  const frets = normalizeTabShape(shape);
  const numericFrets = frets
    .map((value) => (value === "x" || value === "0" ? null : Number(value)))
    .filter((value) => Number.isFinite(value));
  const minFret = numericFrets.length > 0 ? Math.min(...numericFrets) : 1;
  const baseFret = minFret > 1 ? minFret : 1;
  const displayStrings = frets
    .map((value, index) => ({
      value,
      stringNumber: 6 - index,
    }))
    .reverse();

  return (
    <article className="chord-card">
      <button type="button" className="ghost-button inline-action" onClick={onPlay}>
        音を鳴らす
      </button>
      <h3>{chord}</h3>
      <div className="diagram-shell chord-board-shell">
        {baseFret > 1 && <span className="base-fret">{baseFret}fr</span>}
        <div className="chord-board">
          <div className="status-rail" aria-hidden="true">
            {displayStrings.map((item) => (
              <span key={`status-${chord}-${item.stringNumber}`} className="status-mark">
                {item.value === "x" ? "X" : item.value === "0" ? "O" : ""}
              </span>
            ))}
          </div>
          <div className="diagram-grid horizontal-diagram" aria-label={`${chord} chord diagram`}>
            {Array.from({ length: 6 }).map((_, stringIndex) => (
              <div
                key={`string-row-${stringIndex}`}
                className="diagram-string-line horizontal-string-line"
                style={{ top: `${stringIndex * 20}%` }}
              />
            ))}
            {Array.from({ length: 5 }).map((_, fretIndex) => (
              <div
                key={`fret-column-${fretIndex}`}
                className="diagram-fret-line vertical-fret-line"
                style={{ left: `${fretIndex * 25}%` }}
              />
            ))}
            {displayStrings.map((item, rowIndex) => {
              if (item.value === "x" || item.value === "0") {
                return null;
              }

              const numeric = Number(item.value);
              if (!Number.isFinite(numeric)) {
                return null;
              }

              const column = baseFret > 1 ? numeric - baseFret : numeric - 1;
              return (
                <span
                  key={`dot-${chord}-${item.stringNumber}`}
                  className="diagram-dot board-dot"
                  style={{
                    left: `${12.5 + Math.max(0, column) * 25}%`,
                    top: `${rowIndex * 20}%`,
                  }}
                />
              );
            })}
          </div>
          <div className="string-label-rail" aria-hidden="true">
            {displayStrings.map((item) => (
              <span key={`label-${chord}-${item.stringNumber}`} className="string-label-mark">
                {item.stringNumber}弦
              </span>
            ))}
          </div>
        </div>
        <div className="fret-label-row" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <span key={`fret-label-${index}`}>{baseFret + index}</span>
          ))}
        </div>
      </div>
      <p className="diagram-tab">{shape || "TABなし"}</p>
      <p className="diagram-rhythm">{rhythmPattern || "Down-Up x4"}</p>
    </article>
  );
}

export default function App() {
  const defaultDraft = createDefaultDraft();
  const [route, setRoute] = useState(() => getRoute());
  const [scoreTitle, setScoreTitle] = useState(defaultDraft.title);
  const [manualSectionText, setManualSectionText] = useState(defaultDraft.manualText);
  const [score, setScore] = useState(defaultDraft.score);
  const [scoreId, setScoreId] = useState(() => getRoute().scoreId);
  const [selectedSectionId, setSelectedSectionId] = useState(defaultDraft.score.sections[0]?.id || "");
  const [playSectionId, setPlaySectionId] = useState(defaultDraft.score.sections[0]?.id || "");
  const [publicScores, setPublicScores] = useState([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [audioFile, setAudioFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImportingYoutube, setIsImportingYoutube] = useState(false);
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
  const [touchSession, setTouchSession] = useState(null);

  const selectedSection = useMemo(
    () => score?.sections.find((section) => section.id === selectedSectionId) ?? score?.sections[0] ?? null,
    [score, selectedSectionId],
  );
  const activePlaySection = useMemo(
    () => score?.sections.find((section) => section.id === playSectionId) ?? score?.sections[0] ?? null,
    [score, playSectionId],
  );
  const shareUrl = useMemo(() => {
    if (!scoreId) {
      return "";
    }
    return `${window.location.origin}${window.location.pathname}#/play/${scoreId}`;
  }, [scoreId]);

  const summaryText = score
    ? `${score.sections.length}セクション / ${score.measures.length}小節 / ${score.engine}`
    : "まだ譜面がありません";

  useEffect(() => {
    const handleHashChange = () => setRoute(getRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
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
        if (route.mode === "edit") {
          const draft = createDefaultDraft();
          setScoreTitle(draft.title);
          setManualSectionText(draft.manualText);
          setScore(draft.score);
          setSelectedSectionId(draft.score.sections[0]?.id || "");
          setPlaySectionId(draft.score.sections[0]?.id || "");
          setScoreId("");
          setErrorMessage("");
        }
        return;
      }

      setIsLoadingScore(true);
      setErrorMessage("");

      try {
        const response = await fetch(`${apiBaseUrl}/api/scores/${route.scoreId}`);
        if (!response.ok) {
          throw new Error("譜面を読み込めませんでした。");
        }

        const data = await response.json();
        const hydrated = hydrateScore(data);
        const nextSectionId = hydrated.sections[0]?.id || "";
        setScoreId(data.id);
        setScoreTitle(data.title ?? "新しい譜面");
        setScore(hydrated);
        setSelectedSectionId(nextSectionId);
        setPlaySectionId(nextSectionId);
        setManualSectionText(
          hydrated.sections.map((section) => `[${section.name}] ${section.measures.map((measure) => measure.chord).join(" | ")}`).join("\n"),
        );
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "譜面の読み込みに失敗しました。");
      } finally {
        setIsLoadingScore(false);
      }
    }

    loadScoreByRoute();
  }, [route.scoreId, route.mode]);

  useEffect(() => {
    if (!activePlaySection?.measures.length || !isPlaying) {
      return undefined;
    }

    const intervalMs = Math.max(500, (60 / tempoBpm) * 4000);
    if (playbackMeasure >= activePlaySection.measures.length - 1) {
      const timer = window.setTimeout(() => setIsPlaying(false), intervalMs);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      setPlaybackMeasure((current) => Math.min(current + 1, activePlaySection.measures.length - 1));
    }, intervalMs);

    return () => window.clearTimeout(timer);
  }, [activePlaySection, isPlaying, playbackMeasure, tempoBpm]);

  const updateSection = (sectionId, updater) => {
    setScore((current) => {
      if (!current) {
        return current;
      }

      const nextSections = current.sections.map((section, index) =>
        section.id === sectionId ? normalizeSection(updater(section), index) : section,
      );

      return buildScoreFromSections({
        title: scoreTitle,
        sections: nextSections,
        fileName: current.fileName,
        engine: current.engine,
        notes: current.notes,
      });
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

  const handleCreateFromText = () => {
    const sections = createSectionsFromText(manualSectionText);
    const nextScore = buildScoreFromSections({
      title: scoreTitle,
      sections,
      notes: "セクション単位で整理した譜面です。",
    });

    if (!nextScore.measures.length) {
      setErrorMessage("`[Aメロ] C | G | Am | F` のように入力してください。");
      return;
    }

    setScore(nextScore);
    setSelectedSectionId(nextScore.sections[0]?.id || "");
    setPlaySectionId(nextScore.sections[0]?.id || "");
    setPlaybackMeasure(0);
    setIsPlaying(false);
    setSaveMessage("セクションごとに譜面を作成しました。");
    setErrorMessage("");
  };

  const handleAddSection = () => {
    const sectionId = createId("section");
    const newSection = normalizeSection({
      id: sectionId,
      name: `セクション${score.sections.length + 1}`,
      measures: [makeMeasure("C", 0, `セクション${score.sections.length + 1}`, sectionId)],
    }, score.sections.length);

    const nextScore = buildScoreFromSections({
      title: scoreTitle,
      sections: [...score.sections, newSection],
      fileName: score.fileName,
      engine: score.engine,
      notes: score.notes,
    });

    setScore(nextScore);
    setSelectedSectionId(newSection.id);
    setPlaySectionId(newSection.id);
    setManualSectionText(
      nextScore.sections.map((section) => `[${section.name}] ${section.measures.map((measure) => measure.chord).join(" | ")}`).join("\n"),
    );
  };

  const handleRemoveSection = (sectionId) => {
    if (score.sections.length <= 1) {
      return;
    }

    const remaining = score.sections.filter((section) => section.id !== sectionId);
    const nextScore = buildScoreFromSections({
      title: scoreTitle,
      sections: remaining,
      fileName: score.fileName,
      engine: score.engine,
      notes: score.notes,
    });

    setScore(nextScore);
    setSelectedSectionId(remaining[0]?.id || "");
    setPlaySectionId(remaining[0]?.id || "");
    setManualSectionText(
      nextScore.sections.map((section) => `[${section.name}] ${section.measures.map((measure) => measure.chord).join(" | ")}`).join("\n"),
    );
  };

  const handleRenameSection = (sectionId, nextName) => {
    updateSection(sectionId, (section) => ({
      ...section,
      name: nextName,
      measures: section.measures.map((measure) => ({
        ...measure,
        sectionName: nextName,
      })),
    }));
  };

  const handleChordChange = (sectionId, measureIndex, nextChord) => {
    updateSection(sectionId, (section) => {
      const tabCandidates = chordShapes[nextChord] ?? [];
      return {
        ...section,
        measures: section.measures.map((measure, index) =>
          index === measureIndex
            ? {
                ...measure,
                chord: nextChord,
                tabCandidates,
                selectedTab: tabCandidates[0] ?? "",
              }
            : measure,
        ),
      };
    });
  };

  const handleRhythmChange = (sectionId, measureIndex, nextPattern) => {
    updateSection(sectionId, (section) => ({
      ...section,
      measures: section.measures.map((measure, index) =>
        index === measureIndex ? { ...measure, rhythmPattern: nextPattern } : measure,
      ),
    }));
  };

  const handleTabSelect = (sectionId, measureIndex, shape) => {
    updateSection(sectionId, (section) => ({
      ...section,
      measures: section.measures.map((measure, index) =>
        index === measureIndex ? { ...measure, selectedTab: shape } : measure,
      ),
    }));
  };

  const handleAddMeasure = (sectionId) => {
    updateSection(sectionId, (section) => ({
      ...section,
      measures: [...section.measures, makeMeasure("C", section.measures.length, section.name, section.id)],
    }));
  };

  const handleRemoveMeasure = (sectionId, measureIndex) => {
    updateSection(sectionId, (section) => ({
      ...section,
      measures: section.measures.filter((_, index) => index !== measureIndex),
    }));
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
      const hydrated = hydrateScore({
        ...data,
        sections: [{
          id: createId("section"),
          name: "解析結果",
          measures: data.measures ?? [],
        }],
      });

      setScore(hydrated);
      setSelectedSectionId(hydrated.sections[0]?.id || "");
      setPlaySectionId(hydrated.sections[0]?.id || "");
      setManualSectionText(
        hydrated.sections.map((section) => `[${section.name}] ${section.measures.map((measure) => measure.chord).join(" | ")}`).join("\n"),
      );
      setPlaybackMeasure(0);
      setIsPlaying(false);
      setSaveMessage("解析結果をセクション化して反映しました。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "音声解析に失敗しました。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImportYoutube = async () => {
    if (!youtubeUrl.trim()) {
      setErrorMessage("YouTube URL を入力してください。");
      return;
    }

    setIsImportingYoutube(true);
    setErrorMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/import-youtube`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: youtubeUrl.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || "YouTube URL から下書きを作れませんでした。");
      }

      const data = await response.json();
      const hydrated = hydrateScore(data);
      setScoreTitle(data.title || scoreTitle);
      setScore(hydrated);
      setSelectedSectionId(hydrated.sections[0]?.id || "");
      setPlaySectionId(hydrated.sections[0]?.id || "");
      setManualSectionText(
        hydrated.sections.map((section) => `[${section.name}] ${section.measures.map((measure) => measure.chord).join(" | ")}`).join("\n"),
      );
      setPlaybackMeasure(0);
      setIsPlaying(false);
      setSaveMessage(
        data.importMode === "delegated"
          ? "外部の YouTube 解析バックエンドで音声を処理しました。コード候補を確認して保存できます。"
          : data.importMode === "extracted"
          ? "YouTube 音声を抽出して解析しました。コード候補を確認して保存できます。"
          : "YouTube URL からドラフト譜面を作成しました。現在の環境では音声抽出できないため、コード候補を手で調整してください。",
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "YouTube URL の取り込みに失敗しました。");
    } finally {
      setIsImportingYoutube(false);
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

  const handleSaveScore = async () => {
    if (!score) {
      setErrorMessage("保存する譜面がありません。");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    setSaveMessage("");

    try {
      const payload = buildSavePayload(score, scoreId, scoreTitle);
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
      const hydrated = hydrateScore(saved);
      setScoreId(saved.id);
      setScoreTitle(saved.title);
      setScore(hydrated);
      setSelectedSectionId(hydrated.sections[0]?.id || "");
      setPlaySectionId(hydrated.sections[0]?.id || "");
      setSaveMessage("公開譜面として保存しました。iPadではセクションごとに再生できます。");
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
    if (!activePlaySection?.measures.length) {
      return;
    }
    setPlaybackMeasure(0);
    setIsPlaying(true);
  };

  const handleStopPlayback = () => {
    setIsPlaying(false);
    setPlaybackMeasure(0);
  };

  const handleJumpToPreviousMeasure = () => {
    setPlaybackMeasure((current) => Math.max(0, current - 1));
    setIsPlaying(false);
  };

  const handleJumpToNextMeasure = () => {
    if (!activePlaySection) {
      return;
    }
    setPlaybackMeasure((current) => Math.min(current + 1, activePlaySection.measures.length - 1));
    setIsPlaying(false);
  };

  const handleSelectPlaySection = (sectionId) => {
    setPlaySectionId(sectionId);
    setPlaybackMeasure(0);
    setIsPlaying(false);
  };

  const handlePerformanceTouchStart = (event) => {
    const touch = event.touches?.[0];
    if (!touch) {
      return;
    }
    setTouchSession({
      x: touch.clientX,
      y: touch.clientY,
    });
  };

  const handlePerformanceTouchEnd = (event) => {
    if (!touchSession) {
      return;
    }

    const touch = event.changedTouches?.[0];
    if (!touch) {
      setTouchSession(null);
      return;
    }

    const deltaX = touch.clientX - touchSession.x;
    const deltaY = touch.clientY - touchSession.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX >= swipeThreshold && absX > absY) {
      if (deltaX > 0) {
        handleJumpToPreviousMeasure();
      } else {
        handleJumpToNextMeasure();
      }
    } else if (absX <= tapThreshold && absY <= tapThreshold && isPlaying) {
      setIsPlaying(false);
    }

    setTouchSession(null);
  };

  if (route.mode === "play") {
    const currentMeasure = activePlaySection?.measures[playbackMeasure] ?? null;
    const nextMeasure = activePlaySection?.measures[playbackMeasure + 1] ?? null;

    return (
      <div className="app-shell play-shell">
        <header className="hero hero-play">
          <div>
            <p className="eyebrow">みんなのギター広場</p>
            <h1>{scoreTitle}</h1>
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

        {score && activePlaySection && (
          <main className="play-layout">
            <section className="panel section-jump-panel">
              <p className="section-kicker">セクション移動</p>
              <div className="section-chip-row">
                {score.sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={`section-chip ${section.id === activePlaySection.id ? "section-chip-active" : ""}`}
                    onClick={() => handleSelectPlaySection(section.id)}
                  >
                    {section.name}
                  </button>
                ))}
              </div>
            </section>

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
                <span className="toolbar-label">小節移動</span>
                <div className="performance-actions">
                  <button type="button" className="ghost-button" onClick={handleJumpToPreviousMeasure}>
                    前の小節
                  </button>
                  <button type="button" className="ghost-button" onClick={handleJumpToNextMeasure}>
                    次の小節
                  </button>
                </div>
              </div>
            </section>

            <section
              className="performance-canvas"
              onTouchStart={handlePerformanceTouchStart}
              onTouchEnd={handlePerformanceTouchEnd}
            >
              <div className="gesture-hint">タップで停止、左右スワイプで小節移動</div>
              <div className="performance-target-band" aria-hidden="true" />
              <div
                className="performance-strip"
                style={{ transform: `translateX(calc(50vw - ${playbackMeasure * 338 + 178}px))` }}
              >
                {activePlaySection.measures.map((measure, index) => (
                  <article
                    key={measure.id}
                    className={`performance-screen-card ${index === playbackMeasure ? "performance-screen-card-active" : ""}`}
                  >
                    <p className="performance-number">{activePlaySection.name} #{measure.number}</p>
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
                <p className="section-kicker">現在の位置</p>
                <h2>{activePlaySection.name}</h2>
                <p>{currentMeasure ? `${currentMeasure.chord} / ${currentMeasure.rhythmPattern}` : "-"}</p>
              </div>
              <div>
                <p className="section-kicker">次の小節</p>
                <h2>{nextMeasure?.chord ?? "END"}</h2>
                <p>{nextMeasure?.rhythmPattern ?? ""}</p>
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
              placeholder="例: 文化祭で弾く曲"
            />
          </label>

          <div className="editor-grid">
            <section className="editor-card">
              <p className="section-kicker">YouTube URL</p>
              <p className="helper-text">外部の YouTube 解析バックエンドが接続されていればそこへ委譲し、なければローカル抽出を試し、最後はドラフトへフォールバックします。</p>
              <label className="field-stack">
                <span>YouTube の URL</span>
                <input
                  className="text-input"
                  value={youtubeUrl}
                  onChange={(event) => setYoutubeUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="primary-button"
                  disabled={isImportingYoutube}
                  onClick={handleImportYoutube}
                >
                  {isImportingYoutube ? "下書き作成中..." : "YouTube から下書き作成"}
                </button>
              </div>
            </section>

            <section className="editor-card">
              <p className="section-kicker">セクション入力</p>
              <p className="helper-text">`[Aメロ] C | G | Am | F` のように、セクションごとにまとめて入力できます。</p>
              <textarea
                className="manual-textarea section-textarea"
                value={manualSectionText}
                onChange={(event) => setManualSectionText(event.target.value)}
              />
              <div className="button-row">
                <button type="button" className="primary-button" onClick={handleCreateFromText}>
                  セクションから譜面作成
                </button>
              </div>
            </section>

            <section className="editor-card">
              <p className="section-kicker">音声入力</p>
              <p className="helper-text">WAVを解析して、1つのセクションとして下書きを作れます。</p>
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
                {isAnalyzing ? "解析中..." : "音声から下書きを作る"}
              </button>
            </section>
          </div>

          {errorMessage && <p className="error-text">{errorMessage}</p>}
          {saveMessage && <p className="success-text">{saveMessage}</p>}

          {score && (
            <section className="section-editor-layout">
              <aside className="section-sidebar">
                <div className="panel-head">
                  <div>
                    <p className="section-kicker">セクション一覧</p>
                    <h3>曲を分けて編集する</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={handleAddSection}>
                    セクション追加
                  </button>
                </div>

                <div className="section-list">
                  {score.sections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className={`section-list-item ${section.id === selectedSection?.id ? "section-list-item-active" : ""}`}
                      onClick={() => setSelectedSectionId(section.id)}
                    >
                      <strong>{section.name}</strong>
                      <span>{section.measures.length}小節</span>
                    </button>
                  ))}
                </div>
              </aside>

              {selectedSection && (
                <div className="section-detail">
                  <section className="editor-card">
                    <div className="panel-head">
                      <div>
                        <p className="section-kicker">選択中のセクション</p>
                        <h3>{selectedSection.name}</h3>
                      </div>
                      <div className="button-row">
                        <button type="button" className="ghost-button" onClick={() => handleAddMeasure(selectedSection.id)}>
                          小節追加
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={score.sections.length <= 1}
                          onClick={() => handleRemoveSection(selectedSection.id)}
                        >
                          セクション削除
                        </button>
                      </div>
                    </div>

                    <label className="field-stack">
                      <span>セクション名</span>
                      <input
                        className="text-input"
                        value={selectedSection.name}
                        onChange={(event) => handleRenameSection(selectedSection.id, event.target.value)}
                      />
                    </label>

                    <div className="measure-grid">
                      {selectedSection.measures.map((measure, index) => (
                        <article key={measure.id} className="measure-card">
                          <div className="measure-head">
                            <p className="measure-number">#{measure.number}</p>
                            <button
                              type="button"
                              className="measure-remove-button"
                              disabled={selectedSection.measures.length <= 1}
                              onClick={() => handleRemoveMeasure(selectedSection.id, index)}
                            >
                              削除
                            </button>
                          </div>
                          <select
                            className="chord-select"
                            value={measure.chord}
                            onChange={(event) => handleChordChange(selectedSection.id, index, event.target.value)}
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
                              onChange={(event) => handleRhythmChange(selectedSection.id, index, event.target.value)}
                            />
                          </label>
                          <div className="shape-list">
                            {(measure.tabCandidates?.length ? measure.tabCandidates : ["TABなし"]).map((shape) => (
                              <button
                                key={`${measure.id}-${shape}`}
                                type="button"
                                className={`shape-chip ${measure.selectedTab === shape ? "shape-chip-active" : ""}`}
                                onClick={() => handleTabSelect(selectedSection.id, index, shape)}
                              >
                                {shape}
                              </button>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="editor-card">
                    <div className="panel-head">
                      <div>
                        <p className="section-kicker">選択セクションのプレビュー</p>
                        <h3>iPadで見える並び</h3>
                      </div>
                    </div>
                    <div className="section-preview-strip">
                      {selectedSection.measures.map((measure) => (
                        <ChordDiagram
                          key={`preview-${measure.id}`}
                          chord={measure.chord}
                          shape={measure.selectedTab}
                          rhythmPattern={measure.rhythmPattern}
                          onPlay={() => handlePlayChord(measure.selectedTab)}
                        />
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </section>
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
          <p className="helper-text">セクション単位の譜面を、編集画面でも再生画面でもすぐ開けます。</p>
          <div className="public-score-list">
            {publicScores.map((item) => (
              <article key={item.id} className="public-score-card">
                <p className="public-score-meta">{item.authorName}</p>
                <h3>{item.title}</h3>
                <p>{item.measureCount}小節 / {item.duration}</p>
                <div className="button-row">
                  <button type="button" className="ghost-button" onClick={() => navigateTo(`/edit/${item.id}`)}>
                    編集で開く
                  </button>
                  <button type="button" className="ghost-button" onClick={() => navigateTo(`/play/${item.id}`)}>
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
