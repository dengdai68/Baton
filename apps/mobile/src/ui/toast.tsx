// Toast: brief confirmation or failure above the tab bar; never steals focus.
import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { createContext, type ReactNode, use, useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';
import { Txt } from './text';

type ToastState = { message: string; error: boolean; id: number } | null;
const ToastContext = createContext<(message: string, error?: boolean) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { colors, metrics } = useTheme();
  const show = useCallback((message: string, error = false) => {
    if (timer.current) clearTimeout(timer.current);
    const id = Date.now();
    setToast({ message, error, id });
    timer.current = setTimeout(() => setToast((current) => (current?.id === id ? null : current)), error ? 5000 : 2600);
  }, []);
  return (
    <ToastContext value={show}>
      {children}
      {toast ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 72, alignItems: 'center' }}>
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{ maxWidth: 420, flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: metrics.radius.md, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: toast.error ? colors.stFailedBorder : colors.border, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }}
          >
            {toast.error ? <CircleAlert size={17} color={colors.stFailed} /> : <CircleCheck size={17} color={colors.stDone} />}
            <Txt variant="small" style={{ flexShrink: 1 }}>{toast.message}</Txt>
          </View>
        </View>
      ) : null}
    </ToastContext>
  );
}

/** show(message, isError) */
export const useToast = () => use(ToastContext);
