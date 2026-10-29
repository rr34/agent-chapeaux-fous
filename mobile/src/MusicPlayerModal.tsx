import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMusic, generateMusicNarration, musicSource, narrationSource } from './api';
import { colors } from './theme';
import type { ConnectionSettings, MusicFile, MusicNarration, MusicSequence } from './types';

type WorkGroup = { key: string; title: string; type: string | null; creators: string[]; catalogue: string[]; files: MusicFile[] };
type ReleaseGroup = { key: string; title: string; type: string | null; version: string | null; release: boolean; files: MusicFile[]; works: WorkGroup[] };
type NarrationField = 'work' | 'sequence' | 'creators' | 'catalogue' | 'compositionDate' | 'performers' | 'notes';
type MusicItem = { key: string; kind: 'music'; file: MusicFile };
type NarrationItem = {
  key: string;
  kind: 'narration';
  file: MusicFile;
  title: string;
  text: string;
  status: 'planned' | 'generating' | 'ready' | 'unavailable';
  narration: MusicNarration | null;
};
type ConcertItem = MusicItem | NarrationItem;
type ConcertGroupKind = 'release' | 'work';
type ConcertGroup = {
  key: string;
  kind: ConcertGroupKind;
  eyebrow: string;
  title: string;
  releaseTitle: string | null;
  version: string | null;
  catalogue: string[];
  creators: string[];
};
type ConcertDisplayRow =
  | { key: string; kind: 'group'; group: ConcertGroup }
  | { key: string; kind: 'item'; item: ConcertItem; queueIndex: number; groupKind: ConcertGroupKind };

const narrationChoices: { field: NarrationField; label: string }[] = [
  { field: 'work', label: 'Work' },
  { field: 'sequence', label: 'Movement' },
  { field: 'creators', label: 'Composer' },
  { field: 'catalogue', label: 'Catalogue' },
  { field: 'compositionDate', label: 'Date' },
  { field: 'performers', label: 'Performers' },
  { field: 'notes', label: 'Notes' },
];

function numberValue(value: number | string | null | undefined): number {
  return typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10) || Number.MAX_SAFE_INTEGER;
}

function sequenceText(sequence: MusicSequence | null, fallback: string): string {
  if (!sequence) return fallback;
  return `${sequence.number == null ? '' : `${sequence.number}. `}${sequence.title || sequence.type}`;
}

function trackTitle(file: MusicFile): string {
  return sequenceText(file.metadata?.sequence2 ?? file.metadata?.sequence1 ?? null, file.title);
}

