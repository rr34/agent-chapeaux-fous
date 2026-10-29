import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMusic, musicSource } from './api';
import { colors } from './theme';
import type { ConnectionSettings, MusicFile, MusicSequence } from './types';

type WorkGroup = {
  key: string;
  title: string;
  type: string | null;
  creators: string[];
  files: MusicFile[];
};

function numberValue(value: number | string | null | undefined): number {
  return typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10) || Number.MAX_SAFE_INTEGER;
}

function sequenceText(sequence: MusicSequence | null, fallback: string): string {
  if (!sequence) return fallback;
  const number = sequence.number == null ? '' : `${sequence.number}. `;
  return `${number}${sequence.title || sequence.type}`;
}

function trackTitle(file: MusicFile): string {
  return sequenceText(file.metadata?.sequence2 ?? file.metadata?.sequence1 ?? null, file.title);
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function workGroups(files: MusicFile[]): WorkGroup[] {
  const groups = new Map<string, WorkGroup>();
  for (const file of files) {
    const work = file.metadata?.work;
    const title = work?.title || file.title || file.originalFilename || `File ${file.fileId}`;
    const creators = work?.creators ?? [];
    const key = JSON.stringify([work?.type ?? 'unknown', title, creators]);
    const group = groups.get(key) ?? { key, title, type: work?.type ?? null, creators, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.files.sort((left, right) => {
      const first = numberValue(left.metadata?.sequence1?.number) - numberValue(right.metadata?.sequence1?.number);
      if (first) return first;
      const second = numberValue(left.metadata?.sequence2?.number) - numberValue(right.metadata?.sequence2?.number);
      return second || left.fileId - right.fileId;
    });
  }
  return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function WorkCard({ group, currentFileId, onPlay }: {
  group: WorkGroup;
  currentFileId: number | null;
  onPlay: (group: WorkGroup, index: number) => void;
}) {
  return (
    <View style={styles.workCard}>
      <View style={styles.workHeading}>
        <View style={styles.workHeadingText}>
          <Text style={styles.workType}>{(group.type || 'music').toUpperCase()}</Text>
          <Text style={styles.workTitle}>{group.title}</Text>
          {!!group.creators.length && <Text style={styles.workCreators}>{group.creators.join(' · ')}</Text>}
        </View>
        <Pressable onPress={() => onPlay(group, 0)} style={styles.playWorkButton}>
          <Text style={styles.playWorkButtonText}>PLAY WORK</Text>
        </Pressable>
      </View>
      {group.files.map((file, index) => (
        <Pressable
          key={file.fileId}
          onPress={() => onPlay(group, index)}
          style={[styles.trackRow, currentFileId === file.fileId && styles.trackRowCurrent]}
        >
          <Text style={styles.trackPosition}>{file.metadata?.sequence2?.number ?? file.metadata?.sequence1?.number ?? index + 1}</Text>
          <View style={styles.trackText}>
            <Text numberOfLines={2} style={styles.trackTitle}>{trackTitle(file)}</Text>
            {!!file.metadata?.performers?.length && (
              <Text numberOfLines={1} style={styles.trackDetail}>{file.metadata.performers.join(' · ')}</Text>
            )}
            {!file.metadata && <Text numberOfLines={1} style={styles.metadataWarning}>Metadata needs review</Text>}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export function MusicPlayerModal({ visible, settings, onClose }: {
  visible: boolean;
  settings: ConnectionSettings;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<MusicFile[]>([]);
  const [queue, setQueue] = useState<MusicFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [stopAfterIndex, setStopAfterIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const boundaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledFinish = useRef(false);
  const player = useAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);
  const groups = useMemo(() => workGroups(files), [files]);
  const current = currentIndex >= 0 ? queue[currentIndex] ?? null : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      setFiles(await fetchMusic(settings));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load music.');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    if (!visible) return;
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    void refresh();
  }, [refresh, visible]);

  useEffect(() => () => {
    if (boundaryTimer.current) clearTimeout(boundaryTimer.current);
    if (playTimer.current) clearTimeout(playTimer.current);
    player.clearLockScreenControls();
  }, [player]);

  const load = useCallback((nextQueue: MusicFile[], index: number, play = true) => {
    const file = nextQueue[index];
    if (!file) return;
    if (boundaryTimer.current) clearTimeout(boundaryTimer.current);
    if (playTimer.current) clearTimeout(playTimer.current);
    handledFinish.current = false;
    setQueue(nextQueue);
    setCurrentIndex(index);
    setNotice('');
    player.replace(musicSource(settings, file));
    player.setActiveForLockScreen(true, {
      title: trackTitle(file),
      artist: file.metadata?.work.creators?.join(', ') || file.metadata?.performers?.join(', ') || undefined,
      albumTitle: file.metadata?.work.title || undefined,
    });
    if (play) playTimer.current = setTimeout(() => player.play(), 100);
  }, [player, settings]);

  useEffect(() => {
    if (!status.didJustFinish || handledFinish.current || currentIndex < 0) return;
    handledFinish.current = true;
    if (stopAfterIndex !== null && currentIndex >= stopAfterIndex) {
      setNotice('Selected stopping point reached. Playback stopped.');
      return;
    }
    if (currentIndex + 1 >= queue.length) {
      setNotice('Work complete. Playback stopped.');
      return;
    }
    const next = queue[currentIndex + 1];
    if (!next) return;
    setNotice(`Next: ${trackTitle(next)}`);
    boundaryTimer.current = setTimeout(() => load(queue, currentIndex + 1), 1500);
  }, [currentIndex, load, queue, status.didJustFinish, stopAfterIndex]);

  const playWork = (group: WorkGroup, index: number) => {
    setStopAfterIndex(null);
    load(group.files, index);
  };

  const close = () => {
    if (boundaryTimer.current) clearTimeout(boundaryTimer.current);
    if (playTimer.current) clearTimeout(playTimer.current);
    player.pause();
    player.clearLockScreenControls();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>CONCERT PLAYER</Text>
            <Text style={styles.heading}>Music</Text>
          </View>
          <Pressable onPress={close} style={styles.closeButton}><Text style={styles.closeText}>CLOSE</Text></Pressable>
        </View>
        <FlatList
          data={groups}
          keyExtractor={(group) => group.key}
          contentContainerStyle={groups.length ? styles.list : styles.emptyList}
          renderItem={({ item }) => (
            <WorkCard
              group={item}
              currentFileId={current?.fileId ?? null}
              onPlay={playWork}
            />
          )}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.accent} />}
          ListEmptyComponent={loading
            ? <ActivityIndicator color={colors.accent} size="large" />
            : <View style={styles.empty}><Text style={styles.emptyTitle}>No music yet</Text><Text style={styles.emptyCopy}>Upload MP3 files to the agent and ask it to identify and organize them.</Text></View>}
        />
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {current && (
          <View style={styles.player}>
            <Text style={styles.nowLabel}>NOW PLAYING</Text>
            <Text numberOfLines={1} style={styles.nowWork}>{current.metadata?.work.title || current.title}</Text>
            <Text numberOfLines={2} style={styles.nowTrack}>{trackTitle(current)}</Text>
            <View style={styles.timeRow}>
              <Text style={styles.time}>{formatTime(status.currentTime)}</Text>
              <View style={styles.progress}><View style={[styles.progressFill, { width: `${status.duration > 0 ? Math.min(100, (status.currentTime / status.duration) * 100) : 0}%` }]} /></View>
              <Text style={styles.time}>{formatTime(status.duration)}</Text>
            </View>
            <Pressable
              onPress={() => setStopAfterIndex((value) => value === currentIndex ? null : currentIndex)}
              style={[styles.stopAfter, stopAfterIndex === currentIndex && styles.stopAfterSelected]}
            >
              <Text style={styles.stopAfterText}>{stopAfterIndex === currentIndex ? 'WILL STOP AFTER THIS' : 'STOP AFTER THIS'}</Text>
            </Pressable>
            <View style={styles.controls}>
              <Pressable disabled={currentIndex <= 0} onPress={() => load(queue, currentIndex - 1)} style={[styles.control, currentIndex <= 0 && styles.disabled]}><Text style={styles.controlText}>PREV</Text></Pressable>
              <Pressable onPress={() => void player.seekTo(Math.max(0, status.currentTime - 15))} style={styles.control}><Text style={styles.controlText}>−15</Text></Pressable>
              <Pressable onPress={() => status.playing ? player.pause() : player.play()} style={styles.mainControl}><Text style={styles.mainControlText}>{status.playing ? 'PAUSE' : 'PLAY'}</Text></Pressable>
              <Pressable onPress={() => void player.seekTo(Math.min(status.duration || status.currentTime + 15, status.currentTime + 15))} style={styles.control}><Text style={styles.controlText}>+15</Text></Pressable>
              <Pressable disabled={currentIndex + 1 >= queue.length} onPress={() => load(queue, currentIndex + 1)} style={[styles.control, currentIndex + 1 >= queue.length && styles.disabled]}><Text style={styles.controlText}>NEXT</Text></Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.8 },
  heading: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  closeButton: { minHeight: 38, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  closeText: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  list: { padding: 14, paddingBottom: 250 },
  emptyList: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  empty: { alignItems: 'center', maxWidth: 300 },
  emptyTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  emptyCopy: { color: colors.muted, textAlign: 'center', fontSize: 14, lineHeight: 21 },
  workCard: { marginBottom: 14, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  workHeading: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, backgroundColor: colors.elevated },
  workHeadingText: { flex: 1 },
  workType: { color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 1.5, marginBottom: 4 },
  workTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', lineHeight: 22 },
  workCreators: { color: colors.muted, fontSize: 12, marginTop: 5 },
  playWorkButton: { paddingHorizontal: 10, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.accent },
  playWorkButtonText: { color: colors.ink, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  trackRow: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  trackRowCurrent: { backgroundColor: '#27201B' },
  trackPosition: { width: 28, color: colors.gold, fontSize: 13, fontWeight: '800' },
  trackText: { flex: 1 },
  trackTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  trackDetail: { color: colors.muted, fontSize: 11, marginTop: 2 },
  metadataWarning: { color: colors.warning, fontSize: 10, marginTop: 3 },
  notice: { color: colors.gold, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 7, fontSize: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  player: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, backgroundColor: '#111112', borderTopWidth: 1, borderTopColor: colors.border },
  nowLabel: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
  nowWork: { color: colors.muted, fontSize: 12, marginTop: 3 },
  nowTrack: { color: colors.ink, fontSize: 17, fontWeight: '800', marginTop: 2 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  time: { width: 38, color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
  progress: { flex: 1, height: 3, overflow: 'hidden', backgroundColor: colors.border, borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: colors.accent },
  stopAfter: { alignSelf: 'flex-start', minHeight: 28, marginTop: 8, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  stopAfterSelected: { borderColor: colors.gold, backgroundColor: '#27201B' },
  stopAfterText: { color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  control: { minWidth: 46, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  controlText: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  mainControl: { minWidth: 72, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.accent },
  mainControlText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  disabled: { opacity: 0.3 },
});
