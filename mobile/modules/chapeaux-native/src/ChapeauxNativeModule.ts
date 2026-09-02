import { NativeModule, requireNativeModule } from 'expo';

declare class ChapeauxNativeModule extends NativeModule {
  composeText(recipient: string, body: string): Promise<void>;
}

export default requireNativeModule<ChapeauxNativeModule>('ChapeauxNative');

