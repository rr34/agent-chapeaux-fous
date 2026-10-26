import { NativeModule, requireNativeModule } from 'expo';

export type CorrespondencePermissions = {
  contacts: boolean;
  calls: boolean;
  messages: boolean;
};

export type CorrespondenceCursor = {
  contactsUpdatedAtMs: number;
  contactsId: number;
  callsAtMs: number;
  callsId: number;
  smsAtMs: number;
  smsId: number;
  mmsAtMs: number;
  mmsId: number;
};

export type AndroidContact = {
  externalId: string;
  displayName: string;
  givenName: string | null;
  familyName: string | null;
  organizationName: string | null;
  methods: Array<{
    kind: 'phone' | 'email';
    label: string | null;
    value: string;
    isPrimary: boolean;
  }>;
};

export type AndroidCorrespondence = {
  medium: 'sms' | 'mms' | 'call';
  direction: 'inbound' | 'outbound';
  account: string;
  threadKey?: string | null;
  externalId: string;
  address?: string | null;
  participants?: Array<{
    address: string;
    displayName?: string | null;
  }>;
  displayName?: string | null;
  body?: string | null;
  deliveryStatus?: 'sent' | 'delivered' | 'failed' | 'unknown';
  callDisposition?: 'answered' | 'missed';
  callDurationSeconds?: number | null;
  providerStatus?: string | null;
  occurredAtMs: number;
  sentAtMs?: number | null;
  receivedAtMs?: number | null;
};

export type CorrespondenceBatch = {
  deviceId: string;
  permissions: CorrespondencePermissions;
  contacts: AndroidContact[];
  correspondence: AndroidCorrespondence[];
  nextCursor: CorrespondenceCursor;
  hasMore: {
    contacts: boolean;
    calls: boolean;
    sms: boolean;
    mms: boolean;
  };
};

declare class TimeV3NativeModule extends NativeModule {
  readonly nativeShellVersion: number;
  readonly nativeCapabilities: string[];
  composeText(recipient: string, body: string): Promise<void>;
  getCorrespondencePermissions(): Promise<CorrespondencePermissions>;
  requestCorrespondencePermissions(): Promise<unknown>;
  readCorrespondenceBatch(cursor: CorrespondenceCursor, limit: number): Promise<CorrespondenceBatch>;
}

export default requireNativeModule<TimeV3NativeModule>('TimeV3Native');

