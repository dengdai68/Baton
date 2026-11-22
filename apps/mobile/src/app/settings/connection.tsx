import { Stack } from 'expo-router';
import { $t, useLocale } from '@/i18n';
import { View } from 'react-native';
import { Txt } from '@/ui/text';
import { GroupedPage, GroupedSection } from '@/ui/grouped';
import { useSession } from '@/workspace/session';
export default function ConnectionSettings() {
  useLocale();
  const { active } = useSession();
  return <GroupedPage><Stack.Screen options={{title:$t('工作空间')}} />
    <GroupedSection style={{marginTop:12}}>
      {[[$t('名称'), active?.name], [$t('登录地址'), active?.origin], [$t('当前账号'), active?.user]].map(([label,value]) =>
        <View key={label} style={{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:14,paddingVertical:8}}>
          <Txt variant="small" tone="secondary">{label}</Txt>
          <Txt variant="small" selectable style={{flex:1,textAlign:'right'}}>{value || '—'}</Txt>
        </View>)}
    </GroupedSection></GroupedPage>;
}