function spokenSequenceText(sequence: MusicSequence): string {
  const type = sequence.type === 'sequence' ? 'section' : sequence.type;
  const number = sequence.number == null ? '' : ` ${sequence.number}`;
  const title = sequence.title ? `, ${sequence.title}` : '';
  return `${type}${number}${title}`;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

function normalizedSearchText(value: unknown): string {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

function musicMatchesFilter(file: MusicFile, filterText: string): boolean {
  const terms = normalizedSearchText(filterText).trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return true;
  const metadata = file.metadata;
  const searchable = normalizedSearchText([
    file.title,
    file.originalFilename,
    metadata?.release?.type,
    metadata?.release?.title,
    metadata?.release?.version,
    metadata?.release?.side,
    metadata?.release?.trackNumber,
    metadata?.work.type,
    metadata?.work.title,
    metadata?.work.version,
    ...(metadata?.work.creators ?? []),
    ...(metadata?.work.catalogue ?? []),
    metadata?.sequence1?.type,
    metadata?.sequence1?.number,
    metadata?.sequence1?.title,
    metadata?.sequence2?.type,
    metadata?.sequence2?.number,
    metadata?.sequence2?.title,
    ...(metadata?.performers ?? []),
    ...(metadata?.genres ?? []),
    ...(metadata?.languages ?? []),
    metadata?.compositionDate,
    metadata?.performanceDate,
    metadata?.notes,
  ].join(' '));
  return terms.every((term) => searchable.includes(term));
}

function sortWorkFiles(files: MusicFile[]): MusicFile[] {
  return [...files].sort((left, right) => (
    numberValue(left.metadata?.sequence1?.number) - numberValue(right.metadata?.sequence1?.number)
    || numberValue(left.metadata?.sequence2?.number) - numberValue(right.metadata?.sequence2?.number)
    || numberValue(left.metadata?.release?.trackNumber) - numberValue(right.metadata?.release?.trackNumber)
    || left.fileId - right.fileId
  ));
}

function sortReleaseFiles(files: MusicFile[]): MusicFile[] {
  return [...files].sort((left, right) => (
    numberValue(left.metadata?.release?.discNumber) - numberValue(right.metadata?.release?.discNumber)
    || String(left.metadata?.release?.side ?? '').localeCompare(String(right.metadata?.release?.side ?? ''))
    || numberValue(left.metadata?.release?.trackNumber) - numberValue(right.metadata?.release?.trackNumber)
    || left.fileId - right.fileId
  ));
}

function releaseGroups(files: MusicFile[]): ReleaseGroup[] {
  const releases = new Map<string, ReleaseGroup & { workMap: Map<string, WorkGroup> }>();
  for (const file of files) {
    const release = file.metadata?.release;
    const work = file.metadata?.work;
    const workTitle = work?.title || (release ? 'Tracks' : file.title || file.originalFilename || `File ${file.fileId}`);
    const creators = work?.creators ?? [];
    const catalogue = work?.catalogue ?? [];
    const workKey = JSON.stringify([work?.type ?? 'unknown', workTitle, creators, catalogue]);
    const releaseKey = release ? JSON.stringify([release.type, release.title, release.version]) : `standalone:${workKey}`;
    const group = releases.get(releaseKey) ?? {
      key: releaseKey,
      title: release?.title || workTitle,
      type: release?.type ?? work?.type ?? null,
      version: release?.version ?? null,
      release: Boolean(release),
      files: [],
      works: [],
      workMap: new Map<string, WorkGroup>(),
    };
    const workGroup = group.workMap.get(workKey) ?? { key: workKey, title: workTitle, type: work?.type ?? null, creators, catalogue, files: [] };
    workGroup.files.push(file);
    group.workMap.set(workKey, workGroup);
    group.files.push(file);
    releases.set(releaseKey, group);
  }
  for (const group of releases.values()) {
    group.files = sortReleaseFiles(group.files);
    group.works = [...group.workMap.values()]
      .map((work) => ({ ...work, files: sortWorkFiles(work.files) }))
      .sort((left, right) => numberValue(left.files[0]?.metadata?.release?.trackNumber) - numberValue(right.files[0]?.metadata?.release?.trackNumber) || left.title.localeCompare(right.title));
  }
  return [...releases.values()].map(({ workMap: _workMap, ...group }) => group).sort((left, right) => left.title.localeCompare(right.title));
}

function spokenText(file: MusicFile, fields: NarrationField[]): string {
  const metadata = file.metadata;
  const sequence = metadata?.sequence2 ?? metadata?.sequence1;
  const parts: string[] = [];
  if (fields.includes('sequence') && sequence) parts.push(`Next, ${spokenSequenceText(sequence)}.`);
  if (fields.includes('work') && metadata?.work.title) parts.push(`From ${metadata.work.title}.`);
  if (fields.includes('creators') && metadata?.work.creators?.length) parts.push(`By ${metadata.work.creators.join(', ')}.`);
  if (fields.includes('catalogue') && metadata?.work.catalogue?.length) parts.push(`Catalogue ${metadata.work.catalogue.join(', ')}.`);
  if (fields.includes('compositionDate') && metadata?.compositionDate) parts.push(`Composed ${metadata.compositionDate}.`);
  if (fields.includes('performers') && metadata?.performers?.length) parts.push(`Performed by ${metadata.performers.join(', ')}.`);
  if (fields.includes('notes') && metadata?.notes) parts.push(metadata.notes.slice(0, 600));
  return parts.length ? parts.join(' ') : `Next, ${trackTitle(file)}.`;
}

function itemsFor(files: MusicFile[], fields: NarrationField[]): ConcertItem[] {
  return files.flatMap((file) => [
    {
      key: `narration:${file.fileId}`,
      kind: 'narration' as const,
      file,
      title: `Introduction to ${trackTitle(file)}`,
      text: spokenText(file, fields),
      status: 'planned' as const,
      narration: null,
    },
    { key: `music:${file.fileId}`, kind: 'music' as const, file },
  ]);
}

function pluralSequence(type: MusicSequence['type'] | null, count: number): string {
  const singular = type === 'sequence' || !type ? 'track' : type;
  if (count === 1) return singular;
  if (singular === 'item') return 'items';
  return `${singular}s`;
}

function concertGrouping(file: MusicFile) {
  const metadata = file.metadata;
  const release = metadata?.release;
  const work = metadata?.work;
  if (release?.title && work?.type === 'song') {
    return {
      identity: JSON.stringify(['release', release.type, release.title, release.version]),
      kind: 'release' as const,
      title: release.title,
      releaseTitle: null,
      version: release.version,
      catalogue: [] as string[],
      creators: [] as string[],
      type: release.type || 'release',
    };
  }
  if (work?.title) {
    return {
      identity: JSON.stringify(['work', work.type, work.title, work.version, work.creators, work.catalogue]),
      kind: 'work' as const,
      title: work.title,
      releaseTitle: release?.title ?? null,
      version: work.version,
      catalogue: work.catalogue ?? [],
      creators: work.creators ?? [],
      type: work.type || 'work',
    };
  }
  return {
    identity: `file:${file.fileId}`,
    kind: 'work' as const,
    title: file.title,
    releaseTitle: release?.title ?? null,
    version: null,
    catalogue: [] as string[],
    creators: [] as string[],
    type: 'music',
  };
}

function concertDisplayRows(queue: ConcertItem[]): ConcertDisplayRow[] {
  type Entry = { item: ConcertItem; queueIndex: number };
  type ConsecutiveGroup = { identity: string; info: ReturnType<typeof concertGrouping>; files: MusicFile[]; entries: Entry[] };
  const groups: ConsecutiveGroup[] = [];
  let pending: Entry[] = [];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const item = queue[queueIndex];
    if (!item) continue;
    if (item.kind === 'narration') {
      pending.push({ item, queueIndex });
      continue;
    }
    const info = concertGrouping(item.file);
    let group = groups.at(-1);
    if (!group || group.identity !== info.identity) {
      group = { identity: info.identity, info, files: [], entries: [] };
      groups.push(group);
    }
    group.entries.push(...pending, { item, queueIndex });
    group.files.push(item.file);
    pending = [];
  }
  if (pending.length && groups.length) groups.at(-1)?.entries.push(...pending);

  return groups.flatMap((group, groupIndex) => {
    const sequenceTypes = group.files.map((file) => file.metadata?.sequence2?.type ?? file.metadata?.sequence1?.type ?? null);
    const firstSequence = sequenceTypes[0] ?? null;
    const sharedSequence = sequenceTypes.every((type) => type === firstSequence) ? firstSequence : null;
    const countLabel = pluralSequence(group.info.kind === 'release' ? null : sharedSequence, group.files.length);
    const header: ConcertGroup = {
      key: `concert-group:${groupIndex}:${group.identity}`,
      kind: group.info.kind,
      eyebrow: `${group.info.type} · ${group.files.length} ${countLabel}`,
      title: group.info.title,
      releaseTitle: group.info.releaseTitle,
      version: group.info.version,
      catalogue: group.info.catalogue,
      creators: group.info.creators,
    };
    return [
      { key: header.key, kind: 'group' as const, group: header },
      ...group.entries.map(({ item, queueIndex }) => ({
        key: `concert-row:${queueIndex}:${item.key}`,
        kind: 'item' as const,
        item,
        queueIndex,
        groupKind: group.info.kind,
      })),
    ];
  });
}

function AddButton({ label, disabled, onPress, secondary = false }: { label: string; disabled: boolean; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.addButton, secondary && styles.addButtonSecondary, disabled && styles.disabled]}
    >
      <Text style={styles.addButtonText}>+</Text>
    </Pressable>
  );
}

