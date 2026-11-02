import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TimeV3Native from '../modules/time-v3-native/src/TimeV3NativeModule';
import { fetchContacts } from './api';
import { colors } from './theme';
import type { AgentContact, AgentContactMethod, ConnectionSettings } from './types';

const requiredContactShellVersion = 5;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load contacts.';
}

function methodLabel(method: AgentContactMethod) {
  return method.label?.trim() || method.kind.replaceAll('_', ' ');
}

function contactSearchText(contact: AgentContact) {
  return [
    contact.displayName,
    contact.givenName,
    contact.familyName,
    contact.organizationName,
    contact.notes,
    ...contact.tags,
    ...contact.methods.flatMap((method) => [method.label, method.value]),
  ].filter(Boolean).join('\n').toLocaleLowerCase();
}

function nativeContactInput(contact: AgentContact) {
  return {
    displayName: contact.displayName,
    givenName: contact.givenName,
    familyName: contact.familyName,
    organizationName: contact.organizationName,
    birthDate: contact.birthDate,
    notes: contact.notes,
    methods: contact.methods.map((method) => ({
      kind: method.kind,
      label: method.label,
      value: method.value,
      isPrimary: method.isPrimary,
    })),
  };
}

function ContactMethod({ method }: { method: AgentContactMethod }) {
  const open = () => {
    const href = method.kind === 'phone'
      ? `tel:${method.value}`
      : method.kind === 'email'
        ? `mailto:${method.value}`
        : method.kind === 'url'
          ? method.value
          : null;
    if (href) void Linking.openURL(href);
  };
  const actionable = ['phone', 'email', 'url'].includes(method.kind);
  return <Pressable
    accessibilityRole={actionable ? 'link' : undefined}
    disabled={!actionable}
    onPress={open}
    style={styles.method}
  >
    <Text style={styles.methodLabel}>{methodLabel(method).toUpperCase()}</Text>
    <Text selectable style={[styles.methodValue, actionable && styles.methodValueAction]}>{method.value}</Text>
  </Pressable>;
}

