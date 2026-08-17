import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ACTIVITY_TYPE } from '@/lib/activityTypes';

export interface ActivityItem {
  id: string;
  type: string;
  amount: number;
  description: string;
  userName: string;
  category?: string | null;
  date: string;
}

interface Colors {
  card: string;
  cardForeground: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  muted: string;
  primary: string;
  secondary: string;
  radius: number;
}

interface Props {
  item: ActivityItem;
  colors: Colors;
}

const CATEGORY_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  Food: 'shopping-cart',
  Transport: 'truck',
  Health: 'heart',
  Education: 'book',
  Utilities: 'zap',
  Entertainment: 'tv',
  Clothing: 'tag',
  Savings: 'archive',
  Housing: 'home',
  Communication: 'phone',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

export default function ActivityCard({ item, colors }: Props) {
  const isExpense = item.type === ACTIVITY_TYPE.EXPENSE;
  const iconName: keyof typeof Feather.glyphMap =
    (item.category ? CATEGORY_ICONS[item.category] : undefined) ??
    (isExpense ? 'shopping-bag' : 'arrow-down-circle');

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          {
            backgroundColor: isExpense ? colors.accent : colors.muted,
            borderRadius: colors.radius - 2,
          },
        ]}
      >
        <Feather
          name={iconName}
          size={18}
          color={isExpense ? colors.accentForeground : colors.primary}
        />
      </View>

      <View style={styles.info}>
        <Text
          style={[styles.description, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {item.description}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {item.userName} · {formatDate(item.date)}
        </Text>
      </View>

      <Text
        style={[
          styles.amount,
          { color: isExpense ? colors.foreground : colors.primary },
        ]}
      >
        {isExpense ? '−' : '+'}
        {item.amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1 },
  description: {
    fontSize: 14,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
  meta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
  },
});