function TrackRows({ files, currentFileId, disabled, onAdd }: { files: MusicFile[]; currentFileId: number | null; disabled: boolean; onAdd: (files: MusicFile[]) => void }) {
  return <>{files.map((file, index) => {
    const current = currentFileId === file.fileId;
    return (
      <View key={file.fileId} style={[styles.trackRow, current && styles.currentRow]}>
        <Text style={[styles.trackPosition, current && styles.currentTrackPosition]}>{file.metadata?.sequence2?.number ?? file.metadata?.sequence1?.number ?? file.metadata?.release?.trackNumber ?? index + 1}</Text>
        <View style={styles.flex}>
          {current && <Text style={styles.currentStatus}>NOW PLAYING</Text>}
          <Text numberOfLines={2} style={[styles.trackTitle, current && styles.currentTitle]}>{trackTitle(file)}</Text>
          {!!file.metadata?.performers?.length && <Text numberOfLines={1} style={styles.detail}>{file.metadata.performers.join(' · ')}</Text>}
          {!file.metadata && <Text style={styles.warning}>Metadata needs review</Text>}
        </View>
        <AddButton label={`Add ${trackTitle(file)} to concert`} disabled={disabled} onPress={() => onAdd([file])} secondary />
      </View>
    );
  })}</>;
}

function LibraryCard({ group, currentFileId, disabled, onAdd }: { group: ReleaseGroup; currentFileId: number | null; disabled: boolean; onAdd: (files: MusicFile[]) => void }) {
  const standalone = !group.release && group.works.length === 1 ? group.works[0] : null;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <View style={styles.flex}>
          <Text style={styles.type}>{(group.type || 'music').toUpperCase()}</Text>
          <Text style={styles.workTitle}>{group.title}</Text>
          {!!group.version && <Text style={styles.detail}>{group.version}</Text>}
          {!!standalone?.catalogue.length && <Text style={styles.catalogue}>{standalone.catalogue.join(' · ')}</Text>}
          {!!standalone?.creators.length && <Text style={styles.detail}>{standalone.creators.join(' · ')}</Text>}
        </View>
        <AddButton label={`Add ${group.title} to concert`} disabled={disabled} onPress={() => onAdd(group.files)} />
      </View>
      {group.release ? group.works.map((work) => (
        <View key={work.key} style={styles.workSection}>
          <View style={styles.workHeading}>
            <View style={styles.flex}>
              <Text style={styles.type}>{(work.type || 'work').toUpperCase()}</Text>
              <Text style={styles.workSectionTitle}>{work.title}</Text>
              {!!work.catalogue.length && <Text style={styles.catalogue}>{work.catalogue.join(' · ')}</Text>}
              {!!work.creators.length && <Text style={styles.detail}>{work.creators.join(' · ')}</Text>}
            </View>
            <AddButton label={`Add ${work.title} to concert`} disabled={disabled} onPress={() => onAdd(work.files)} secondary />
          </View>
          <TrackRows files={work.files} currentFileId={currentFileId} disabled={disabled} onAdd={onAdd} />
        </View>
      )) : <TrackRows files={group.files} currentFileId={currentFileId} disabled={disabled} onAdd={onAdd} />}
    </View>
  );
}

