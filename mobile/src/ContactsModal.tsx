import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
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
import { SafeAreaView } from 'react-native-safe-area-context';

import TimeV3Native from '../modules/time-v3-native/src/TimeV3NativeModule';
import { fetchContacts, updateAgentContact } from './api';
import { colors } from './theme';
import type { AgentContact, AgentContactMethod, ConnectionSettings } from './types';

const requiredContactShellVersion = 5;
const requiredPhoneEditShellVersion = 6;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load contacts.';
}

function optionalValue(value: string) {
  return value.trim() || null;
}

function methodLabel(method: AgentContactMethod) {
  return method.label?.trim()
    || (method.kind === 'timev3_person' ? 'Time v3 handle' : method.kind === 'handle' ? 'Other' : method.kind.replaceAll('_', ' '));
}

function contactSearchText(contact: AgentContact) {
  return [contact.displayName, contact.givenName, contact.familyName, contact.organizationName, contact.notes,
    ...contact.tags, ...contact.methods.flatMap((method) => [method.label, method.value])]
    .filter(Boolean).join('\n').toLocaleLowerCase();
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
      kind: method.kind, label: method.label, value: method.value, isPrimary: method.isPrimary,
    })),
  };
}

function primaryPhone(contact: AgentContact) {
  const phones = contact.methods.filter(({ kind }) => kind === 'phone');
  return phones.find(({ isPrimary }) => isPrimary) ?? phones[0] ?? null;
}

function ContactMethod({ method }: { method: AgentContactMethod }) {
  const open = () => {
    const href = method.kind === 'phone' ? `tel:${method.value}`
      : method.kind === 'email' ? `mailto:${method.value}`
        : method.kind === 'url' ? method.value : null;
    if (href) void Linking.openURL(href);
  };
  const actionable = ['phone', 'email', 'url'].includes(method.kind);
  return <Pressable disabled={!actionable} onPress={open} style={styles.detailLine}>
    <Text style={styles.detailLabel}>{methodLabel(method).toUpperCase()}</Text>
    <Text selectable style={[styles.detailValue, actionable && styles.detailLink]}>{method.value}</Text>
  </Pressable>;
}

type EditMethod = Omit<AgentContactMethod, 'id'> & { id: number | null };

