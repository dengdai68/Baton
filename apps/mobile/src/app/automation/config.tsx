import { Redirect, useLocalSearchParams } from 'expo-router';

export default function AutomationConfig() {
  const { automationId } = useLocalSearchParams<{ automationId: string }>();
  return <Redirect href={{ pathname: '/task/compose', params: { automation: '1', id: automationId } }} />;
}
