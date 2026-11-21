// Launch routing: open the last workspace, or the workspace list.
import { Redirect } from 'expo-router';

import { useSession } from '@/workspace/session';

export default function Index() {
  const { ready, active } = useSession();
  if (!ready) return null;
  return <Redirect href={active ? '/inbox' : '/connect'} />;
}
