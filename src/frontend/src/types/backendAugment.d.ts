// Augment backendInterface and Backend to include _initializeAccessControlWithSecret.
// This method does not exist on the real canister; it is called in the
// protected useActor.ts hook but is a no-op at runtime.
//
// Both the interface AND the implementing class must declare the method so that
// config.ts's `return createActor(...)` (which returns Backend) continues to
// satisfy backendInterface without any protected file modifications.
import "../backend";

declare module "../backend" {
  interface backendInterface {
    _initializeAccessControlWithSecret(token: string): Promise<void>;
  }

  interface Backend {
    _initializeAccessControlWithSecret(token: string): Promise<void>;
  }
}