function ConcertGroupHeader({ group }: { group: ConcertGroup }) {
  return (
    <View style={styles.groupHeader}>
      {!!group.releaseTitle && <Text style={styles.groupRelease}>{group.releaseTitle}</Text>}
      <Text style={styles.groupEyebrow}>{group.eyebrow.toUpperCase()}</Text>
      <Text style={styles.groupTitle}>{group.title}</Text>
      {!!group.version && <Text style={styles.groupVersion}>{group.version}</Text>}
      {!!group.catalogue.length && <Text style={styles.groupCatalogue}>{group.catalogue.join(' · ')}</Text>}
      {!!group.creators.length && <Text style={styles.groupCreators}>{group.creators.join(' · ')}</Text>}
    </View>
  );
}

function ConcertRow({ item, current, groupKind, disabled, onPlay }: { item: ConcertItem; current: boolean; groupKind: ConcertGroupKind; disabled: boolean; onPlay: () => void }) {
  if (item.kind === 'narration') {
    const status = item.status === 'ready' && item.narration ? `AI VOICE · ${formatTime(item.narration.durationMs / 1_000)}`
      : item.status === 'generating' ? 'AI VOICE · GENERATING…'
        : item.status === 'unavailable' ? 'AI VOICE · UNAVAILABLE — WILL SKIP' : 'AI VOICE · WILL GENERATE';
    return (
      <View style={[styles.queueRow, styles.narrationRow, current && styles.currentRow]}>
        <Text style={[styles.queueIcon, current && styles.currentQueueIcon]}>◇</Text>
        <View style={styles.flex}>
          <Text style={[styles.narrationStatus, current && styles.currentStatus]}>{current ? `NOW PLAYING · ${status}` : status}</Text>
          <Text style={[styles.narrationTitle, current && styles.currentTitle]}>{item.title}</Text>
          <Text numberOfLines={3} style={styles.narrationCopy}>{item.text}</Text>
        </View>
      </View>
    );
  }
  const workTitle = item.file.metadata?.work.title || item.file.title;
  const title = groupKind === 'release' ? workTitle : trackTitle(item.file);
  const detail = groupKind === 'release' && trackTitle(item.file) !== title ? trackTitle(item.file) : null;
  return (
    <View style={[styles.queueRow, current && styles.currentRow]}>
      <Pressable
        accessibilityLabel={`Play ${title} from concert`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPlay}
        style={({ pressed }) => [styles.queuePlayButton, current && styles.currentQueuePlayButton, pressed && styles.queuePlayButtonPressed, disabled && styles.disabled]}
      >
        <Text style={styles.queuePlayIcon}>▶</Text>
      </Pressable>
      <View style={styles.flex}>
        {current && <Text style={styles.currentStatus}>NOW PLAYING</Text>}
        <Text numberOfLines={2} style={[styles.queueTitle, current && styles.currentTitle]}>{title}</Text>
        {!!detail && <Text numberOfLines={1} style={styles.queueWork}>{detail}</Text>}
      </View>
    </View>
  );
}

