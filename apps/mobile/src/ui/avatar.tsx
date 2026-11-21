// Member avatars: rounded squares (radius = 0.3 × size) in identity colors with
// one glyph; a green dot only means "executing now"; a star marks the manager.
import { Star } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { identityColor, useTheme } from '@/theme';

type Member = { id?: string | null; name?: string | null; initials?: string | null; color?: string | null; status?: string | null };

export function initialOf(member: Member): string {
  const text = (member.name || member.initials || '?').trim();
  return (Array.from(text)[0] || '?').toLocaleUpperCase();
}

export function Avatar({ member, size = 36, live, manager }: { member: Member; size?: number; live?: boolean; manager?: boolean }) {
  const { colors, metrics } = useTheme();
  const inactive = member.status === 'inactive' || member.status === 'deleted';
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size, height: size, borderRadius: size * metrics.avatarRadius,
          backgroundColor: identityColor(colors, member.color, member.id || member.name),
          alignItems: 'center', justifyContent: 'center', opacity: inactive ? 0.55 : 1,
        }}
      >
        <Text style={{ color: colors.onSolid, fontSize: Math.round(size * 0.42), fontWeight: '600' }}>{initialOf(member)}</Text>
      </View>
      {live ? (
        <View
          style={{
            position: 'absolute', right: -2, bottom: -2, width: 10, height: 10, borderRadius: 5,
            backgroundColor: colors.live, borderWidth: 2, borderColor: colors.bgCanvas,
          }}
        />
      ) : null}
      {manager ? (
        <View style={{ position: 'absolute', right: -4, top: -4, backgroundColor: colors.bgCanvas, borderRadius: 7, padding: 1 }}>
          <Star size={11} color={colors.stAttention} fill={colors.stAttention} />
        </View>
      ) : null}
    </View>
  );
}

/** Two overlapping avatars for group conversations and teams. */
export function GroupAvatar({ members, size = 36 }: { members: Member[]; size?: number }) {
  const { colors } = useTheme();
  const [first, second] = members;
  if (!second) return <Avatar member={first || { name: '?' }} size={size} />;
  const small = Math.round(size * 0.72);
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', left: 0, top: 0 }}><Avatar member={first} size={small} /></View>
      <View style={{ position: 'absolute', right: 0, bottom: 0, borderWidth: 2, borderColor: colors.bgCanvas, borderRadius: small * 0.34 }}>
        <Avatar member={second} size={small} />
      </View>
    </View>
  );
}