function ContactEditModal({ contact, settings, onClose, onSaved }: {
  contact: AgentContact | null;
  settings: ConnectionSettings;
  onClose: () => void;
  onSaved: (contact: AgentContact) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [methods, setMethods] = useState<EditMethod[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!contact) return;
    setDisplayName(contact.displayName);
    setGivenName(contact.givenName ?? '');
    setFamilyName(contact.familyName ?? '');
    setOrganizationName(contact.organizationName ?? '');
    setBirthDate(contact.birthDate ?? '');
    setNotes(contact.notes ?? '');
    setTags(contact.tags.join(', '));
    setMethods(contact.methods.map((method) => ({ ...method })));
    setError('');
  }, [contact]);

  const updateMethod = (index: number, updates: Partial<EditMethod>) => {
    setMethods((current) => current.map((method, methodIndex) => methodIndex === index ? { ...method, ...updates } : method));
  };

  const save = async () => {
    if (!contact || saving) return;
    if (!displayName.trim()) { setError('Name is required.'); return; }
    if (methods.some(({ value }) => !value.trim())) { setError('Every contact method needs a value.'); return; }
    setSaving(true);
    setError('');
    try {
      const updated = await updateAgentContact(settings, contact, {
        displayName: displayName.trim(),
        givenName: optionalValue(givenName),
        familyName: optionalValue(familyName),
        organizationName: optionalValue(organizationName),
        birthDate: optionalValue(birthDate),
        notes: optionalValue(notes),
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        methods: methods.map((method) => ({
          ...method, id: method.id, label: optionalValue(method.label ?? ''), value: method.value.trim(),
        })),
      });
      onSaved(updated);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setSaving(false); }
  };

  return <Modal visible={Boolean(contact)} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.editPage} edges={['top', 'bottom']}>
      <View style={styles.editHeading}>
        <View><Text style={styles.editTitle}>Edit Agent contact</Text><Text style={styles.editSubtitle}>This is the canonical contact.</Text></View>
        <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>CANCEL</Text></Pressable>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.editContent} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
          <Text style={styles.inputLabel}>NAME</Text>
          <TextInput autoFocus style={styles.input} value={displayName} onChangeText={setDisplayName} />
          <View style={styles.inputPair}>
            <View style={styles.inputHalf}><Text style={styles.inputLabel}>GIVEN NAME</Text><TextInput style={styles.input} value={givenName} onChangeText={setGivenName} /></View>
            <View style={styles.inputHalf}><Text style={styles.inputLabel}>FAMILY NAME</Text><TextInput style={styles.input} value={familyName} onChangeText={setFamilyName} /></View>
          </View>
          <Text style={styles.inputLabel}>ORGANIZATION</Text>
          <TextInput style={styles.input} value={organizationName} onChangeText={setOrganizationName} />
          <Text style={styles.inputLabel}>BIRTHDAY · YYYY-MM-DD</Text>
          <TextInput autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.input} value={birthDate} onChangeText={setBirthDate} />
          <Text style={styles.inputLabel}>TAGS · COMMA SEPARATED</Text>
          <TextInput style={styles.input} value={tags} onChangeText={setTags} />
          <View style={styles.methodsHeading}>
            <Text style={styles.sectionLabel}>CONTACT OPTIONS</Text>
            <View style={styles.addActions}>
              <Pressable onPress={() => setMethods((current) => [...current, { id: null, kind: 'phone', label: 'Mobile', value: '', isPrimary: false, canReceive: true }])}><Text style={styles.addAction}>+ PHONE</Text></Pressable>
              <Pressable onPress={() => setMethods((current) => [...current, { id: null, kind: 'email', label: 'Email', value: '', isPrimary: false, canReceive: true }])}><Text style={styles.addAction}>+ EMAIL</Text></Pressable>
            </View>
          </View>
          {methods.map((method, index) => <View style={styles.methodEditor} key={`${method.id ?? 'new'}-${index}`}>
            <View style={styles.methodEditorHeading}>
              <Text style={styles.methodKind}>{method.kind.replaceAll('_', ' ').toUpperCase()}{method.isPrimary ? ' · PRIMARY' : ''}</Text>
              <Pressable onPress={() => setMethods((current) => current.filter((_, methodIndex) => methodIndex !== index))}><Text style={styles.removeAction}>REMOVE</Text></Pressable>
            </View>
            <TextInput placeholder="Label" placeholderTextColor={colors.dim} style={styles.input} value={method.label ?? ''} onChangeText={(label) => updateMethod(index, { label })} />
            <TextInput autoCapitalize="none" keyboardType={method.kind === 'phone' ? 'phone-pad' : method.kind === 'email' ? 'email-address' : 'default'} placeholder="Value" placeholderTextColor={colors.dim} style={styles.input} value={method.value} onChangeText={(value) => updateMethod(index, { value })} />
          </View>)}
          <Text style={styles.inputLabel}>NOTES</Text>
          <TextInput multiline style={[styles.input, styles.notesInput]} textAlignVertical="top" value={notes} onChangeText={setNotes} />
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          <Pressable disabled={saving} onPress={() => void save()} style={[styles.saveButton, saving && styles.disabled]}>
            {saving ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.saveText}>SAVE AGENT CONTACT</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