export function MusicPlayerModal({ visible, settings, onClose }: { visible: boolean; settings: ConnectionSettings; onClose: () => void }) {
  const [files, setFiles] = useState<MusicFile[]>([]);
  const [queue, setQueue] = useState<ConcertItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [hasStarted, setHasStarted] = useState(false);
  const [complete, setComplete] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [fields, setFields] = useState<NarrationField[]>(['work', 'sequence', 'creators']);
  const [lastCleared, setLastCleared] = useState<ConcertItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [notice, setNotice] = useState('');
  const [filterText, setFilterText] = useState('');
  const boundaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledFinish = useRef(false);
  const changing = useRef(false);
  const playbackVersion = useRef(0);
  const queueRef = useRef<ConcertItem[]>([]);
  const narrationPromises = useRef(new Map<string, Promise<NarrationItem | null>>());
  const player = useAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);
  const filteredFiles = useMemo(() => files.filter((file) => musicMatchesFilter(file, filterText)), [files, filterText]);
  const groups = useMemo(() => releaseGroups(filteredFiles), [filteredFiles]);
  const concertRows = useMemo(() => concertDisplayRows(queue), [queue]);
  const current = currentIndex >= 0 ? queue[currentIndex] ?? null : null;
  const musicCount = queue.filter((item) => item.kind === 'music').length;
  const narrationCount = queue.length - musicCount;
  const musicDurationKnown = queue.every((item) => item.kind !== 'music' || (item.file.durationMs ?? 0) > 0);
  const musicDuration = queue.reduce((total, item) => total + (item.kind === 'music' ? item.file.durationMs ?? 0 : 0), 0);
  const durationLabel = musicDurationKnown
    ? `${formatDuration(musicDuration)} music`
    : 'music duration unavailable';
  const summary = `${musicCount} ${musicCount === 1 ? 'track' : 'tracks'} · ${narrationCount} spoken · ${durationLabel}`;

  const updateQueue = useCallback((update: (previous: ConcertItem[]) => ConcertItem[]) => {
    setQueue((previous) => {
      const next = update(previous);
      queueRef.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try { setFiles(await fetchMusic(settings)); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load music.'); }
    finally { setLoading(false); }
  }, [settings]);

  useEffect(() => {
    if (!visible) return;
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
    void refresh();
  }, [refresh, visible]);

  useEffect(() => () => {
    if (boundaryTimer.current) clearTimeout(boundaryTimer.current);
    if (playTimer.current) clearTimeout(playTimer.current);
    player.clearLockScreenControls();
  }, [player]);

  useEffect(() => {
    if (hasStarted) return;
    updateQueue((items) => items.map((item) => item.kind === 'narration'
      ? { ...item, text: spokenText(item.file, fields), status: 'planned', narration: null }
      : item));
  }, [fields, hasStarted, updateQueue]);

  const prepareNarration = useCallback(async (index: number): Promise<NarrationItem | null> => {
    const item = queueRef.current[index];
    if (!item || item.kind !== 'narration') return null;
    if (item.status === 'ready' && item.narration) return item;
    const existing = narrationPromises.current.get(item.key);
    if (existing) return existing;
    const promise = (async () => {
      updateQueue((items) => items.map((candidate) => candidate.key === item.key && candidate.kind === 'narration' ? { ...candidate, status: 'generating' } : candidate));
      try {
        const narration = await generateMusicNarration(settings, item.text);
        const ready: NarrationItem = { ...item, status: 'ready', narration };
        updateQueue((items) => items.map((candidate) => candidate.key === item.key ? ready : candidate));
        return ready;
      } catch {
        updateQueue((items) => items.map((candidate) => candidate.key === item.key && candidate.kind === 'narration' ? { ...candidate, status: 'unavailable', narration: null } : candidate));
        return null;
      } finally { narrationPromises.current.delete(item.key); }
    })();
    narrationPromises.current.set(item.key, promise);
    return promise;
  }, [settings, updateQueue]);

  const loadItem = useCallback((item: ConcertItem, index: number) => {
    if (boundaryTimer.current) clearTimeout(boundaryTimer.current);
    if (playTimer.current) clearTimeout(playTimer.current);
    handledFinish.current = false;
    setCurrentIndex(index);
    setNotice('');
    if (item.kind === 'music') {
      player.replace(musicSource(settings, item.file));
      player.setActiveForLockScreen(true, {
        title: trackTitle(item.file),
        artist: item.file.metadata?.work.creators?.join(', ') || item.file.metadata?.performers?.join(', ') || undefined,
        albumTitle: item.file.metadata?.release?.title || item.file.metadata?.work.title || undefined,
      });
      const nextNarration = queueRef.current.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.kind === 'narration');
      if (nextNarration >= 0) void prepareNarration(nextNarration);
    } else if (item.narration) {
      player.replace(narrationSource(settings, item.narration, item.title));
      player.setActiveForLockScreen(true, { title: item.title, artist: 'AI voice · Time v3 Concert', albumTitle: item.file.metadata?.release?.title || item.file.metadata?.work.title || undefined });
    }
    playTimer.current = setTimeout(() => player.play(), 100);
  }, [player, prepareNarration, settings]);

  const playAt = useCallback(async (requestedIndex: number) => {
    if (changing.current) return;
    const version = playbackVersion.current;
    changing.current = true;
    setTransitioning(true);
    try {
      let index = requestedIndex;
      while (index < queueRef.current.length) {
        let item = queueRef.current[index];
        if (!item) return;
        if (item.kind === 'narration' && (!item.narration || item.status !== 'ready')) {
          setNotice(`Preparing AI voice: ${item.title}`);
          const prepared = await prepareNarration(index);
          if (version !== playbackVersion.current) return;
          const live = queueRef.current[index];
          if (!prepared || !live || live.key !== item.key) {
            setNotice(`AI voice unavailable. Continuing with ${trackTitle(item.file)}.`);
            index += 1;
            continue;
          }
          item = live;
        }
        if (version !== playbackVersion.current) return;
        loadItem(item, index);
        return;
      }
      setComplete(true);
      setNotice('Concert complete. Playback stopped.');
    } finally {
      if (version === playbackVersion.current) {
        changing.current = false;
        setTransitioning(false);
      }
    }
  }, [loadItem, prepareNarration]);

  useEffect(() => {
    if (!status.didJustFinish || handledFinish.current || currentIndex < 0) return;
    handledFinish.current = true;
    if (currentIndex + 1 >= queueRef.current.length) {
      setComplete(true);
      setNotice('Concert complete. Playback stopped.');
      return;
    }
    const next = queueRef.current[currentIndex + 1];
    if (!next) return;
    setNotice(next.kind === 'narration' ? `Next: ${next.title}` : `Next: ${trackTitle(next.file)}`);
    boundaryTimer.current = setTimeout(() => void playAt(currentIndex + 1), 500);
  }, [currentIndex, playAt, status.didJustFinish]);

  const add = (selected: MusicFile[]) => {
    if (hasStarted) return;
    const present = new Set(queueRef.current.filter((item): item is MusicItem => item.kind === 'music').map((item) => item.file.fileId));
    const additions = selected.filter((file) => !present.has(file.fileId));
    setLastCleared(null);
    if (!additions.length) { setNotice('That music is already in the concert.'); return; }
    updateQueue((items) => [...items, ...itemsFor(additions, fields)]);
    setNotice(`${additions.length} ${additions.length === 1 ? 'track' : 'tracks'} added to the concert.`);
  };

  const clear = () => {
    playbackVersion.current += 1;
    changing.current = false;
    setTransitioning(false);
    if (boundaryTimer.current) clearTimeout(boundaryTimer.current);
    if (playTimer.current) clearTimeout(playTimer.current);
    player.pause();
    player.clearLockScreenControls();
    setLastCleared(queueRef.current);
    updateQueue(() => []);
    setCurrentIndex(-1);
    setHasStarted(false);
    setComplete(false);
    setQueueOpen(false);
    setNotice('Concert cleared.');
  };

  const undo = () => {
    if (!lastCleared?.length) return;
    updateQueue(() => lastCleared.map((item) => item.kind === 'narration' ? { ...item, status: 'planned', narration: null } : item));
    setLastCleared(null);
    setNotice('Concert restored.');
  };

  const toggleField = (field: NarrationField) => {
    if (hasStarted) return;
    setFields((currentFields) => {
      if (!currentFields.includes(field)) return [...currentFields, field];
      if (currentFields.length === 1) { setNotice('Keep at least one spoken metadata field.'); return currentFields; }
      return currentFields.filter((candidate) => candidate !== field);
    });
  };

  const playOrPause = () => {
    if (status.playing) { player.pause(); return; }
    if (!hasStarted || complete || !current) {
      setHasStarted(true);
      setComplete(false);
      void playAt(0);
      return;
    }
    player.play();
  };

  const playTrackFromConcert = (queueIndex: number) => {
    setHasStarted(true);
    setComplete(false);
    void playAt(queueIndex);
  };

  const close = () => {
    playbackVersion.current += 1;
    changing.current = false;
    setTransitioning(false);
    if (boundaryTimer.current) clearTimeout(boundaryTimer.current);
    if (playTimer.current) clearTimeout(playTimer.current);
    player.pause();
    player.clearLockScreenControls();
    onClose();
  };

  const queueHeader = (
    <View style={styles.concertHeader}>
      <View style={styles.concertTitleRow}>
        <View style={styles.flex}><Text style={styles.type}>ONE PLAYBACK QUEUE</Text><Text style={styles.concertTitle}>{summary}</Text></View>
        <Pressable onPress={clear} style={styles.clearButton}><Text style={styles.clearText}>CLEAR</Text></Pressable>
      </View>
      <Text style={styles.narrationHeading}>SPOKEN INTRODUCTIONS</Text>
      <Text style={styles.narrationHelp}>An AI voice appears before every track. Choose what it announces.</Text>
      <View style={styles.fieldChoices}>{narrationChoices.map(({ field, label }) => {
        const selected = fields.includes(field);
        return (
          <Pressable key={field} disabled={hasStarted} onPress={() => toggleField(field)} style={[styles.fieldChoice, selected && styles.fieldChoiceSelected, hasStarted && styles.disabled]}>
            <Text style={[styles.fieldChoiceText, selected && styles.fieldChoiceTextSelected]}>{label}</Text>
          </Pressable>
        );
      })}</View>
      {hasStarted && <Text style={styles.frozen}>This concert is fixed while it is playing. Clear it to build another.</Text>}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View><Text style={styles.eyebrow}>CONCERT PLAYER</Text><Text style={styles.heading}>{queueOpen ? 'Concert' : 'Music'}</Text></View>
          <Pressable onPress={close} style={styles.closeButton}><Text style={styles.closeText}>CLOSE</Text></Pressable>
        </View>

        {!queueOpen && <View style={styles.filterBar}>
          <TextInput
            accessibilityLabel="Filter music"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="never"
            onChangeText={setFilterText}
            placeholder="Filter music"
            placeholderTextColor={colors.dim}
            returnKeyType="search"
            style={styles.filterInput}
            underlineColorAndroid="transparent"
            value={filterText}
          />
          {!!filterText && <Pressable accessibilityLabel="Clear music filter" accessibilityRole="button" onPress={() => setFilterText('')} style={styles.filterClear}>
            <Text style={styles.filterClearText}>×</Text>
          </Pressable>}
        </View>}

        {queueOpen ? (
          <FlatList
            data={concertRows}
            keyExtractor={(row) => row.key}
            contentContainerStyle={[styles.queueList, current ? styles.withPlayer : styles.withBar]}
            renderItem={({ item: row }) => row.kind === 'group'
              ? <ConcertGroupHeader group={row.group} />
              : <ConcertRow item={row.item} current={currentIndex === row.queueIndex} groupKind={row.groupKind} disabled={transitioning} onPlay={() => playTrackFromConcert(row.queueIndex)} />}
            ListHeaderComponent={queueHeader}
          />
        ) : (
          <FlatList
            data={groups}
            keyExtractor={(group) => group.key}
            contentContainerStyle={[groups.length ? styles.list : styles.emptyList, current ? styles.withPlayer : queue.length ? styles.withBar : null]}
            renderItem={({ item }) => <LibraryCard group={item} currentFileId={current?.kind === 'music' ? current.file.fileId : null} disabled={hasStarted} onAdd={add} />}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.accent} />}
            ListEmptyComponent={loading ? <ActivityIndicator color={colors.accent} size="large" /> : filterText.trim() && files.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>No matching music</Text><Text style={styles.emptyCopy}>Try another title, composer, performer, catalogue number, or movement.</Text></View> : <View style={styles.empty}><Text style={styles.emptyTitle}>No music yet</Text><Text style={styles.emptyCopy}>Upload MP3 files to the agent and ask it to identify and organize them.</Text></View>}
          />
        )}

        {!!notice && <View style={[styles.noticeBar, current ? styles.noticeWithPlayer : queue.length ? styles.noticeWithBar : null]}>
          <Text style={styles.notice}>{notice}</Text>
          {!!lastCleared?.length && !queue.length && <Pressable onPress={undo}><Text style={styles.undo}>UNDO</Text></Pressable>}
        </View>}

        {!!queue.length && !current && <View style={styles.concertBar}>
          <Pressable accessibilityLabel={queueOpen ? 'Return to music library' : 'Open concert queue'} onPress={() => setQueueOpen((value) => !value)} style={styles.flex}>
            <Text style={styles.nowLabel}>{queueOpen ? 'MUSIC LIBRARY' : 'CONCERT'}</Text><Text numberOfLines={1} style={styles.barText}>{summary}</Text>
          </Pressable>
          <Pressable disabled={transitioning} onPress={playOrPause} style={[styles.mainControl, transitioning && styles.disabled]}>
            {transitioning ? <ActivityIndicator color={colors.ink} size="small" /> : <Text style={styles.mainControlText}>PLAY</Text>}
          </Pressable>
        </View>}

        {current && <View style={styles.player}>
          <Pressable accessibilityLabel={queueOpen ? 'Return to music library' : 'Open concert queue'} onPress={() => setQueueOpen((value) => !value)}>
            <Text style={styles.nowLabel}>{current.kind === 'narration' ? 'AI VOICE · NOW PLAYING' : 'NOW PLAYING'} · {currentIndex + 1}/{queue.length}</Text>
            {!!current.file.metadata?.release?.title && <Text numberOfLines={1} style={styles.nowRelease}>{current.file.metadata.release.title}</Text>}
            <Text numberOfLines={1} style={styles.nowWork}>{current.file.metadata?.work.title || current.file.title}</Text>
            <Text numberOfLines={2} style={styles.nowTrack}>{current.kind === 'narration' ? current.title : trackTitle(current.file)}</Text>
          </Pressable>
          <View style={styles.timeRow}><Text style={styles.time}>{formatTime(status.currentTime)}</Text><View style={styles.progress}><View style={[styles.progressFill, { width: `${status.duration > 0 ? Math.min(100, status.currentTime / status.duration * 100) : 0}%` }]} /></View><Text style={styles.time}>{formatTime(status.duration)}</Text></View>
          <View style={styles.controls}>
            <Pressable disabled={currentIndex <= 0 || transitioning} onPress={() => void playAt(currentIndex - 1)} style={[styles.control, (currentIndex <= 0 || transitioning) && styles.disabled]}><Text style={styles.controlText}>PREV</Text></Pressable>
            <Pressable onPress={() => void player.seekTo(Math.max(0, status.currentTime - 15))} style={styles.control}><Text style={styles.controlText}>−15</Text></Pressable>
            <Pressable disabled={transitioning} onPress={playOrPause} style={[styles.mainControl, transitioning && styles.disabled]}>{transitioning ? <ActivityIndicator color={colors.ink} size="small" /> : <Text style={styles.mainControlText}>{status.playing ? 'PAUSE' : complete ? 'REPLAY' : 'PLAY'}</Text>}</Pressable>
            <Pressable onPress={() => void player.seekTo(Math.min(status.duration || status.currentTime + 15, status.currentTime + 15))} style={styles.control}><Text style={styles.controlText}>+15</Text></Pressable>
            <Pressable disabled={currentIndex + 1 >= queue.length || transitioning} onPress={() => void playAt(currentIndex + 1)} style={[styles.control, (currentIndex + 1 >= queue.length || transitioning) && styles.disabled]}><Text style={styles.controlText}>NEXT</Text></Pressable>
          </View>
        </View>}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.8 },
  heading: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  closeButton: { minHeight: 38, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  closeText: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  filterBar: { minHeight: 50, flexDirection: 'row', alignItems: 'center', marginHorizontal: 14, marginTop: 12, paddingLeft: 14, paddingRight: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterInput: { flex: 1, minHeight: 48, color: colors.ink, fontSize: 16, paddingVertical: 10 },
  filterClear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  filterClearText: { color: colors.muted, fontSize: 27, lineHeight: 29 },
  list: { padding: 14 },
  queueList: { padding: 14 },
  withBar: { paddingBottom: 94 },
  withPlayer: { paddingBottom: 226 },
  emptyList: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  empty: { alignItems: 'center', maxWidth: 300 },
  emptyTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  emptyCopy: { color: colors.muted, textAlign: 'center', fontSize: 14, lineHeight: 21 },
  card: { marginBottom: 14, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardHeading: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, backgroundColor: colors.elevated },
  type: { color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 1.5, marginBottom: 4 },
  workTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', lineHeight: 22 },
  detail: { color: colors.muted, fontSize: 12, marginTop: 4 },
  catalogue: { color: colors.gold, fontSize: 10, marginTop: 3 },
  workSection: { borderTopWidth: 1, borderTopColor: colors.border },
  workHeading: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11 },
  workSectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '800', lineHeight: 19 },
  addButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.accent },
  addButtonSecondary: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.accent, backgroundColor: 'transparent' },
  addButtonText: { color: colors.ink, fontSize: 25, lineHeight: 27 },
  trackRow: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  currentRow: { marginVertical: 4, marginHorizontal: 3, borderWidth: 2, borderLeftWidth: 6, borderColor: colors.accent, borderRadius: 12, backgroundColor: '#351719', shadowColor: colors.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.32, shadowRadius: 8, elevation: 5 },
  currentStatus: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.4, marginBottom: 3 },
  currentTitle: { color: '#FFFFFF' },
  currentTrackPosition: { color: colors.ink, fontSize: 15 },
  trackPosition: { width: 28, color: colors.gold, fontSize: 13, fontWeight: '800' },
  trackTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  warning: { color: colors.warning, fontSize: 10, marginTop: 3 },
  concertHeader: { marginBottom: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated },
  concertTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  concertTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  clearButton: { minHeight: 34, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  clearText: { color: colors.warning, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  narrationHeading: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginTop: 18 },
  narrationHelp: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  fieldChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  fieldChoice: { minHeight: 32, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  fieldChoiceSelected: { borderColor: colors.accent, backgroundColor: '#2A1D1A' },
  fieldChoiceText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  fieldChoiceTextSelected: { color: colors.ink },
  frozen: { color: colors.gold, fontSize: 11, lineHeight: 16, marginTop: 10 },
  groupHeader: { marginTop: 14, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 13, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, backgroundColor: '#18181A' },
  groupRelease: { color: colors.muted, fontSize: 10, marginBottom: 5 },
  groupEyebrow: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  groupTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', lineHeight: 25, marginTop: 3 },
  groupVersion: { color: colors.muted, fontSize: 11, marginTop: 4 },
  groupCatalogue: { color: colors.gold, fontSize: 11, marginTop: 5 },
  groupCreators: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  queueRow: { flexDirection: 'row', gap: 10, minHeight: 62, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.surface },
  narrationRow: { backgroundColor: colors.elevated },
  queueIcon: { width: 30, color: colors.gold, fontSize: 25, lineHeight: 30, textAlign: 'center' },
  currentQueueIcon: { color: colors.ink, backgroundColor: colors.accent, borderRadius: 15, overflow: 'hidden' },
  queuePlayButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', borderRadius: 22, borderWidth: 2, borderColor: colors.gold, backgroundColor: '#211B12' },
  currentQueuePlayButton: { borderColor: colors.accent, backgroundColor: colors.accent },
  queuePlayButtonPressed: { transform: [{ scale: 0.94 }], backgroundColor: colors.accentPressed },
  queuePlayIcon: { color: colors.ink, fontSize: 21, lineHeight: 24, marginLeft: 2 },
  narrationStatus: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  narrationTitle: { color: colors.ink, fontSize: 13, fontWeight: '800', marginTop: 2 },
  narrationCopy: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  queueWork: { color: colors.muted, fontSize: 10 },
  queueTitle: { color: colors.ink, fontSize: 15, fontWeight: '800', marginTop: 2 },
  noticeBar: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  noticeWithBar: { bottom: 72 },
  noticeWithPlayer: { bottom: 205 },
  notice: { flex: 1, color: colors.gold, fontSize: 12 },
  undo: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  concertBar: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#111112', borderTopWidth: 1, borderTopColor: colors.border },
  barText: { color: colors.ink, fontSize: 14, fontWeight: '800', marginTop: 3 },
  player: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 205, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, backgroundColor: '#111112', borderTopWidth: 1, borderTopColor: colors.border },
  nowLabel: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
  nowRelease: { color: colors.gold, fontSize: 10, marginTop: 3 },
  nowWork: { color: colors.muted, fontSize: 12, marginTop: 3 },
  nowTrack: { color: colors.ink, fontSize: 17, fontWeight: '800', marginTop: 2 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  time: { width: 38, color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
  progress: { flex: 1, height: 3, overflow: 'hidden', backgroundColor: colors.border, borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: colors.accent },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  control: { minWidth: 46, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  controlText: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  mainControl: { minWidth: 72, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.accent },
  mainControlText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  disabled: { opacity: 0.3 },
});
