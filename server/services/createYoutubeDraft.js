const chordShapes = {
  C: ["x32010", "x35553"],
  G: ["320003", "355433"],
  Am: ["x02210", "577555"],
  F: ["133211", "x87565"],
  D: ["xx0232", "x57775"],
  Em: ["022000", "x79987"],
  A: ["x02220", "577655"],
};

const sectionTemplates = [
  { name: "イントロ", progression: ["C", "G", "Am", "F"] },
  { name: "Aメロ", progression: ["C", "G", "Am", "F"] },
  { name: "Bメロ", progression: ["Em", "C", "G", "D"] },
  { name: "サビ", progression: ["F", "G", "C", "C"] },
];

function hashText(input) {
  let total = 0;
  for (const char of input) {
    total = (total * 31 + char.charCodeAt(0)) % 100000;
  }
  return total;
}

function isYoutubeUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === "youtu.be";
  } catch {
    return false;
  }
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

function buildTitleFromUrl(value) {
  const url = new URL(value);
  const videoId = url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop() || "youtube";
  return `YouTube下書き ${videoId}`;
}

export function createYoutubeDraft(url) {
  if (!isYoutubeUrl(url)) {
    throw new Error("valid YouTube URL is required");
  }

  const seed = hashText(url);
  const sections = sectionTemplates.slice(0, 3 + (seed % 2)).map((template, index) => {
    const rotation = (seed + index) % template.progression.length;
    const progression = template.progression
      .slice(rotation)
      .concat(template.progression.slice(0, rotation));

    return {
      id: `yt-section-${index + 1}`,
      name: template.name,
      measures: progression.map((chord, measureIndex) => createMeasure(chord, measureIndex)),
    };
  });

  const measureCount = sections.reduce((sum, section) => sum + section.measures.length, 0);

  return {
    title: buildTitleFromUrl(url),
    sourceUrl: url,
    fileName: "youtube-draft",
    duration: `00:${String(measureCount * 4).padStart(2, "0")}`,
    engine: "youtube-draft-import-v1",
    notes:
      "This is a section draft generated from the YouTube URL flow. Audio extraction is not enabled yet, so please review and adjust the chords manually.",
    sections,
  };
}