function ContactRow({ contact, phoneContactAvailable, phoneEditAvailable, onEdit, onNotice }: {
  contact: AgentContact;
  phoneContactAvailable: boolean;
  phoneEditAvailable: boolean;
  onEdit: () => void;
  onNotice: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [working, setWorking] = useState(false);
  const linked = Boolean(contact.androidContactExternalId);
  const phone = primaryPhone(contact);

  const text = async () => {
    if (!phone) return;
    try { await TimeV3Native.composeText(phone.value, ''); }
    catch (caught) { onNotice(errorMessage(caught)); }
  };

  const usePhoneContact = async (action: 'open' | 'edit' | 'save') => {
    if (working) return;
    setWorking(true);
    try {
      if (action === 'save') {
        await TimeV3Native.savePhoneContact(nativeContactInput(contact));
        onNotice(`Review and save ${contact.displayName} in Contacts, then run phone sync to link it.`);
      } else {
        const permissions = await TimeV3Native.getCorrespondencePermissions();
        if (!permissions.contacts) await TimeV3Native.requestContactPermission();
        if (action === 'edit') await TimeV3Native.editPhoneContact(contact.androidContactExternalId!);
        else await TimeV3Native.openPhoneContact(contact.androidContactExternalId!);
      }
    } catch (caught) { onNotice(errorMessage(caught)); }
    finally { setWorking(false); }
  };

  return <View style={styles.contactRow}>
    <Pressable onPress={() => setExpanded((value) => !value)} style={styles.nameRow}>
      <View style={styles.monogram}><Text style={styles.monogramText}>{contact.displayName.trim().slice(0, 1).toUpperCase() || '?'}</Text></View>
      <View style={styles.nameBlock}>
        <Text numberOfLines={1} style={styles.contactName}>{contact.displayName}</Text>
        {!!contact.organizationName && <Text numberOfLines={1} style={styles.organization}>{contact.organizationName}</Text>}
      </View>
      <Text style={styles.expandGlyph}>{expanded ? '⌃' : '⌄'}</Text>
    </Pressable>
    <View style={styles.quickActions}>
      <Pressable disabled={!phone} onPress={() => phone && void Linking.openURL(`tel:${phone.value}`)} style={[styles.quickButton, !phone && styles.disabled]}><Text style={styles.quickText}>CALL</Text></Pressable>
      <Pressable disabled={!phone} onPress={() => void text()} style={[styles.quickButton, !phone && styles.disabled]}><Text style={styles.quickText}>TEXT</Text></Pressable>
      <Pressable onPress={() => setExpanded((value) => !value)} style={styles.quickButton}><Text style={styles.quickText}>{expanded ? 'LESS' : 'MORE'}</Text></Pressable>
    </View>
    {expanded && <View style={styles.expanded}>
      <View style={styles.identityGrid}>
        <View><Text style={styles.detailLabel}>TYPE</Text><Text style={styles.detailValue}>{contact.kind}</Text></View>
        <View><Text style={styles.detailLabel}>STATUS</Text><Text style={styles.detailValue}>{contact.status}</Text></View>
        {!!contact.givenName && <View><Text style={styles.detailLabel}>GIVEN NAME</Text><Text style={styles.detailValue}>{contact.givenName}</Text></View>}
        {!!contact.familyName && <View><Text style={styles.detailLabel}>FAMILY NAME</Text><Text style={styles.detailValue}>{contact.familyName}</Text></View>}
        {!!contact.organizationName && <View><Text style={styles.detailLabel}>ORGANIZATION</Text><Text style={styles.detailValue}>{contact.organizationName}</Text></View>}
        {!!contact.birthDate && <View><Text style={styles.detailLabel}>BIRTHDAY</Text><Text style={styles.detailValue}>{contact.birthDate}</Text></View>}
      </View>
      {!!contact.methods.length && <View style={styles.methods}>{contact.methods.map((method, index) => <ContactMethod method={method} key={`${method.id ?? 'method'}-${index}`} />)}</View>}
      {!!contact.tags.length && <View><Text style={styles.detailLabel}>TAGS</Text><Text style={styles.detailValue}>{contact.tags.join(' · ')}</Text></View>}
      {!!contact.notes && <View><Text style={styles.detailLabel}>NOTES</Text><Text selectable style={styles.notes}>{contact.notes}</Text></View>}
      <View style={styles.identityGrid}>
        <View><Text style={styles.detailLabel}>AGENT CONTACT</Text><Text style={styles.detailValue}>#{contact.id}</Text></View>
        {!!contact.source && <View><Text style={styles.detailLabel}>SOURCE</Text><Text style={styles.detailValue}>{contact.source}</Text></View>}
        <View><Text style={styles.detailLabel}>UPDATED</Text><Text style={styles.detailValue}>{new Date(contact.updatedAtUtc).toLocaleString()}</Text></View>
      </View>
      <Text style={styles.phoneState}>{linked ? 'LINKED TO THIS PHONE' : 'AGENT ONLY'}</Text>
      <View style={styles.phoneActions}>
        <Pressable onPress={onEdit} style={styles.phoneButton}><Text style={styles.phoneButtonText}>EDIT AGENT CONTACT</Text></Pressable>
        {linked && <Pressable disabled={!phoneContactAvailable || working} onPress={() => void usePhoneContact('open')} style={styles.phoneButton}><Text style={styles.phoneButtonText}>OPEN ANDROID CONTACT</Text></Pressable>}
        {linked && <Pressable disabled={!phoneEditAvailable || working} onPress={() => void usePhoneContact('edit')} style={[styles.phoneButton, !phoneEditAvailable && styles.disabled]}><Text style={styles.phoneButtonText}>EDIT ANDROID CONTACT</Text></Pressable>}
        {!linked && <Pressable disabled={!phoneContactAvailable || working} onPress={() => void usePhoneContact('save')} style={[styles.phoneButton, !phoneContactAvailable && styles.disabled]}><Text style={styles.phoneButtonText}>SAVE TO PHONE</Text></Pressable>}
      </View>
    </View>}
  </View>;
}

export function ContactsModal({ visible, settings, onClose, onSync }: {
  visible: boolean;
  settings: ConnectionSettings;
  onClose: () => void;
  onSync: () => void;
}) {
  const [contacts, setContacts] = useState<AgentContact[]>([]);
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [editing, setEditing] = useState<AgentContact | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const shellVersion = Number(TimeV3Native.nativeShellVersion ?? 0);
  const phoneContactAvailable = shellVersion >= requiredContactShellVersion && TimeV3Native.nativeCapabilities?.includes('contact_insert_intent_v1');
  const phoneEditAvailable = shellVersion >= requiredPhoneEditShellVersion && TimeV3Native.nativeCapabilities?.includes('contact_edit_intent_v1');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const deviceId = phoneContactAvailable ? await TimeV3Native.getContactDeviceId() : null;
      setContacts(await fetchContacts(settings, deviceId));
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [phoneContactAvailable, settings]);

  useEffect(() => { if (visible) void load(); }, [load, visible]);

  const availableTags = useMemo(() => Array.from(new Set(contacts.flatMap(({ tags }) => tags))).sort((left, right) => left.localeCompare(right)), [contacts]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleContacts = useMemo(() => contacts.filter((contact) => (
    (!normalizedQuery || contactSearchText(contact).includes(normalizedQuery)) && (!selectedTag || contact.tags.includes(selectedTag))
  )), [contacts, normalizedQuery, selectedTag]);
  const linkedCount = contacts.filter(({ androidContactExternalId }) => androidContactExternalId).length;

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <ContactEditModal contact={editing} settings={settings} onClose={() => setEditing(null)} onSaved={(updated) => {
        setContacts((current) => current.map((contact) => contact.id === updated.id ? { ...updated, androidContactExternalId: contact.androidContactExternalId } : contact));
        setEditing(null);
        setNotice(`${updated.displayName} updated in Agent.`);
      }} />
      <View style={styles.heading}>
        <View><Text style={styles.title}>Contacts</Text><Text style={styles.summary}>{contacts.length} active · {linkedCount} on this phone</Text></View>
        <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>CLOSE</Text></Pressable>
      </View>
      <TextInput accessibilityLabel="Search Agent contacts" autoCapitalize="none" autoCorrect={false} onChangeText={setQuery} placeholder="Search contacts" placeholderTextColor={colors.dim} style={styles.search} value={query} />
      <Pressable onPress={() => setTagMenuOpen((open) => !open)} style={styles.tagSelector}>
        <Text style={styles.tagSelectorLabel}>TAG</Text><Text numberOfLines={1} style={styles.tagSelectorValue}>{selectedTag ?? 'All tags'}</Text><Text style={styles.tagSelectorGlyph}>{tagMenuOpen ? '⌃' : '⌄'}</Text>
      </Pressable>
      {tagMenuOpen && <ScrollView horizontal contentContainerStyle={styles.tagOptions} keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
        {[null, ...availableTags].map((tag) => <Pressable key={tag ?? 'all'} onPress={() => { setSelectedTag(tag); setTagMenuOpen(false); }} style={[styles.tagOption, selectedTag === tag && styles.tagOptionSelected]}><Text style={[styles.tagOptionText, selectedTag === tag && styles.tagOptionTextSelected]}>{tag ?? 'All tags'}</Text></Pressable>)}
      </ScrollView>}
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {!!error && <View style={styles.error}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>RETRY</Text></Pressable></View>}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {loading ? <View style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View> : <FlatList
          data={visibleContacts} keyExtractor={(contact) => String(contact.id)} contentContainerStyle={visibleContacts.length ? styles.list : styles.empty}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <ContactRow contact={item} phoneContactAvailable={phoneContactAvailable} phoneEditAvailable={phoneEditAvailable} onEdit={() => setEditing(item)} onNotice={setNotice} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}
          ListEmptyComponent={<Text style={styles.emptyText}>{normalizedQuery || selectedTag ? 'No contacts match these filters.' : 'No active Agent contacts.'}</Text>}
          ListFooterComponent={<View style={styles.keyboardClearance} />}
        />}
      </KeyboardAvoidingView>
      <View style={styles.footer}>
        <Text style={styles.footerText}>Agent is canonical. Phone sync imports new records and observations without overwriting Agent contacts.</Text>
        <Pressable onPress={onSync} style={styles.syncButton}><Text style={styles.syncText}>SYNC PHONE DATA</Text></Pressable>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, page: { flex: 1, backgroundColor: colors.background },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' }, summary: { color: colors.muted, fontSize: 11, marginTop: 2 },
  closeButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }, closeText: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  search: { marginHorizontal: 14, minHeight: 42, paddingHorizontal: 12, color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, fontSize: 15 },
  tagSelector: { minHeight: 38, marginHorizontal: 14, marginTop: 7, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 9 },
  tagSelectorLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginRight: 10 }, tagSelectorValue: { flex: 1, color: colors.ink, fontSize: 13 }, tagSelectorGlyph: { color: colors.accent, fontSize: 15 },
  tagOptions: { paddingHorizontal: 14, paddingVertical: 7, gap: 6 }, tagOption: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, tagOptionSelected: { backgroundColor: colors.accent, borderColor: colors.accent }, tagOptionText: { color: colors.muted, fontSize: 11, fontWeight: '700' }, tagOptionTextSelected: { color: colors.ink },
  notice: { marginHorizontal: 14, marginTop: 7, color: colors.success, fontSize: 11, lineHeight: 15 }, error: { marginHorizontal: 14, marginTop: 7, padding: 10, backgroundColor: colors.surface, borderRadius: 9, borderWidth: 1, borderColor: colors.error }, errorText: { color: colors.error, fontSize: 12, lineHeight: 17 }, retry: { color: colors.ink, marginTop: 7, fontSize: 9, fontWeight: '900' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, list: { paddingHorizontal: 12, paddingTop: 8, gap: 6 }, empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }, emptyText: { color: colors.muted, textAlign: 'center' }, keyboardClearance: { height: 220 },
  contactRow: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' }, nameRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 6 }, monogram: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated, marginRight: 10 }, monogramText: { color: colors.accent, fontSize: 14, fontWeight: '900' }, nameBlock: { flex: 1 }, contactName: { color: colors.ink, fontSize: 16, fontWeight: '700' }, organization: { color: colors.muted, fontSize: 11, marginTop: 1 }, expandGlyph: { color: colors.accent, fontSize: 17, paddingLeft: 8 },
  quickActions: { flexDirection: 'row', paddingHorizontal: 7, paddingBottom: 7, gap: 5 }, quickButton: { flex: 1, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: colors.elevated }, quickText: { color: colors.ink, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  expanded: { borderTopWidth: 1, borderTopColor: colors.border, padding: 11, gap: 11 }, identityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, detailLine: { gap: 2 }, detailLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, detailValue: { color: colors.ink, fontSize: 13, lineHeight: 18, textTransform: 'none' }, detailLink: { color: colors.accent }, methods: { gap: 9 }, notes: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 3 }, phoneState: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, phoneActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, phoneButton: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, borderColor: colors.border }, phoneButtonText: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 }, disabled: { opacity: 0.35 },
  footer: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 9, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }, footerText: { color: colors.muted, fontSize: 10, lineHeight: 14, marginBottom: 7 }, syncButton: { minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.accent }, syncText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  editPage: { flex: 1, backgroundColor: colors.background }, editHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }, editTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' }, editSubtitle: { color: colors.muted, fontSize: 11, marginTop: 2 }, editContent: { padding: 16, paddingBottom: 300 }, inputLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1, marginTop: 11, marginBottom: 4 }, input: { minHeight: 42, paddingHorizontal: 11, paddingVertical: 8, color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, fontSize: 14 }, inputPair: { flexDirection: 'row', gap: 8 }, inputHalf: { flex: 1 }, notesInput: { minHeight: 120 },
  methodsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 7 }, sectionLabel: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, addActions: { flexDirection: 'row', gap: 12 }, addAction: { color: colors.accent, fontSize: 9, fontWeight: '900' }, methodEditor: { padding: 10, marginBottom: 8, gap: 7, backgroundColor: colors.elevated, borderRadius: 9 }, methodEditorHeading: { flexDirection: 'row', justifyContent: 'space-between' }, methodKind: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 }, removeAction: { color: colors.error, fontSize: 8, fontWeight: '900' }, saveButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 18, borderRadius: 9, backgroundColor: colors.accent }, saveText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
});
