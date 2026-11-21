// Root: theme, data cache, workspace session and toasts around one Stack.
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { queryClient } from '@/lib/query';
import { ThemeProvider, useTheme } from '@/theme';
import { ToastProvider } from '@/ui/toast';
import { SessionProvider, useSession } from '@/workspace/session';

void SplashScreen.preventAutoHideAsync();
// Known benign React Native dev warning from native-driven animations (no app action needed).
LogBox.ignoreLogs(['Sending `onAnimatedValueUpdate` with no listeners registered.']);

function Shell() {
  const { scheme, colors } = useTheme();
  const { ready } = useSession();
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: { ...base.colors, primary: colors.accent, background: colors.bgCanvas, card: colors.bgCanvas, text: colors.text, border: colors.borderSubtle, notification: colors.stAttention },
  };
  return (
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {/* Detail screens (task workspace, conversations, editors) live on this root
          stack above the tab bar, so composers sit directly on the keyboard. */}
      <Stack
        screenOptions={{
          headerTintColor: colors.accentText,
          headerTitleStyle: { color: colors.text },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bgCanvas },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="connect" options={{ headerShown: false }} />
        <Stack.Screen name="scan" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="pair" options={{ headerShown: false }} />
        <Stack.Screen name="(workspace)" options={{ headerShown: false }} />
        <Stack.Screen name="task/compose" options={{ presentation: 'modal' }} />
        <Stack.Screen name="task/confirm" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.8, 1], sheetGrabberVisible: true }} />
        <Stack.Screen name="chat/new" options={{ presentation: 'modal' }} />
      </Stack>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <ToastProvider>
              <Shell />
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