function ContactRow({
  contact,
  nativeAvailable,
  onNotice,
}: {
  contact: AgentContact;
  nativeAvailable: boolean;
  onNotice: (message: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const linked = Boolean(contact.androidContactExternalId);
  const usePhoneContact = async () => {
    if (!nativeAvailable || working) return;
    setWorking(true);
    try {
      if (contact.androidContactExternalId) {
        const permissions = await TimeV3Native.getCorrespondencePermissions();
        if (!permissions.contacts) await TimeV3Native.requestContactPermission();
        await TimeV3Native.openPhoneContact(contact.androidContactExternalId);
      } else {
        await TimeV3Native.savePhoneContact(nativeContactInput(contact));
        onNotice(`Review and save ${contact.displayName} in Contacts, then run phone sync to link it.`);
      }
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setWorking(false);
    }
  };
  return <View style={styles.card}>
    <View style={styles.cardHeading}>
      <View style={styles.monogram}><Text style={styles.monogramText}>{contact.displayName.trim().slice(0, 1).toUpperCase() || '?'}</Text></View>
      <View style={styles.cardIdentity}>
        <Text style={styles.contactName}>{contact.displayName}</Text>
        {!!contact.organizationName && <Text style={styles.organization}>{contact.organizationName}</Text>}
        <Text style={styles.phoneState}>{linked ? 'ON THIS PHONE' : 'AGENT ONLY'}</Text>
      </View>
    </View>
    {!!contact.methods.length && <View style={styles.methods}>{contact.methods.map((method) => <ContactMethod method={method} key={method.id} />)}</View>}
    {!!contact.tags.length && <Text style={styles.tags}>{contact.tags.join(' · ')}</Text>}
    <Pressable
      accessibilityRole="button"
      disabled={!nativeAvailable || working}
      onPress={() => void usePhoneContact()}
      style={[styles.contactAction, (!nativeAvailable || working) && styles.disabled]}
    >
      {working ? <ActivityIndicator color={colors.ink} size="small" /> : <Text style={styles.contactActionText}>{linked ? 'OPEN IN CONTACTS' : 'SAVE TO PHONE'}</Text>}
    </Pressable>
  </View>;
}

export function ContactsModal({
  visible,
  settings,
  onClose,
  onSync,
}: {
  visible: boolean;
  settings: ConnectionSettings;
  onClose: () => void;
  onSync: () => void;
}) {
  const [contacts, setContacts] = useState<AgentContact[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const nativeAvailable = Number(TimeV3Native.nativeShellVersion ?? 0) >= requiredContactShellVersion
    && TimeV3Native.nativeCapabilities?.includes('contact_insert_intent_v1');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const deviceId = nativeAvailable ? await TimeV3Native.getContactDeviceId() : null;
      setContacts(await fetchContacts(settings, deviceId));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [nativeAvailable, settings]);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleContacts = useMemo(() => normalizedQuery
    ? contacts.filter((contact) => contactSearchText(contact).includes(normalizedQuery))
    : contacts, [contacts, normalizedQuery]);
  const linkedCount = contacts.filter(({ androidContactExternalId }) => androidContactExternalId).length;

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <View style={styles.heading}>
        <View><Text style={styles.eyebrow}>AGENT ADDRESS BOOK</Text><Text style={styles.title}>Contacts</Text></View>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>CLOSE</Text></Pressable>
      </View>
      <Text style={styles.summary}>{contacts.length} active · {linkedCount} linked to this phone</Text>
      {!nativeAvailable && <Text style={styles.warning}>Rebuild and reinstall native shell {requiredContactShellVersion} to save or open phone contacts. Browsing remains available.</Text>}
      <TextInput
        accessibilityLabel="Search Agent contacts"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setQuery}
        placeholder="Search names, organizations, numbers, email, or tags"
        placeholderTextColor={colors.dim}
        style={styles.search}
        value={query}
      />
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {!!error && <View style={styles.error}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>RETRY</Text></Pressable></View>}
      {loading ? <View style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View> : <FlatList
        data={visibleContacts}
        keyExtractor={(contact) => String(contact.id)}
        contentContainerStyle={visibleContacts.length ? styles.list : styles.empty}
        renderItem={({ item }) => <ContactRow contact={item} nativeAvailable={nativeAvailable} onNotice={setNotice} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}
        ListEmptyComponent={<Text style={styles.emptyText}>{normalizedQuery ? 'No contacts match this search.' : 'No active Agent contacts.'}</Text>}
      />}
      <View style={styles.footer}>
        <Text style={styles.footerText}>After saving a contact, phone sync records its Android identity and prevents future duplicate publication.</Text>
        <Pressable accessibilityRole="button" onPress={onSync} style={styles.syncButton}><Text style={styles.syncText}>SYNC PHONE CONTACTS</Text></Pressable>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 2 },
  closeButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 9 },
  closeText: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  summary: { color: colors.muted, fontSize: 12, paddingHorizontal: 18, paddingBottom: 10 },
  warning: { color: colors.warning, backgroundColor: colors.surface, paddingHorizontal: 18, paddingVertical: 9, fontSize: 12, lineHeight: 17 },
  search: { marginHorizontal: 16, marginBottom: 10, minHeight: 44, paddingHorizontal: 13, color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, fontSize: 15 },
  notice: { marginHorizontal: 16, marginBottom: 9, color: colors.success, fontSize: 12, lineHeight: 17 },
  error: { marginHorizontal: 16, marginBottom: 10, padding: 12, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.error },
  errorText: { color: colors.error, fontSize: 13 },
  retry: { color: colors.ink, marginTop: 9, fontSize: 10, fontWeight: '900' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 18, gap: 10 },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyText: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  card: { padding: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  monogram: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated, borderRadius: 20, borderWidth: 1, borderColor: colors.gold },
  monogramText: { color: colors.gold, fontSize: 17, fontWeight: '800' },
  cardIdentity: { flex: 1 },
  contactName: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  organization: { color: colors.muted, fontSize: 12, marginTop: 2 },
  phoneState: { color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 1.1, marginTop: 4 },
  methods: { marginTop: 12, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 8 },
  method: { gap: 2 },
  methodLabel: { color: colors.dim, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  methodValue: { color: colors.ink, fontSize: 14, lineHeight: 19 },
  methodValueAction: { color: colors.gold, textDecorationLine: 'underline' },
  tags: { color: colors.muted, fontSize: 11, marginTop: 10 },
  contactAction: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: 12, backgroundColor: colors.accent, borderRadius: 9 },
  contactActionText: { color: colors.ink, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  disabled: { opacity: 0.4 },
  footer: { paddingHorizontal: 16, paddingVertical: 11, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footerText: { color: colors.muted, fontSize: 11, lineHeight: 16, marginBottom: 8 },
  syncButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent, borderRadius: 9 },
  syncText: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
});
