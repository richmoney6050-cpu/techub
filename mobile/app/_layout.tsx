import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../src/session';

// If anything crashes, show the error on screen instead of a blank page.
export { ErrorBoundary } from 'expo-router';

export default function Root() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Slot />
    </SessionProvider>
  );
}
