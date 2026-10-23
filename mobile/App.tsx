import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import TimeV3Native from './modules/time-v3-native/src/TimeV3NativeModule';
import {
  ApiError,
  fetchRequests,
  submitText,
  submitVoice,
  verifyConnection,
} from './src/api';
import { productionServerUrl } from './src/config';
import {
  loadConnectionSettings,
  saveConnectionSettings,
} from './src/storage';
import { colors } from './src/theme';
import type { AgentRequest, ConnectionSettings, Health } from './src/types';

const voiceRecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

const meterHistoryLength = 18;

type RecordingPhase = 'idle' | 'recording' | 'cancelling' | 'sending';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function formatClock(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function normalizeMetering(decibels: number | undefined): number {
  if (decibels === undefined || !Number.isFinite(decibels)) return 0;
  const normalized = Math.max(0, Math.min(1, (decibels + 55) / 55));
  return Math.pow(normalized, 0.55);
}

function ConnectionModal({
  visible,
  initial,
  onConnected,
  onCancel,
}: {
  visible: boolean;
  initial: ConnectionSettings | null;
  onConnected: (settings: ConnectionSettings, health: Health) => void;
  onCancel: (() => void) | null;
}) {
  const [accessToken, setAccessToken] = useState(initial?.accessToken ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const setupScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    setAccessToken(initial?.accessToken ?? '');
    setError('');
  }, [initial, visible]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      setTimeout(() => setupScrollRef.current?.scrollToEnd({ animated: true }), 50);
      setTimeout(() => setupScrollRef.current?.scrollToEnd({ animated: true }), 300);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const revealFormActions = () => {
    setTimeout(() => setupScrollRef.current?.scrollToEnd({ animated: true }), 100);
    setTimeout(() => setupScrollRef.current?.scrollToEnd({ animated: true }), 350);
  };

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const settings = { baseUrl: productionServerUrl, accessToken: accessToken.trim() };
      if (!settings.accessToken) throw new ApiError('Enter the Time V3 Technology Agent access token.');
      const health = await verifyConnection(settings);
      await saveConnectionSettings(settings);
      onConnected(settings, health);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel ?? undefined}>
      <SafeAreaView style={styles.setupPage} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.setupKeyboardView}
        >
          <ScrollView
            ref={setupScrollRef}
            contentContainerStyle={[
              styles.setupContent,
              keyboardHeight > 0 && styles.setupContentKeyboard,
              keyboardHeight > 0 && { paddingBottom: keyboardHeight + 48 },
            ]}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="always"
            onContentSizeChange={() => {
              if (keyboardHeight > 0) setupScrollRef.current?.scrollToEnd({ animated: false });
            }}
          >
            {keyboardHeight === 0 && <View style={styles.setupMark}><Text style={styles.setupMarkText}>T3</Text></View>}
            {keyboardHeight === 0 && <Text style={styles.setupEyebrow}>PRIVATE CONNECTION</Text>}
            <Text style={styles.setupTitle}>Connect your agent</Text>
            {keyboardHeight === 0 && (
              <Text style={styles.setupCopy}>
                Enter your access token. The production server address is built into the app, and the token is stored in the phone’s secure credential store.
              </Text>
            )}
            <Text style={styles.fieldLabel}>SERVER URL</Text>
            <TextInput
              editable={false}
              style={styles.field}
              value={productionServerUrl}
            />
            <Text style={styles.fieldLabel}>ACCESS TOKEN</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Paste your server token"
              placeholderTextColor={colors.dim}
              returnKeyType="done"
              secureTextEntry
              style={styles.field}
              value={accessToken}
              onChangeText={setAccessToken}
              onFocus={revealFormActions}
              onSubmitEditing={Keyboard.dismiss}
            />
            {!!error && <Text style={styles.formError}>{error}</Text>}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={connect}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, busy && styles.disabled]}
            >
              {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryButtonText}>TEST & CONNECT</Text>}
            </Pressable>
            {onCancel && (
              <Pressable onPress={onCancel} style={styles.textButton}>
                <Text style={styles.textButtonLabel}>Cancel</Text>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function MessageDraftModal({
  visible,
  initialBody,
  onClose,
}: {
  visible: boolean;
  initialBody: string;
  onClose: () => void;
}) {
  const [recipient, setRecipient] = useState('');
  const [body, setBody] = useState(initialBody);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setBody(initialBody);
      setError('');
    }
  }, [initialBody, visible]);

  const openMessages = async () => {
    if (!body.trim()) {
      setError('Write or paste a message first.');
      return;
    }
    try {
      await TimeV3Native.composeText(recipient.trim(), body.trim());
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalShade}>
        <View style={styles.draftCard}>
          <Text style={styles.draftTitle}>Open message draft</Text>
          <Text style={styles.draftCopy}>Your normal Messages app opens with this text. Nothing sends until you tap Send there.</Text>
          <TextInput
            keyboardType="phone-pad"
            placeholder="Recipient (optional)"
            placeholderTextColor={colors.dim}
            style={styles.field}
            value={recipient}
            onChangeText={setRecipient}
          />
          <TextInput
            multiline
            placeholder="Message"
            placeholderTextColor={colors.dim}
            style={[styles.field, styles.draftBody]}
            textAlignVertical="top"
            value={body}
            onChangeText={setBody}
          />
          {!!error && <Text style={styles.formError}>{error}</Text>}
          <View style={styles.modalActions}>
            <Pressable onPress={onClose} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
            <Pressable onPress={openMessages} style={styles.primaryButtonSmall}><Text style={styles.primaryButtonText}>OPEN MESSAGES</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function sameRequestPresentation(left: AgentRequest, right: AgentRequest): boolean {
  return left.requestId === right.requestId
    && left.channel === right.channel
    && left.submittedAtMs === right.submittedAtMs
    && left.status === right.status
    && left.request === right.request
    && left.response === right.response
    && left.error === right.error
    && left.progress?.label === right.progress?.label;
}

function reconcileRequests(current: AgentRequest[], incoming: AgentRequest[]): AgentRequest[] {
  const currentById = new Map(current.map((request) => [request.requestId, request]));
  return incoming.map((request) => {
    const existing = currentById.get(request.requestId);
    return existing && sameRequestPresentation(existing, request) ? existing : request;
  });
}

const RequestCard = memo(function RequestCard({ request, onDraft }: { request: AgentRequest; onDraft: (text: string) => void }) {
  const active = request.status === 'queued' || request.status === 'processing';
  return (
    <View style={styles.exchange}>
      <View style={styles.requestMeta}>
        <Text style={styles.requestKind}>{request.channel === 'voice' ? 'VOICE' : 'YOU'}</Text>
        <Text style={styles.requestTime}>{formatClock(request.submittedAtMs)}</Text>
      </View>
      <View style={styles.userBubble}><Text selectable style={styles.userText}>{request.request}</Text></View>
      {active && (
        <View style={styles.progressRow}>
          <ActivityIndicator color={colors.gold} size="small" />
          <Text style={styles.progressText}>{request.progress?.label ?? request.status}</Text>
        </View>
      )}
      {!!request.response && (
        <View style={styles.agentBlock}>
          <Text style={styles.agentLabel}>TIME V3 TECHNOLOGY AGENT</Text>
          <Text selectable style={styles.agentText}>{request.response}</Text>
          <Pressable onPress={() => onDraft(request.response ?? '')} style={styles.draftAction}>
            <Text style={styles.draftActionText}>USE AS MESSAGE DRAFT</Text>
          </Pressable>
        </View>
      )}
      {!!request.error && <Text selectable style={styles.requestError}>{request.error}</Text>}
    </View>
  );
});

function AgentScreen() {
  const [booting, setBooting] = useState(true);
  const [settings, setSettings] = useState<ConnectionSettings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [requests, setRequests] = useState<AgentRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [composer, setComposer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>('idle');
  const [meterHistory, setMeterHistory] = useState<number[]>(
    () => Array.from({ length: meterHistoryLength }, () => 0),
  );
  const [notice, setNotice] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [showDraft, setShowDraft] = useState(false);
  const list = useRef<FlatList<AgentRequest>>(null);
  const listPositioned = useRef(false);
  const listNearEnd = useRef(true);
  const recordingPulse = useRef(new Animated.Value(1)).current;
  const recorder = useAudioRecorder(voiceRecordingOptions);
  const recording = useAudioRecorderState(recorder, 100);

  const scrollToLatest = useCallback((animated = false) => {
    requestAnimationFrame(() => list.current?.scrollToEnd({ animated }));
  }, []);

  useEffect(() => {
    void loadConnectionSettings()
      .then((saved) => {
        setSettings(saved);
        setShowSettings(!saved);
      })
      .catch((error) => setNotice(errorMessage(error)))
      .finally(() => setBooting(false));
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!settings) return;
    if (!quiet) setRefreshing(true);
    try {
      const next = await fetchRequests(settings, 20);
      setRequests((current) => reconcileRequests(current, next.reverse()));
      if (quiet) setNotice('');
    } catch (error) {
      setNotice(errorMessage(error));
      if (error instanceof ApiError && error.status === 401) setShowSettings(true);
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, [settings]);

  useEffect(() => {
    if (!settings) return;
    void refresh();
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void refresh(true);
    }, 2_500);
    return () => clearInterval(interval);
  }, [refresh, settings]);

  useEffect(() => {
    if (!requests.length) return;
    if (!listPositioned.current || listNearEnd.current) {
      const timeout = setTimeout(() => {
        scrollToLatest(false);
        listPositioned.current = true;
      }, 50);
      return () => clearTimeout(timeout);
    }
  }, [requests.length, scrollToLatest]);

  useEffect(() => {
    if (recordingPhase !== 'recording') {
      recordingPulse.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(recordingPulse, { toValue: 0.3, duration: 650, useNativeDriver: true }),
        Animated.timing(recordingPulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [recordingPhase, recordingPulse]);

  useEffect(() => {
    if (recordingPhase !== 'recording') return;
    const level = normalizeMetering(recording.metering);
    setMeterHistory((history) => [...history.slice(1), level]);
  }, [recording.durationMillis, recording.metering, recordingPhase]);

  const send = async () => {
    const text = composer.trim();
    if (!settings || !text || submitting) return;
    setSubmitting(true);
    setNotice('Submitting exact request…');
    try {
      await submitText(settings, text);
      setComposer('');
      setNotice('Request queued.');
      await refresh(true);
      scrollToLatest(true);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const startRecording = async () => {
    if (!settings || submitting || recordingPhase !== 'idle') return;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission is required for voice requests.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      setMeterHistory(Array.from({ length: meterHistoryLength }, () => 0));
      recorder.record();
      setRecordingPhase('recording');
      setNotice('Recording…');
    } catch (error) {
      setRecordingPhase('idle');
      setNotice(errorMessage(error));
    }
  };

  const sendRecording = async () => {
    if (!settings || submitting || recordingPhase !== 'recording') return;
    setRecordingPhase('sending');
    setSubmitting(true);
    setNotice('Saving recording…');
    try {
      await recorder.stop();
      const uri = recorder.uri ?? recorder.getStatus().url;
      if (!uri) throw new Error('The phone did not produce a recording file.');
      setNotice('Uploading voice request…');
      await submitVoice(settings, uri);
      setNotice('Voice request queued.');
      await refresh(true);
      scrollToLatest(true);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setSubmitting(false);
      setRecordingPhase('idle');
    }
  };

  const cancelRecording = async () => {
    if (recordingPhase !== 'recording') return;
    setRecordingPhase('cancelling');
    try {
      await recorder.stop();
      setNotice('Recording discarded.');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setRecordingPhase('idle');
    }
  };

  const openDraft = useCallback((body = '') => {
    setDraftBody(body);
    setShowDraft(true);
  }, []);

  const connectionLabel = useMemo(() => {
    if (!settings) return 'NOT CONNECTED';
    if (health?.ready === false) return 'SERVER NEEDS ATTENTION';
    return 'CONNECTED';
  }, [health, settings]);

  if (booting) {
    return <View style={styles.boot}><ActivityIndicator color={colors.accent} size="large" /></View>;
  }

  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <ConnectionModal
        visible={showSettings}
        initial={settings}
        onCancel={settings ? () => setShowSettings(false) : null}
        onConnected={(next, nextHealth) => {
          setSettings(next);
          setHealth(nextHealth);
          setShowSettings(false);
          setNotice(nextHealth.ready ? 'Connected.' : nextHealth.reason ?? 'Connected; server is not ready.');
        }}
      />
      <MessageDraftModal visible={showDraft} initialBody={draftBody} onClose={() => setShowDraft(false)} />
      <View style={styles.header}>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>TIME V3</Text>
          <Text style={styles.brandDetail}>TECHNOLOGY AGENT</Text>
          <View style={styles.connectionRow}>
            <View style={[styles.connectionDot, settings && styles.connectionDotOn]} />
            <Text style={styles.connectionText}>{connectionLabel}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="Open an SMS draft" onPress={() => openDraft()} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>SMS</Text>
          </Pressable>
          <Pressable accessibilityLabel="Connection settings" onPress={() => setShowSettings(true)} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>SET</Text>
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={styles.conversation}>
        <FlatList
          ref={list}
          data={requests}
          initialNumToRender={4}
          keyExtractor={(item) => item.requestId}
          maxToRenderPerBatch={4}
          removeClippedSubviews={Platform.OS === 'android'}
          renderItem={({ item }) => <RequestCard request={item} onDraft={openDraft} />}
          contentContainerStyle={requests.length ? styles.list : styles.emptyList}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (!listPositioned.current || listNearEnd.current) {
              scrollToLatest(false);
              listPositioned.current = true;
            }
          }}
          onScroll={({ nativeEvent }) => {
            const distanceFromEnd = nativeEvent.contentSize.height
              - nativeEvent.layoutMeasurement.height
              - nativeEvent.contentOffset.y;
            listNearEnd.current = distanceFromEnd < 120;
          }}
          scrollEventThrottle={16}
          updateCellsBatchingPeriod={80}
          windowSize={5}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyMonogram}>T3</Text>
              <Text style={styles.emptyTitle}>{settings ? 'Ready when you are' : 'Connect your server'}</Text>
              <Text style={styles.emptyCopy}>Type an exact request or hold a thought in your voice. The server preserves the full interaction trace.</Text>
            </View>
          }
        />

        {!!notice && <Text numberOfLines={2} style={styles.notice}>{notice}</Text>}
        {recordingPhase !== 'idle' ? (
          <View style={styles.recordingBar}>
            <Pressable
              accessibilityLabel="Cancel and discard voice recording"
              accessibilityRole="button"
              disabled={recordingPhase !== 'recording'}
              onPress={cancelRecording}
              style={({ pressed }) => [
                styles.cancelRecording,
                pressed && styles.recordingControlPressed,
                recordingPhase !== 'recording' && styles.disabled,
              ]}
            >
              <Text style={styles.cancelRecordingIcon}>×</Text>
              <Text style={styles.cancelRecordingText}>CANCEL</Text>
            </Pressable>
            <View style={styles.recordingPanel}>
              <View style={styles.recordingReadout}>
                <Animated.View style={[styles.recordingDot, { opacity: recordingPulse }]} />
                <Text style={styles.recordingLabel}>
                  {recordingPhase === 'sending' ? 'SENDING' : recordingPhase === 'cancelling' ? 'DISCARDING' : 'RECORDING'}
                </Text>
                <Text style={styles.recordingTime}>{formatDuration(recording.durationMillis)}</Text>
              </View>
              <View accessibilityLabel="Live voice waveform" style={styles.audioMeter}>
                <View style={styles.audioMeterBaseline} />
                {meterHistory.map((level, index) => (
                  <View
                    key={index}
                    style={[
                      styles.audioMeterBar,
                      {
                        height: 4 + Math.round(30 * level),
                        opacity: 0.35 + (0.65 * level),
                      },
                    ]}
                  />
                ))}
              </View>
            </View>
            <Pressable
              accessibilityLabel="Send voice recording"
              accessibilityRole="button"
              disabled={recordingPhase !== 'recording'}
              onPress={sendRecording}
              style={({ pressed }) => [
                styles.voiceSendButton,
                pressed && styles.primaryButtonPressed,
                recordingPhase !== 'recording' && styles.disabled,
              ]}
            >
              {recordingPhase === 'sending' ? (
                <ActivityIndicator color={colors.ink} size="small" />
              ) : (
                <Text style={styles.sendGlyph}>↑</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.composer}>
            <Pressable
              accessibilityLabel="Record voice request"
              disabled={!settings || submitting}
              onPress={startRecording}
              style={({ pressed }) => [styles.micButton, pressed && styles.micButtonPressed, (!settings || submitting) && styles.disabled]}
            >
              <View style={styles.micGlyph}><View style={styles.micStem} /></View>
            </Pressable>
            <TextInput
              editable={!!settings && !submitting}
              multiline
              onChangeText={setComposer}
              onFocus={() => setTimeout(() => scrollToLatest(true), 300)}
              placeholder={settings ? 'Ask Time V3 Technology Agent…' : 'Connect the server first'}
              placeholderTextColor={colors.dim}
              style={styles.composerInput}
              textAlignVertical="top"
              value={composer}
            />
            <Pressable
              accessibilityLabel="Submit request"
              disabled={!settings || !composer.trim() || submitting}
              onPress={send}
              style={({ pressed }) => [styles.sendButton, pressed && styles.primaryButtonPressed, (!settings || !composer.trim() || submitting) && styles.disabled]}
            >
              {submitting ? <ActivityIndicator color={colors.ink} size="small" /> : <Text style={styles.sendGlyph}>↑</Text>}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><AgentScreen /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  conversation: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  brandBlock: { flex: 1, marginRight: 12 },
  brand: { color: colors.ink, fontSize: 18, fontWeight: '900', letterSpacing: 2.1 },
  brandDetail: { color: colors.ink, fontSize: 9, fontWeight: '800', letterSpacing: 1.7, marginTop: 1 },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  connectionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dim },
  connectionDotOn: { backgroundColor: colors.success },
  connectionText: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerButton: { minWidth: 42, height: 36, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  headerButtonText: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  list: { padding: 16, paddingBottom: 24 },
  emptyList: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  empty: { alignItems: 'center', maxWidth: 340, alignSelf: 'center' },
  emptyMonogram: { width: 84, height: 84, borderRadius: 42, textAlign: 'center', textAlignVertical: 'center', color: colors.gold, borderWidth: 1, borderColor: colors.gold, fontSize: 25, fontWeight: '300', letterSpacing: 2, lineHeight: 82, marginBottom: 24 },
  emptyTitle: { color: colors.ink, fontSize: 23, fontWeight: '700', marginBottom: 8 },
  emptyCopy: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  exchange: { marginBottom: 28 },
  requestMeta: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 6 },
  requestKind: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  requestTime: { color: colors.dim, fontSize: 11 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '88%', paddingHorizontal: 15, paddingVertical: 11, backgroundColor: colors.elevated, borderRadius: 18, borderBottomRightRadius: 5 },
  userText: { color: colors.ink, fontSize: 16, lineHeight: 22 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14, marginLeft: 2 },
  progressText: { color: colors.gold, fontSize: 13 },
  agentBlock: { marginTop: 18, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: colors.accent },
  agentLabel: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.6, marginBottom: 8 },
  agentText: { color: colors.ink, fontSize: 16, lineHeight: 24 },
  draftAction: { alignSelf: 'flex-start', marginTop: 12, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  draftActionText: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.1 },
  requestError: { marginTop: 12, color: colors.error, fontSize: 14, lineHeight: 20 },
  notice: { color: colors.muted, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 7, fontSize: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  composerInput: { flex: 1, minHeight: 46, maxHeight: 128, color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 15, paddingVertical: 12, fontSize: 16, lineHeight: 21 },
  micButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  micButtonPressed: { backgroundColor: colors.accentPressed },
  micGlyph: { width: 12, height: 18, borderWidth: 2, borderColor: colors.ink, borderRadius: 7, alignItems: 'center', justifyContent: 'flex-end' },
  micStem: { position: 'absolute', bottom: -6, width: 8, height: 5, borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: colors.ink, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  sendButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  sendGlyph: { color: colors.ink, fontSize: 25, fontWeight: '500', marginTop: -2 },
  recordingBar: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  cancelRecording: { width: 58, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  cancelRecordingIcon: { color: colors.muted, fontSize: 24, fontWeight: '300', lineHeight: 23 },
  cancelRecordingText: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.1, marginTop: 2 },
  recordingControlPressed: { backgroundColor: colors.elevated },
  recordingPanel: { flex: 1, minHeight: 66, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border },
  recordingReadout: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recordingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  recordingLabel: { flex: 1, color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  recordingTime: { color: colors.ink, fontVariant: ['tabular-nums'], fontSize: 13, fontWeight: '700' },
  audioMeter: { position: 'relative', height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2 },
  audioMeterBaseline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  audioMeterBar: { flex: 1, maxWidth: 4, minHeight: 4, borderRadius: 2, backgroundColor: colors.accent },
  voiceSendButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  setupPage: { flex: 1, backgroundColor: colors.background },
  setupKeyboardView: { flex: 1 },
  setupContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24 },
  setupContentKeyboard: { justifyContent: 'flex-start', paddingTop: 16 },
  setupMark: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  setupMarkText: { color: colors.gold, fontSize: 20, fontWeight: '300', letterSpacing: 1.5 },
  setupEyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  setupTitle: { color: colors.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginBottom: 12 },
  setupCopy: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 30 },
  fieldLabel: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginBottom: 7, marginTop: 10 },
  field: { minHeight: 50, color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  formError: { color: colors.error, fontSize: 13, lineHeight: 18, marginTop: 12 },
  primaryButton: { minHeight: 52, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryButtonSmall: { flex: 1, minHeight: 46, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryButtonPressed: { backgroundColor: colors.accentPressed },
  primaryButtonText: { color: colors.ink, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  textButton: { alignItems: 'center', padding: 16 },
  textButtonLabel: { color: colors.muted, fontSize: 14 },
  disabled: { opacity: 0.4 },
  modalShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.76)', justifyContent: 'center', padding: 18 },
  draftCard: { backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 20 },
  draftTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  draftCopy: { color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  draftBody: { height: 150, marginTop: 10 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  secondaryButton: { flex: 0.65, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
});
