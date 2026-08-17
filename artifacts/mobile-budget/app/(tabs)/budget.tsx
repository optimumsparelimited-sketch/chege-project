import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import {
  useGetDashboardCategoryBreakdown,
  useGetDashboardSummary,
} from '@workspace/api-client-react';

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

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
  Other: 'more-horizontal',
};

function formatKES(n?: number | null): string {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
}

export default function BudgetScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } =
    useGetDashboardSummary({ month, year });
  const { data: breakdown = [], isLoading: breakdownLoading, refetch: refetchBreakdown } =
    useGetDashboardCategoryBreakdown({ month, year });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchBreakdown()]);
    setRefreshing(false);
  }, [refetchSummary, refetchBreakdown]);

  const isLoading = summaryLoading || breakdownLoading;
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  const overallPct = summary && summary.totalBudget > 0
    ? Math.min(summary.totalSpent / summary.totalBudget, 1)
    : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />
        }
        contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 110 }}
      >
        {/* Header */}
        <LinearGradient
          colors={['#0a1a10', '#0f2217', '#132a1c']}
          style={[styles.header, { paddingTop: topPad + 16 }]}
        >
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>Budget</Text>
            <View style={styles.monthNav}>
              <Pressable onPress={prevMonth} style={styles.navBtn} hitSlop={8}>
                <Feather name="chevron-left" size={20} color="rgba(247,250,246,0.7)" />
              </Pressable>
              <Text style={styles.monthLabel}>
                {MONTHS_SHORT[month - 1]} {year}
              </Text>
              <Pressable
                onPress={nextMonth}
                style={styles.navBtn}
                hitSlop={8}
                disabled={isCurrentMonth}
              >
                <Feather
                  name="chevron-right"
                  size={20}
                  color={isCurrentMonth ? 'rgba(247,250,246,0.2)' : 'rgba(247,250,246,0.7)'}
                />
              </Pressable>
            </View>
          </View>

          {/* Overall progress */}
          {!summaryLoading && summary ? (
            <View style={styles.overallCard}>
              <View style={styles.overallRow}>
                <Text style={styles.overallLabel}>Total Spent</Text>
                <Text style={styles.overallPct}>{Math.round(overallPct * 100)}%</Text>
              </View>
              <View style={[styles.barTrack, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${overallPct * 100}%`,
                      backgroundColor: overallPct >= 1 ? '#f87171' : '#4ade80',
                    },
                  ]}
                />
              </View>
              <View style={styles.overallAmounts}>
                <Text style={styles.overallSpent}>KES {formatKES(summary.totalSpent)}</Text>
                <Text style={styles.overallTarget}>of KES {formatKES(summary.totalBudget)}</Text>
              </View>
            </View>
          ) : summaryLoading ? (
            <ActivityIndicator color="#4ade80" style={{ marginVertical: 16 }} />
          ) : null}
        </LinearGradient>

        {/* Category breakdown */}
        <View style={styles.list}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>BY CATEGORY</Text>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} size="large" />
          ) : breakdown.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="bar-chart-2" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No data yet</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Add expenses to see your budget breakdown
              </Text>
            </View>
          ) : (
            breakdown.map((cat) => {
              const pct = cat.budgetAmount > 0 ? Math.min(cat.spentAmount / cat.budgetAmount, 1) : 0;
              const isOver = cat.spentAmount > cat.budgetAmount && cat.budgetAmount > 0;
              const icon = CATEGORY_ICONS[cat.category] ?? 'more-horizontal';

              return (
                <View
                  key={cat.category}
                  style={[styles.catCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.catTop}>
                    <View style={[styles.catIcon, { backgroundColor: isOver ? '#3a1a1a' : '#1a3320' }]}>
                      <Feather name={icon} size={16} color={isOver ? '#f87171' : '#4ade80'} />
                    </View>
                    <View style={styles.catInfo}>
                      <Text style={[styles.catName, { color: colors.foreground }]}>{cat.category}</Text>
                      <Text style={[styles.catRemaining, { color: isOver ? '#f87171' : colors.mutedForeground }]}>
                        {isOver
                          ? `KES ${formatKES(cat.spentAmount - cat.budgetAmount)} over`
                          : `KES ${formatKES(cat.remaining)} left`}
                      </Text>
                    </View>
                    <View style={styles.catAmounts}>
                      <Text style={[styles.catSpent, { color: colors.foreground }]}>
                        {formatKES(cat.spentAmount)}
                      </Text>
                      <Text style={[styles.catBudget, { color: colors.mutedForeground }]}>
                        / {formatKES(cat.budgetAmount)}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${pct * 100}%`,
                          backgroundColor: isOver ? '#f87171' : '#4ade80',
                        },
                      ]}
                    />
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 24 },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
  },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navBtn: { padding: 4 },
  monthLabel: {
    fontSize: 14,
    color: '#f7faf6',
    fontFamily: 'Inter_500Medium',
    minWidth: 64,
    textAlign: 'center',
  },
  overallCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: 16,
  },
  overallRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  overallLabel: {
    fontSize: 12,
    color: '#7aaa8a',
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.5,
  },
  overallPct: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
  },
  overallAmounts: { flexDirection: 'row', gap: 6, marginTop: 10 },
  overallSpent: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
  },
  overallTarget: {
    fontSize: 14,
    color: '#7aaa8a',
    fontFamily: 'Inter_400Regular',
    alignSelf: 'flex-end',
  },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  list: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    marginBottom: 12,
    marginLeft: 4,
  },
  catCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  catTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  catIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  catInfo: { flex: 1 },
  catName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  catRemaining: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  catAmounts: { alignItems: 'flex-end' },
  catSpent: {
    fontSize: 15,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
  catBudget: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
