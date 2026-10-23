import { NativeModule, requireNativeModule } from 'expo';

declare class TimeV3NativeModule extends NativeModule {
  composeText(recipient: string, body: string): Promise<void>;
}

export default requireNativeModule<TimeV3NativeModule>('TimeV3Native');

